import { describe, it, expect } from 'vitest';
import { BondingCandleBuilder } from '../src/lib/market/candles';
import { selectBestMigratedPool, type DexScreenerPair } from '../src/lib/market/dexScreener';
import { mapEventsToCandles } from '../src/lib/market/events';
import { getEthUsdPrice } from '../src/lib/market/provider';
import type { Candle, ForgeChartEvent, LiveTrade } from '../src/lib/market/types';

describe('BondingCandleBuilder', () => {
  it('aggregates real timestamped trades into exact OHLCV buckets without fabricating volume', () => {
    const trades: LiveTrade[] = [
      {
        id: 'tx1:0',
        type: 'BUY',
        timestamp: 1789390010, // bucket 1789390000 (for 5M = 300s: 1789389900)
        txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        blockNumber: 100n,
        recipient: '0x2222222222222222222222222222222222222222',
        nativeAmount: 1000000000000000n, // 0.001 ETH
        tokenAmount: 1000000000000000000000n, // 1000 tokens
        priceUsd: 0.0000025,
      },
      {
        id: 'tx2:0',
        type: 'BUY',
        timestamp: 1789390100,
        txHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
        blockNumber: 105n,
        recipient: '0x3333333333333333333333333333333333333333',
        nativeAmount: 2000000000000000n,
        tokenAmount: 1500000000000000000000n,
        priceUsd: 0.0000030,
      },
      {
        id: 'tx3:0',
        type: 'SELL',
        timestamp: 1789390150,
        txHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
        blockNumber: 110n,
        recipient: '0x4444444444444444444444444444444444444444',
        nativeAmount: 800000000000000n,
        tokenAmount: 800000000000000000000n,
        priceUsd: 0.0000022,
      },
    ];

    const candles = BondingCandleBuilder.buildCandles(trades, {
      timeframe: '5M',
    });

    expect(candles.length).toBe(1);
    const c = candles[0];
    expect(c.open).toBe(0.0000025);
    expect(c.high).toBe(0.0000030);
    expect(c.low).toBe(0.0000022);
    expect(c.close).toBe(0.0000022);
    expect(c.volume).toBeGreaterThan(0);
  });

  it('derives market-cap candles accurately using verified token supply without rounding drift', () => {
    const priceCandles: Candle[] = [
      {
        time: 1789390000,
        open: 0.000002,
        high: 0.000005,
        low: 0.000001,
        close: 0.000004,
        volume: 100,
      },
    ];

    const supplyTokens = 1_000_000_000; // 1 Billion tokens
    const mcCandles = BondingCandleBuilder.deriveMarketCapCandles(priceCandles, supplyTokens);

    expect(mcCandles.length).toBe(1);
    expect(mcCandles[0].open).toBe(2000);
    expect(mcCandles[0].high).toBe(5000);
    expect(mcCandles[0].low).toBe(1000);
    expect(mcCandles[0].close).toBe(4000);
    expect(mcCandles[0].volume).toBe(100);
  });

  it('handles empty trades gracefully by never synthesizing fake trades', () => {
    const candles = BondingCandleBuilder.buildCandles([], {
      timeframe: '5M',
    });
    expect(candles).toEqual([]);
  });
});

describe('DEX Screener Pool Selection', () => {
  it('prefers exact migrated pool address if provided', () => {
    const targetPool = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
    const pairs: DexScreenerPair[] = [
      {
        chainId: 'robinhood',
        dexId: 'uniswap',
        url: 'https://...',
        pairAddress: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' as const,
        baseToken: { address: '0x1' as const, name: 'T', symbol: 'T' },
        quoteToken: { address: '0x0' as const, name: 'ETH', symbol: 'ETH' },
        priceNative: '0.0001',
        priceUsd: '0.25',
        liquidity: { usd: 50000 },
      },
      {
        chainId: 'robinhood',
        dexId: 'uniswap',
        url: 'https://...',
        pairAddress: targetPool,
        baseToken: { address: '0x1' as const, name: 'T', symbol: 'T' },
        quoteToken: { address: '0x0' as const, name: 'ETH', symbol: 'ETH' },
        priceNative: '0.0001',
        priceUsd: '0.25',
        liquidity: { usd: 10000 },
      },
    ];

    const selected = selectBestMigratedPool(pairs, targetPool);
    expect(selected?.pairAddress).toBe(targetPool);
  });

  it('selects highest liquidity Uniswap V4 pool on Robinhood Chain when no exact address provided', () => {
    const pairs: DexScreenerPair[] = [
      {
        chainId: 'ethereum',
        dexId: 'uniswap',
        url: 'https://...',
        pairAddress: '0x1111111111111111111111111111111111111111' as const,
        baseToken: { address: '0x1' as const, name: 'T', symbol: 'T' },
        quoteToken: { address: '0x0' as const, name: 'ETH', symbol: 'ETH' },
        priceNative: '0.0001',
        priceUsd: '0.25',
        liquidity: { usd: 100000 },
      },
      {
        chainId: 'robinhood',
        dexId: 'uniswap',
        labels: ['v4'],
        url: 'https://...',
        pairAddress: '0x2222222222222222222222222222222222222222' as const,
        baseToken: { address: '0x1' as const, name: 'T', symbol: 'T' },
        quoteToken: { address: '0x0' as const, name: 'ETH', symbol: 'ETH' },
        priceNative: '0.0001',
        priceUsd: '0.25',
        liquidity: { usd: 25000 },
      },
      {
        chainId: 'robinhood',
        dexId: 'uniswap',
        labels: ['v4'],
        url: 'https://...',
        pairAddress: '0x3333333333333333333333333333333333333333' as const,
        baseToken: { address: '0x1' as const, name: 'T', symbol: 'T' },
        quoteToken: { address: '0x0' as const, name: 'ETH', symbol: 'ETH' },
        priceNative: '0.0001',
        priceUsd: '0.25',
        liquidity: { usd: 80000 },
      },
    ];

    const selected = selectBestMigratedPool(pairs);
    expect(selected?.pairAddress).toBe('0x3333333333333333333333333333333333333333');
  });
});

describe('Chart Event Timestamp Alignment', () => {
  it('maps on-chain event to nearest chart candle timestamp without timezone skew', () => {
    const candles: Candle[] = [
      { time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 0 },
      { time: 1300, open: 1, high: 1, low: 1, close: 1, volume: 0 },
      { time: 1600, open: 1, high: 1, low: 1, close: 1, volume: 0 },
    ];

    const events: ForgeChartEvent[] = [
      {
        id: 'evt1',
        type: 'BUYBACK',
        timestamp: 1280, // closer to 1300 than 1000
        blockNumber: 10n,
        txHash: '0x123',
      },
      {
        id: 'evt2',
        type: 'BURN',
        timestamp: 1050, // closer to 1000 than 1300
        blockNumber: 11n,
        txHash: '0x456',
      },
    ];

    const mapped = mapEventsToCandles(events, candles);
    expect(mapped.get(1300)?.length).toBe(1);
    expect(mapped.get(1300)?.[0].id).toBe('evt1');
    expect(mapped.get(1000)?.length).toBe(1);
    expect(mapped.get(1000)?.[0].id).toBe('evt2');
  });
});

describe('Centralized ETH/USD Provider', () => {
  it('resolves a positive non-zero real ETH spot price', async () => {
    const price = await getEthUsdPrice();
    expect(price).not.toBeNull();
    expect(typeof price).toBe('number');
    expect(price!).toBeGreaterThan(500); // ETH is well above $500
    expect(price!).toBeLessThan(100000); // Sanity upper bound
  });
});
