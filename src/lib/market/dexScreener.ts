import type { Address } from 'viem';

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: Address;
  labels?: string[];
  baseToken: {
    address: Address;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: Address;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns?: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h6?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  volume?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  priceChange?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  liquidity?: {
    usd?: number;
    base?: number;
    quote?: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    header?: string;
    openGraph?: string;
    websites?: Array<{ label?: string; url: string }>;
    socials?: Array<{ type: string; url: string }>;
  };
}

interface DexScreenerTokenResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[] | null;
}

const CACHE_TTL_MS = 15_000; // 15 seconds cache
const cache = new Map<string, { data: DexScreenerPair[]; timestamp: number }>();

/**
 * Fetches pair data for multiple tokens in a single batch request to avoid rate limits.
 */
export async function fetchDexScreenerTokens(
  tokenAddresses: Address[],
): Promise<Map<string, DexScreenerPair[]>> {
  const result = new Map<string, DexScreenerPair[]>();
  const toFetch: string[] = [];
  const now = Date.now();

  for (const raw of tokenAddresses) {
    const addr = raw.toLowerCase();
    const cached = cache.get(addr);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      result.set(addr, cached.data);
    } else {
      toFetch.push(addr);
    }
  }

  if (toFetch.length === 0) {
    return result;
  }

  // Deduplicate and batch up to 30 tokens per request (DexScreener limit)
  const uniqueToFetch = [...new Set(toFetch)];
  const chunkSize = 30;

  for (let i = 0; i < uniqueToFetch.length; i += chunkSize) {
    const chunk = uniqueToFetch.slice(i, i + chunkSize);
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(',')}`,
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        },
      );

      if (res.ok) {
        const json: DexScreenerTokenResponse = await res.json();
        const pairs = json.pairs || [];

        for (const tokenAddr of chunk) {
          const matchingPairs = pairs.filter(
            (p) =>
              p.baseToken.address.toLowerCase() === tokenAddr &&
              (p.chainId === 'robinhood' || p.chainId === '4663'),
          );
          cache.set(tokenAddr, { data: matchingPairs, timestamp: Date.now() });
          result.set(tokenAddr, matchingPairs);
        }
      }
    } catch (err) {
      console.error('DexScreener batch fetch error:', err);
    }
  }

  return result;
}

/**
 * Selects the best migrated pool for a token based on DEX, quote asset, and liquidity.
 */
export function selectBestMigratedPool(
  pairs: DexScreenerPair[],
  expectedPairAddress?: Address,
): DexScreenerPair | null {
  if (!pairs || pairs.length === 0) return null;

  // 1. If an exact pair address was provided from PONS migration state, match it first
  if (expectedPairAddress) {
    const exact = pairs.find(
      (p) => p.pairAddress.toLowerCase() === expectedPairAddress.toLowerCase(),
    );
    if (exact) return exact;
  }

  // 2. Filter Robinhood Chain pairs
  const robinhoodPairs = pairs.filter(
    (p) => p.chainId === 'robinhood' || p.chainId === '4663',
  );
  if (robinhoodPairs.length === 0) return null;

  // 3. Prefer Uniswap V4 with native ETH / WETH quote token and highest USD liquidity
  const sorted = [...robinhoodPairs].sort((a, b) => {
    const aLiq = a.liquidity?.usd || 0;
    const bLiq = b.liquidity?.usd || 0;

    const aIsUniV4 = a.dexId === 'uniswap' || (a.labels && a.labels.includes('v4'));
    const bIsUniV4 = b.dexId === 'uniswap' || (b.labels && b.labels.includes('v4'));

    if (aIsUniV4 && !bIsUniV4) return -1;
    if (!aIsUniV4 && bIsUniV4) return 1;

    return bLiq - aLiq;
  });

  return sorted[0] || null;
}
