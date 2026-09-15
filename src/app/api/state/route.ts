import { NextResponse } from 'next/server';
import { fileStore } from '@/lib/indexer/store';
import { syncIndex } from '@/lib/indexer/worker';
import { chain, forgeFactory, forgeFactoryV2 } from '@/lib/config';
import type { Snapshot } from '@/lib/indexer/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let activeSyncPromise: Promise<Snapshot | null> | null = null;

async function getOrSyncSnapshot(forceSync = false): Promise<Snapshot | null> {
  let snapshot = await fileStore.load();

  const isChainMismatch = snapshot ? snapshot.chainId !== chain.id : false;
  const isFactoryMismatch = snapshot
    ? (forgeFactory && snapshot.factory?.toLowerCase() !== forgeFactory.toLowerCase()) ||
      (forgeFactoryV2 && snapshot.factoryV2?.toLowerCase() !== forgeFactoryV2.toLowerCase())
    : false;
  const isStale = snapshot ? Date.now() - Date.parse(snapshot.updatedAt) > 15_000 : true;
  const isEmpty = !snapshot || !snapshot.tokens || snapshot.tokens.length === 0;

  if (forceSync || !snapshot || isChainMismatch || isFactoryMismatch || isStale || isEmpty) {
    if (!activeSyncPromise) {
      activeSyncPromise = syncIndex(fileStore)
        .catch((err) => {
          console.error('Auto-sync index error in /api/state:', err);
          return null;
        })
        .finally(() => {
          activeSyncPromise = null;
        });
    }

    if (forceSync || !snapshot || isChainMismatch || isFactoryMismatch || isEmpty) {
      const fresh = await activeSyncPromise;
      if (fresh) return fresh;
    }
  }

  return snapshot || fileStore.load();
}

export async function GET(request: Request) {
  try {
    if (!forgeFactory && !forgeFactoryV2) {
      return NextResponse.json({ state: 'unconfigured', tokens: [], events: [], stats: null });
    }

    const url = new URL(request.url);
    const forceSync = url.searchParams.get('refresh') === '1' || url.searchParams.get('sync') === '1';
    const page = Math.max(0, Math.min(100000, Number(url.searchParams.get('page')) || 0));

    const snapshot = await getOrSyncSnapshot(forceSync);

    if (
      !snapshot ||
      snapshot.chainId !== chain.id ||
      (forgeFactory && snapshot.factory?.toLowerCase() !== forgeFactory.toLowerCase())
    ) {
      return NextResponse.json({ state: 'unconfigured', tokens: [], events: [], stats: null });
    }

    const stale = Date.now() - Date.parse(snapshot.updatedAt) > 120000;
    return NextResponse.json({
      state: stale ? 'stale' : snapshot.caughtUp ? 'ready' : 'syncing',
      tokens: snapshot.tokens,
      events: [...snapshot.events].reverse().slice(page * 50, (page + 1) * 50),
      eventCount: snapshot.events.length,
      stats: snapshot.stats,
      block: snapshot.cursor,
      updatedAt: snapshot.updatedAt,
    });
  } catch {
    return NextResponse.json(
      {
        state: 'error',
        error: 'Indexer data could not be read.',
        tokens: [],
        events: [],
        stats: null,
      },
      { status: 503 },
    );
  }
}
