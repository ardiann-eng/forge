import type { Address } from 'viem';
import type { Candle, ChartTimeframe } from './types';

const NETWORK = 'robinhood';
const CACHE_TTL_MS = 45_000; // 45 seconds

const ohlcvCache = new Map<string, { candles: Candle[]; timestamp: number }>();

/**
 * Maps FORGE chart timeframes to GeckoTerminal API parameters.
 */
function mapTimeframeToGecko(timeframe: ChartTimeframe): {
  endpoint: 'minute' | 'hour' | 'day';
  aggregate: number;
} {
  switch (timeframe) {
    case '1M':
      return { endpoint: 'minute', aggregate: 1 };
    case '5M':
      return { endpoint: 'minute', aggregate: 5 };
    case '15M':
      return { endpoint: 'minute', aggregate: 15 };
    case '1H':
      return { endpoint: 'hour', aggregate: 1 };
    case '4H':
      return { endpoint: 'hour', aggregate: 4 };
    case '1D':
      return { endpoint: 'day', aggregate: 1 };
    default:
      return { endpoint: 'minute', aggregate: 5 };
  }
}

/**
 * Fetches OHLCV candles from GeckoTerminal for a migrated pool on Robinhood Chain.
 */
export async function fetchGeckoTerminalOhlcv(
  poolAddress: Address,
  timeframe: ChartTimeframe,
  limit = 200,
): Promise<Candle[] | null> {
  const cacheKey = `${poolAddress.toLowerCase()}:${timeframe}:${limit}`;
  const now = Date.now();
  const cached = ohlcvCache.get(cacheKey);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.candles;
  }

  const { endpoint, aggregate } = mapTimeframeToGecko(timeframe);
  const url = `https://api.geckoterminal.com/api/v2/networks/${NETWORK}/pools/${poolAddress.toLowerCase()}/ohlcv/${endpoint}?aggregate=${aggregate}&limit=${limit}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });

    if (res.status === 429) {
      console.warn('GeckoTerminal rate limit hit (429). Returning cached or empty.');
      return cached?.candles ?? null;
    }

    if (!res.ok) {
      return cached?.candles ?? null;
    }

    const json = await res.json();
    const rawList: number[][] = json?.data?.attributes?.ohlcv_list || [];

    // Gecko returns [timestamp (seconds), open, high, low, close, volume]
    // Raw list is typically descending; Lightweight Charts requires strictly ascending time.
    const candles: Candle[] = rawList
      .map(([time, open, high, low, close, volume]) => ({
        time,
        open,
        high,
        low,
        close,
        volume,
      }))
      .sort((a, b) => a.time - b.time);

    ohlcvCache.set(cacheKey, { candles, timestamp: Date.now() });
    return candles;
  } catch (err) {
    console.error('Failed to fetch GeckoTerminal OHLCV:', err);
    return cached?.candles ?? null;
  }
}
