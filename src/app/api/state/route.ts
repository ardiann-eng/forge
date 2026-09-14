import { NextResponse } from 'next/server';
import { fileStore } from '@/lib/indexer/store';
import { chain, forgeFactory } from '@/lib/config';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const snapshot = await fileStore.load();
    if (
      !forgeFactory ||
      !snapshot ||
      snapshot.chainId !== chain.id ||
      snapshot.factory.toLowerCase() !== forgeFactory.toLowerCase()
    )
      return NextResponse.json({ state: 'unconfigured', tokens: [], events: [], stats: null });
    const url = new URL(request.url);
    const page = Math.max(0, Math.min(100000, Number(url.searchParams.get('page')) || 0));
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
