import {
  type Address,
  decodeEventLog,
  parseAbi,
  zeroAddress,
} from 'viem';
import { publicClient } from '../client';
import { getToken } from '../pons/reads';
import { getEthUsdPrice } from './provider';
import { getLogsChunked } from './logs';
import type { LiveTrade } from './types';

const tradeCache = new Map<string, { trades: LiveTrade[]; timestamp: number }>();
const tradeInflight = new Map<string, Promise<LiveTrade[]>>();
const TRADE_CACHE_TTL_MS = 15_000;

export const ponsCurveAbi = parseAbi([
  'function getReserves() view returns (uint256 quoteReserve_, uint256 tokenReserve_)',
  'function realQuoteReserve() view returns (uint256)',
  'function graduationThreshold() view returns (uint256)',
  'function phantomQuote() view returns (uint256)',
  'function launchSupply() view returns (uint256)',
  'function sellableTokens() view returns (uint256)',
  'function reservedTokens() view returns (uint256)',
  'function graduated() view returns (bool)',
  'function launchedAt() view returns (uint256)',
  'function pairToken() view returns (address)',
  'function feeBps() view returns (uint256)',
  'event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)',
  'event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)',
  'event CurveCompleted(address recipient, uint256 quoteOut, uint256 tokenOut)',
  'event BuybackLocked(uint256 quoteSpent, uint256 tokensLocked)',
]);

export interface PonsBondingState {
  curveAddress: Address;
  pairToken: Address;
  isNative: boolean;
  graduated: boolean;
  quoteReserve: bigint;
  tokenReserve: bigint;
  realQuoteReserve: bigint;
  graduationThreshold: bigint;
  phantomQuote: bigint;
  launchSupply: bigint;
  sellableTokens: bigint;
  reservedTokens: bigint;
  launchedAt: number;
  bondingProgress: number; // 0 - 100

  // Real Calculated Pricing
  spotPriceEth: number;
  spotPriceUsd: number | null;
  marketCapEth: number;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
}

export async function getPonsBondingState(
  tokenAddress: Address,
  curveAddress?: Address,
): Promise<PonsBondingState | null> {
  let curve = curveAddress;
  if (!curve) {
    const launch = await getToken(tokenAddress);
    if (!launch?.curve || launch.curve === zeroAddress) return null;
    curve = launch.curve;
  }

  try {
    const [
      reserves,
      realQuoteReserve,
      graduationThreshold,
      phantomQuote,
      launchSupply,
      sellableTokens,
      reservedTokens,
      graduated,
      launchedAt,
      pairToken,
    ] = await Promise.all([
      publicClient.readContract({
        address: curve,
        abi: ponsCurveAbi,
        functionName: 'getReserves',
      }),
      publicClient.readContract({
        address: curve,
        abi: ponsCurveAbi,
        functionName: 'realQuoteReserve',
      }),
      publicClient.readContract({
        address: curve,
        abi: ponsCurveAbi,
        functionName: 'graduationThreshold',
      }),
      publicClient.readContract({
        address: curve,
        abi: ponsCurveAbi,
        functionName: 'phantomQuote',
      }),
      publicClient.readContract({
        address: curve,
        abi: ponsCurveAbi,
        functionName: 'launchSupply',
      }),
      publicClient.readContract({
        address: curve,
        abi: ponsCurveAbi,
        functionName: 'sellableTokens',
      }),
      publicClient.readContract({
        address: curve,
        abi: ponsCurveAbi,
        functionName: 'reservedTokens',
      }),
      publicClient.readContract({
        address: curve,
        abi: ponsCurveAbi,
        functionName: 'graduated',
      }),
      publicClient.readContract({
        address: curve,
        abi: ponsCurveAbi,
        functionName: 'launchedAt',
      }),
      publicClient.readContract({
        address: curve,
        abi: ponsCurveAbi,
        functionName: 'pairToken',
      }),
    ]);

    const [quoteReserve, tokenReserve] = reserves;
    const ethPrice = await getEthUsdPrice();

    // Constant product spot price: quoteReserve / tokenReserve
    // Both quote and token have 18 decimals on native Robinhood Chain PONS launches.
    const spotPriceEth =
      tokenReserve > 0n ? Number(quoteReserve) / Number(tokenReserve) : 0;
    const spotPriceUsd = ethPrice !== null ? spotPriceEth * ethPrice : null;

    // PONS Market Cap: spot price * launchSupply
    // = (quoteReserve * launchSupply) / tokenReserve
    const marketCapWei =
      tokenReserve > 0n ? (quoteReserve * launchSupply) / tokenReserve : 0n;
    const marketCapEth = Number(marketCapWei) / 1e18;
    const marketCapUsd = ethPrice !== null ? marketCapEth * ethPrice : null;

    // Real physical liquidity in bonding curve: realQuoteReserve * 2 (or quoteReserve) in USD
    const realQuoteEth = Number(realQuoteReserve) / 1e18;
    const liquidityUsd = ethPrice !== null ? realQuoteEth * 2 * ethPrice : null;

    const bondingProgress =
      graduationThreshold > 0n
        ? Math.min(100, Number((realQuoteReserve * 10000n) / graduationThreshold) / 100)
        : 0;

    return {
      curveAddress: curve,
      pairToken,
      isNative: pairToken === zeroAddress,
      graduated,
      quoteReserve,
      tokenReserve,
      realQuoteReserve,
      graduationThreshold,
      phantomQuote,
      launchSupply,
      sellableTokens,
      reservedTokens,
      launchedAt: Number(launchedAt),
      bondingProgress,
      spotPriceEth,
      spotPriceUsd,
      marketCapEth,
      marketCapUsd,
      fdvUsd: marketCapUsd,
      liquidityUsd,
    };
  } catch (err) {
    console.error('Failed to read PONS bonding state:', err);
    return null;
  }
}

