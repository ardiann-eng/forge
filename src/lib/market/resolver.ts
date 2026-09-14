import {
  type Address,
  erc20Abi,
  parseAbi,
  zeroAddress,
} from 'viem';
import { publicClient } from '../client';
import { getToken, phaseLabel } from '../pons/reads';
import { getPonsBondingState, getPonsCurveTrades } from './ponsMarket';
import {
  fetchDexScreenerTokens,
  selectBestMigratedPool,
} from './dexScreener';
import type {
  TokenLifecycle,
  TokenMarketSnapshot,
  TokenMetadata,
} from './types';

const tokenMetadataAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function logo() view returns (string)',
  'function description() view returns (string)',
  'function socials() view returns (string, string, string, string, string)',
]);

const snapshotCache = new Map<
  string,
  { snapshot: TokenMarketSnapshot; timestamp: number }
>();
const CACHE_TTL_MS = 8_000; // 8 seconds

/**
 * Canonical Token Market Resolver.
 * Resolves lifecycle-aware market data from real PONS state and external providers.
 * ZERO fake data: missing values remain undefined.
 */
export async function resolveTokenMarketSnapshot(
  tokenAddress: Address,
): Promise<TokenMarketSnapshot> {
  const normalized = tokenAddress.toLowerCase() as Address;
  const now = Date.now();
  const cached = snapshotCache.get(normalized);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.snapshot;
  }

  // 1. Resolve canonical PONS on-chain launch state
  let launch;
  try {
    launch = await getToken(tokenAddress);
  } catch {
    launch = null;
  }

  const phase = launch?.phase ?? 0;
  const lifecycle: TokenLifecycle =
    launch ? (phaseLabel(phase) as TokenLifecycle) : 'UNKNOWN';

  // Base snapshot model
  const snapshot: TokenMarketSnapshot = {
    tokenAddress: normalized,
    lifecycle,
    updatedAt: now,
    sources: ['rpc'],
  };

  // 2. Lifecycle Branch: BONDING
  if (lifecycle === 'BONDING' && launch?.curve && launch.curve !== zeroAddress) {
    const bonding = await getPonsBondingState(tokenAddress, launch.curve);
    if (bonding) {
      snapshot.priceNative = bonding.spotPriceEth.toFixed(18);
      if (bonding.spotPriceUsd !== null) snapshot.priceUsd = bonding.spotPriceUsd;
      if (bonding.marketCapUsd !== null) snapshot.marketCapUsd = bonding.marketCapUsd;
      if (bonding.fdvUsd !== null) snapshot.fdvUsd = bonding.fdvUsd;
      if (bonding.liquidityUsd !== null) snapshot.liquidityUsd = bonding.liquidityUsd;
      snapshot.bondingProgress = bonding.bondingProgress;
      snapshot.bondingReserves = bonding.realQuoteReserve.toString();
      snapshot.bondingThreshold = bonding.graduationThreshold.toString();
      snapshot.pairAddress = launch.curve;
      snapshot.marketAddress = launch.curve;
      snapshot.dexId = 'pons-bonding';
      snapshot.sources.push('pons');

      // Read real trades for 24h stats
      const trades = await getPonsCurveTrades(launch.curve);
      const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
      const trades24h = trades.filter((t) => t.timestamp >= oneDayAgo);

      let vol24hEth = 0;
      let buys24h = 0;
      let sells24h = 0;

      for (const t of trades24h) {
        vol24hEth += Number(t.nativeAmount) / 1e18;
        if (t.type === 'BUY') buys24h++;
        if (t.type === 'SELL') sells24h++;
      }

      if (bonding.spotPriceUsd !== null && bonding.spotPriceEth > 0) {
        const ethUsd = bonding.spotPriceUsd / bonding.spotPriceEth;
        snapshot.volume24h = vol24hEth * ethUsd;
      }
      snapshot.buys24h = buys24h;
      snapshot.sells24h = sells24h;
    }
  }

  // 3. Lifecycle Branch: GRADUATED or MIGRATED (or enrichment)
  if (lifecycle === 'MIGRATED' || lifecycle === 'GRADUATED') {
    const dexPairsMap = await fetchDexScreenerTokens([tokenAddress]);
    const pairs = dexPairsMap.get(normalized) || [];
    const bestPool = selectBestMigratedPool(pairs);

    if (bestPool) {
      snapshot.pairAddress = bestPool.pairAddress;
      snapshot.marketAddress = bestPool.pairAddress;
      snapshot.dexId = bestPool.dexId;
      snapshot.sources.push('dexscreener');
      snapshot.priceNative = bestPool.priceNative;
      if (bestPool.priceUsd) snapshot.priceUsd = parseFloat(bestPool.priceUsd);
      if (bestPool.marketCap) snapshot.marketCapUsd = bestPool.marketCap;
      if (bestPool.fdv) snapshot.fdvUsd = bestPool.fdv;
      if (bestPool.liquidity?.usd) snapshot.liquidityUsd = bestPool.liquidity.usd;

      if (bestPool.volume) {
        snapshot.volume5m = bestPool.volume.m5;
        snapshot.volume1h = bestPool.volume.h1;
        snapshot.volume6h = bestPool.volume.h6;
        snapshot.volume24h = bestPool.volume.h24;
      }

      if (bestPool.priceChange) {
        snapshot.change5m = bestPool.priceChange.m5;
        snapshot.change1h = bestPool.priceChange.h1;
        snapshot.change6h = bestPool.priceChange.h6;
        snapshot.change24h = bestPool.priceChange.h24;
      }

      if (bestPool.txns?.h24) {
        snapshot.buys24h = bestPool.txns.h24.buys;
        snapshot.sells24h = bestPool.txns.h24.sells;
      }
    } else if (launch?.curve && launch.curve !== zeroAddress) {
      // Fall back to bonding curve terminal state if pool not yet indexed
      const bonding = await getPonsBondingState(tokenAddress, launch.curve);
      if (bonding) {
        snapshot.priceNative = bonding.spotPriceEth.toFixed(18);
        if (bonding.spotPriceUsd !== null) snapshot.priceUsd = bonding.spotPriceUsd;
        if (bonding.marketCapUsd !== null) snapshot.marketCapUsd = bonding.marketCapUsd;
        snapshot.bondingProgress = 100;
        snapshot.bondingReserves = bonding.realQuoteReserve.toString();
        snapshot.bondingThreshold = bonding.graduationThreshold.toString();
        snapshot.marketAddress = launch.curve;
        snapshot.sources.push('pons');
      }
    }
  }

  snapshotCache.set(normalized, { snapshot, timestamp: Date.now() });
  return snapshot;
}

