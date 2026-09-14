let cachedPrice: { price: number; timestamp: number } | null = null;
let inflightPromise: Promise<number | null> | null = null;

const CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * Resolves real ETH/USD price from reliable public aggregators.
 * Strict fallback order: DeFiLlama -> Binance -> Coinbase.
 * Never returns hardcoded or synthetic values.
 */
export async function getEthUsdPrice(): Promise<number | null> {
  const now = Date.now();
  if (cachedPrice && now - cachedPrice.timestamp < CACHE_TTL_MS) {
    return cachedPrice.price;
  }

  if (inflightPromise) {
    return inflightPromise;
  }

  inflightPromise = (async () => {
    // 1. Primary: DeFiLlama
    try {
      const res = await fetch('https://coins.llama.fi/prices/current/coingecko:ethereum', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const json = await res.json();
        const price = json?.coins?.['coingecko:ethereum']?.price;
        if (typeof price === 'number' && price > 0) {
          cachedPrice = { price, timestamp: Date.now() };
          return price;
        }
      }
    } catch {
      // Proceed to fallback
    }

    // 2. Fallback 1: Binance
    try {
      const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const json = await res.json();
        const price = parseFloat(json?.price);
        if (!isNaN(price) && price > 0) {
          cachedPrice = { price, timestamp: Date.now() };
          return price;
        }
      }
    } catch {
      // Proceed to fallback
    }

    // 3. Fallback 2: Coinbase
    try {
      const res = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const json = await res.json();
        const price = parseFloat(json?.data?.amount);
        if (!isNaN(price) && price > 0) {
          cachedPrice = { price, timestamp: Date.now() };
          return price;
        }
      }
    } catch {
      // All providers failed
    }

    // Return previous cached value if still exists, or null
    return cachedPrice ? cachedPrice.price : null;
  })().finally(() => {
    inflightPromise = null;
  });

  return inflightPromise;
}