/**
 * Fetches real trade events from the PONS bonding curve.
 */
export async function getPonsCurveTrades(
  curveAddress: Address,
  fromBlock?: bigint,
  toBlock?: bigint,
): Promise<LiveTrade[]> {
  const cacheKey = `${curveAddress.toLowerCase()}:${fromBlock?.toString() ?? 'recent'}:${toBlock?.toString() ?? 'head'}`;
  const cached = tradeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TRADE_CACHE_TTL_MS) return cached.trades;
  const inflight = tradeInflight.get(cacheKey);
  if (inflight) return inflight;

  const request = (async () => {
  try {
    const head = await publicClient.getBlockNumber();
    const to = toBlock ?? head;
    // Scan up to 50,000 blocks or from curve launch
    const from = fromBlock ?? (head > 50000n ? head - 50000n : 0n);

    const logs = await getLogsChunked(
      publicClient,
      { address: curveAddress },
      from,
      to,
    );

    const ethPrice = await getEthUsdPrice();
    const trades: LiveTrade[] = [];

    for (const log of logs) {
      try {
        const decoded = decodeEventLog({
          abi: ponsCurveAbi,
          data: log.data,
          topics: log.topics,
        });

        if (decoded.eventName === 'CurveBuy') {
          const args = decoded.args as {
            buyer: Address;
            recipient: Address;
            quoteIn: bigint;
            tokensOut: bigint;
            fee: bigint;
            tax: bigint;
          };
          const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
          const priceEth =
            args.tokensOut > 0n ? Number(args.quoteIn) / Number(args.tokensOut) : undefined;
          const priceUsd =
            priceEth !== undefined && ethPrice !== null ? priceEth * ethPrice : undefined;

          trades.push({
            id: `${log.transactionHash}:${log.logIndex}`,
            type: 'BUY',
            timestamp: Number(block.timestamp),
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            buyer: args.buyer,
            recipient: args.recipient,
            nativeAmount: args.quoteIn,
            tokenAmount: args.tokensOut,
            feeNative: args.fee,
            taxNative: args.tax,
            priceUsd,
          });
        } else if (decoded.eventName === 'CurveSell') {
          const args = decoded.args as {
            seller: Address;
            recipient: Address;
            tokensIn: bigint;
            quoteOut: bigint;
            fee: bigint;
            tax: bigint;
          };
          const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
          const priceEth =
            args.tokensIn > 0n ? Number(args.quoteOut) / Number(args.tokensIn) : undefined;
          const priceUsd =
            priceEth !== undefined && ethPrice !== null ? priceEth * ethPrice : undefined;

          trades.push({
            id: `${log.transactionHash}:${log.logIndex}`,
            type: 'SELL',
            timestamp: Number(block.timestamp),
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            seller: args.seller,
            recipient: args.recipient,
            nativeAmount: args.quoteOut,
            tokenAmount: args.tokensIn,
            feeNative: args.fee,
            taxNative: args.tax,
            priceUsd,
          });
        }
      } catch {
        // Skip unrelated logs
      }
    }

    const sorted = trades.sort((a, b) => b.timestamp - a.timestamp);
    tradeCache.set(cacheKey, { trades: sorted, timestamp: Date.now() });
    return sorted;
  } catch (err) {
    console.error('Failed to get PONS curve trades:', err);
    return cached?.trades ?? [];
  }
  })().finally(() => tradeInflight.delete(cacheKey));

  tradeInflight.set(cacheKey, request);
  return request;
}