/** Public resolver used by routes and server components. */
export const resolveTokenMarket = resolveTokenMarketSnapshot;

/**
 * Batch resolver for token lists. Fetches DEX Screener and bonding state efficiently.
 */
export async function resolveMultipleTokenSnapshots(
  tokenAddresses: Address[],
): Promise<Map<string, TokenMarketSnapshot>> {
  const result = new Map<string, TokenMarketSnapshot>();
  if (tokenAddresses.length === 0) return result;

  // Run in parallel with concurrency throttle
  const promises = tokenAddresses.map(async (addr) => {
    try {
      const snap = await resolveTokenMarketSnapshot(addr);
      result.set(addr.toLowerCase(), snap);
    } catch (err) {
      console.error(`Failed to resolve snapshot for ${addr}:`, err);
    }
  });

  await Promise.all(promises);
  return result;
}

/**
 * Resolves real token metadata (name, symbol, decimals, supply, description, logo, socials).
 */
export async function resolveTokenMetadata(
  tokenAddress: Address,
): Promise<TokenMetadata> {
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'name',
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'symbol',
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'decimals',
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'totalSupply',
    }),
  ]);

  let description = '';
  let logo = '';
  let socials = ['', '', '', '', ''];
  let deployer: Address = zeroAddress;
  let curve: Address | undefined;
  let launchedAt: number | undefined;

  try {
    const desc = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenMetadataAbi,
      functionName: 'description',
    });
    if (typeof desc === 'string') description = desc;
  } catch {
    // Optional
  }

  try {
    const lg = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenMetadataAbi,
      functionName: 'logo',
    });
    if (typeof lg === 'string') logo = lg;
  } catch {
    // Optional
  }

  try {
    const soc = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenMetadataAbi,
      functionName: 'socials',
    });
    if (Array.isArray(soc)) socials = soc as [string, string, string, string, string];
  } catch {
    // Optional
  }

  try {
    const launch = await getToken(tokenAddress);
    if (launch) {
      deployer = launch.deployer;
      curve = launch.curve;
    }
  } catch {
    // Optional
  }

  return {
    name,
    symbol,
    decimals,
    totalSupply,
    description: description || undefined,
    logo: logo || undefined,
    socials: {
      twitter: socials[0] || undefined,
      telegram: socials[1] || undefined,
      discord: socials[2] || undefined,
      website: socials[3] || undefined,
      farcaster: socials[4] || undefined,
    },
    deployer,
    curve,
    launchedAt,
  };
}
