import type { Candle, ChartTimeframe, LiveTrade } from './types';

const TIMEFRAME_SECONDS: Record<ChartTimeframe, number> = {
  '1M': 60,
  '5M': 300,
  '15M': 900,
  '1H': 3600,
  '4H': 14400,
  '1D': 86400,
};

export interface CandleBuilderOptions {
  timeframe: ChartTimeframe;
  initialPriceUsd?: number;
  initialTimestamp?: number;
  currentPriceUsd?: number;
  currentTime?: number;
}

/**
 * Builds standard OHLCV candlestick buckets from real timestamped PONS curve trades.
 * Never synthesizes missing trades or fake volume.
 */
export class BondingCandleBuilder {
  static buildCandles(
    trades: LiveTrade[],
    options: CandleBuilderOptions,
  ): Candle[] {
    const bucketSeconds = TIMEFRAME_SECONDS[options.timeframe] || 300;

    // Filter trades that have valid price and timestamp
    const validTrades = trades
      .filter((t) => typeof t.priceUsd === 'number' && t.priceUsd > 0)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (validTrades.length === 0) return [];

    // Group trades by time bucket
    const bucketMap = new Map<number, LiveTrade[]>();

    for (const trade of validTrades) {
      const bucketTime =
        Math.floor(trade.timestamp / bucketSeconds) * bucketSeconds;
      const bucket = bucketMap.get(bucketTime) || [];
      bucket.push(trade);
      bucketMap.set(bucketTime, bucket);
    }

    const sortedBucketTimes = [...bucketMap.keys()].sort((a, b) => a - b);
    const candles: Candle[] = [];

    for (const bucketTime of sortedBucketTimes) {
      const bucketTrades = bucketMap.get(bucketTime)!;
      const open = bucketTrades[0].priceUsd!;
      let high = open;
      let low = open;
      let volume = 0;

      for (const trade of bucketTrades) {
        const p = trade.priceUsd!;
        if (p > high) high = p;
        if (p < low) low = p;
        // Volume in USD: trade amount in ETH * price of ETH, or tokens * price
        const tradeVol =
          typeof trade.priceUsd === 'number' && trade.tokenAmount > 0n
            ? (Number(trade.tokenAmount) / 1e18) * trade.priceUsd
            : 0;
        volume += tradeVol;
      }

      const close = bucketTrades[bucketTrades.length - 1].priceUsd!;
      candles.push({
        time: bucketTime,
        open,
        high,
        low,
        close,
        volume,
      });
    }

    return candles.sort((a, b) => a.time - b.time);
  }

  /**
   * Derives market-cap candles from real price candles * verified supply.
   * Only valid when mathematically exact.
   */
  static deriveMarketCapCandles(
    priceCandles: Candle[],
    launchSupplyTokens: number,
  ): Candle[] {
    return priceCandles.map((c) => ({
      time: c.time,
      open: c.open * launchSupplyTokens,
      high: c.high * launchSupplyTokens,
      low: c.low * launchSupplyTokens,
      close: c.close * launchSupplyTokens,
      volume: c.volume,
    }));
  }
}
