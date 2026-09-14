import { NextResponse } from 'next/server';
import { type Address, isAddress, zeroAddress } from 'viem';
import { getToken } from '@/lib/pons/reads';
import { getPonsBondingState, getPonsCurveTrades } from '@/lib/market/ponsMarket';
import { BondingCandleBuilder } from '@/lib/market/candles';
import { fetchGeckoTerminalOhlcv } from '@/lib/market/geckoTerminal';
import { getForgeEventsForToken } from '@/lib/market/events';
import { fetchDexScreenerTokens, selectBestMigratedPool } from '@/lib/market/dexScreener';
import type { Candle, ChartTimeframe, LiveTrade } from '@/lib/market/types';
import { publicClient } from '@/lib/client';
import { factoryAbi, requireFactory } from '@/lib/forge/factory';
import { forgeFactory } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeBigInts<T>(data: T): unknown {
  return JSON.parse(
    JSON.stringify(data, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  );
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const tokenParam = url.searchParams.get('token');
    const timeframeParam = (url.searchParams.get('timeframe') || '5M') as ChartTimeframe;
    const metricParam = url.searchParams.get('metric') || 'PRICE';

    if (!tokenParam || !isAddress(tokenParam)) {
      return NextResponse.json({ error: 'Valid token address required' }, { status: 400 });
    }

    const token = tokenParam as Address;
    const launch = await getToken(token).catch(() => null);

    // Resolve dedicated router
    let routerAddress: Address | undefined;
    if (forgeFactory) {
      try {
        const r = await publicClient.readContract({
          address: requireFactory(),
          abi: factoryAbi,
          functionName: 'tokenToRouter',
          args: [token],
        });
        if (r && r !== zeroAddress) routerAddress = r;
      } catch {
        // Optional
      }
    }

    // Fetch Forge chart events & live activity
    const { chartEvents, activityItems } = await getForgeEventsForToken(token, routerAddress);

    let candles: Candle[] = [];
    let source: 'pons-bonding' | 'geckoterminal' | 'empty' = 'empty';
    let trades: LiveTrade[] = [];

    if (launch?.curve && launch.curve !== zeroAddress) {
      const bonding = await getPonsBondingState(token, launch.curve);
      trades = await getPonsCurveTrades(launch.curve);

      // If migrated, check GeckoTerminal pool first
      if (launch.phase === 2) {
        const dexMap = await fetchDexScreenerTokens([token]);
        const bestPool = selectBestMigratedPool(dexMap.get(token.toLowerCase()) || []);

        if (bestPool?.pairAddress) {
          const geckoCandles = await fetchGeckoTerminalOhlcv(bestPool.pairAddress, timeframeParam);
          if (geckoCandles && geckoCandles.length > 0) {
            candles = geckoCandles;
            source = 'geckoterminal';
          }
        }
      }

      // If still empty or in bonding, use BondingCandleBuilder
      if (candles.length === 0 && bonding) {
        candles = BondingCandleBuilder.buildCandles(trades, {
          timeframe: timeframeParam,
          initialPriceUsd: bonding.spotPriceUsd || undefined,
          initialTimestamp: bonding.launchedAt,
          currentPriceUsd: bonding.spotPriceUsd || undefined,
          currentTime: Math.floor(Date.now() / 1000),
        });
        source = 'pons-bonding';
      }

      // If metric is MC and we have launchSupply, derive MC candles
      if (metricParam === 'MC' && bonding?.launchSupply && candles.length > 0) {
        const supplyTokens = Number(bonding.launchSupply) / 1e18;
        candles = BondingCandleBuilder.deriveMarketCapCandles(candles, supplyTokens);
      }
    }

    return NextResponse.json(
      serializeBigInts({
        candles,
        events: chartEvents,
        activity: activityItems,
        trades,
        timeframe: timeframeParam,
        metric: metricParam,
        source,
        updatedAt: Date.now(),
      }),
    );
  } catch (err) {
    console.error('Candles API error:', err);
    return NextResponse.json({ error: 'Failed to build candles' }, { status: 500 });
  }
}
