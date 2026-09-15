import { NextResponse } from 'next/server';
import { type Address, isAddress, zeroAddress } from 'viem';
import { fileStore } from '@/lib/indexer/store';
import {
  resolveTokenMarketSnapshot,
  resolveTokenMetadata,
} from '@/lib/market/resolver';
import { publicClient } from '@/lib/client';
import { abi as routerAbi } from '@/lib/forge/ForgeRouter.abi';
import { findTokenRouter } from '@/lib/forge/factory';
import { forgeFactory, forgeFactoryV2 } from '@/lib/config';

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
    const rawTokens = url.searchParams.get('tokens');

    let tokenAddresses: Address[] = [];
    if (rawTokens) {
      tokenAddresses = rawTokens
        .split(',')
        .map((t) => t.trim())
        .filter((t): t is Address => isAddress(t));
    } else {
      const snapshot = await fileStore.load();
      if (snapshot?.tokens) {
        tokenAddresses = snapshot.tokens.map((t) => t.token);
      }
    }

    if (tokenAddresses.length === 0) {
      return NextResponse.json({
        snapshots: {},
        metadata: {},
        flows: {},
        tokens: [],
        updatedAt: Date.now(),
      });
    }

    // Resolve snapshots, metadata, and flow for each token
    const snapshots: Record<string, unknown> = {};
    const metadata: Record<string, unknown> = {};
    const flows: Record<string, unknown> = {};

    await Promise.all(
      tokenAddresses.map(async (token) => {
        const key = token.toLowerCase();
        try {
          const [snap, meta] = await Promise.all([
            resolveTokenMarketSnapshot(token),
            resolveTokenMetadata(token),
          ]);
          snapshots[key] = snap;
          metadata[key] = meta;

          // Resolve router flow
          if (forgeFactory || forgeFactoryV2) {
            try {
              const routerAddress = await findTokenRouter(token);

              if (routerAddress && routerAddress !== zeroAddress) {
                const [destinations, received, processed] = await Promise.all([
                  publicClient
                    .readContract({
                      address: routerAddress,
                      abi: routerAbi,
                      functionName: 'getDestinations',
                    })
                    .catch(() => []),
                  publicClient
                    .readContract({
                      address: routerAddress,
                      abi: routerAbi,
                      functionName: 'totalReceived',
                    })
                    .catch(() => 0n),
                  publicClient
                    .readContract({
                      address: routerAddress,
                      abi: routerAbi,
                      functionName: 'totalProcessed',
                    })
                    .catch(() => 0n),
                ]);

                flows[key] = {
                  router: routerAddress,
                  destinations: (destinations as Array<{ recipient: Address; bps: number; kind: number }>).map(
                    (d) => ({
                      recipient: d.recipient,
                      bps: Number(d.bps),
                      kind: Number(d.kind),
                    }),
                  ),
                  received: received.toString(),
                  processed: processed.toString(),
                };
              }
            } catch {
              // Ignore router resolution failure
            }
          }
        } catch (err) {
          console.error(`Error resolving token data for ${token}:`, err);
        }
      }),
    );

    return NextResponse.json(serializeBigInts({
      snapshots,
      metadata,
      flows,
      tokens: tokenAddresses,
      updatedAt: Date.now(),
    }));
  } catch (err) {
    console.error('Market tokens API error:', err);
    return NextResponse.json(
      { error: 'Failed to resolve market tokens' },
      { status: 500 },
    );
  }
}
