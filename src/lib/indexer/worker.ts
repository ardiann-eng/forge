import { zeroAddress, type Address } from 'viem';
import { publicClient } from '../client';
import { chain, forgeFactory, forgeFactoryV2 } from '../config';
import { factoryAbi, v2Abi as factoryV2Abi } from '../forge/factory';
import { routerAbi as legacyRouterAbi } from '../forge/router';
import { abi as v2RouterAbi } from '../forge/ForgeRouterV2.abi';
const routerAbi = [...legacyRouterAbi, ...v2RouterAbi];
import type { Activity, IndexStore, IndexedToken, Snapshot } from './types';

export function registry(events: Activity[]) {
  const routers = events
    .filter((e) => e.event === 'RouterCreated' && e.router)
    .map((e) => e.router!);
  const tokens: IndexedToken[] = events
    .filter(
      (e) =>
        (e.event === 'TokenBound' || e.event === 'TokenLaunched') &&
        (e.event === 'TokenLaunched' ||
          [forgeFactory, forgeFactoryV2].some(
            (factory) => factory?.toLowerCase() === e.address.toLowerCase(),
          )) &&
        e.token &&
        e.router &&
        e.creator,
    )
    .map((e) => ({ token: e.token!, router: e.router!, creator: e.creator! }));
  return {
    routers: [...new Set(routers)],
    tokens: [...new Map(tokens.map((token) => [token.token.toLowerCase(), token])).values()],
  };
}

export async function syncIndex(store: IndexStore): Promise<Snapshot | null> {
  if (!forgeFactory && !forgeFactoryV2) return null;
  if ((await publicClient.getChainId()) !== chain.id) throw new Error('RPC chain mismatch.');

  const head = await publicClient.getBlockNumber();
  const confirmations = BigInt(process.env.INDEXER_CONFIRMATIONS || 12);
  const safe = head > confirmations ? head - confirmations : 0n;

  // Active factory registries (V2 and V1) expose canonical router lists.
  // Querying direct on-chain state avoids rate-limited public RPC block log scans.
  const activeFactories: Array<{ address: Address; abi: typeof factoryV2Abi | typeof factoryAbi; isV2: boolean }> = [];
  if (forgeFactoryV2) activeFactories.push({ address: forgeFactoryV2, abi: factoryV2Abi, isV2: true });
  if (forgeFactory) activeFactories.push({ address: forgeFactory, abi: factoryAbi, isV2: false });

  if (activeFactories.length === 0) return null;

  const factoryRouters = await Promise.all(
    activeFactories.map(async ({ address, abi }) => {
      try {
        const count = await publicClient.readContract({
          address,
          abi,
          functionName: 'routerCount',
        });
        const routers = await Promise.all(
          Array.from({ length: Number(count) }, (_, index) =>
            publicClient.readContract({
              address,
              abi,
              functionName: 'allRouters',
              args: [BigInt(index)],
            }),
          ),
        );
        return { address, abi, routers };
      } catch (err) {
        console.error(`Error reading routers from factory ${address}:`, err);
        return { address, abi, routers: [] as Address[] };
      }
    }),
  );

  const allRouterAddresses = [...new Set(factoryRouters.flatMap((f) => f.routers))];

  const records = await Promise.all(
    factoryRouters.flatMap(({ address: factoryAddress, abi, routers }) =>
      routers.map(async (router) => {
        try {
          const [token, creator] = await Promise.all([
            publicClient.readContract({
              address: factoryAddress,
              abi,
              functionName: 'routerToToken',
              args: [router],
            }),
            publicClient.readContract({
              address: router,
              abi: routerAbi,
              functionName: 'creator',
            }).catch(() => zeroAddress),
          ]);
          return { router, token, creator };
        } catch {
          return { router, token: zeroAddress, creator: zeroAddress };
        }
      }),
    ),
  );

  const tokensMap = new Map<string, IndexedToken>();
  for (const record of records) {
    if (record.token && record.token.toLowerCase() !== zeroAddress) {
      tokensMap.set(record.token.toLowerCase(), {
        token: record.token,
        router: record.router,
        creator: record.creator,
      });
    }
  }
  const tokens = [...tokensMap.values()];

  const totals = await Promise.all(
    allRouterAddresses.map(async (address) => {
      try {
        const [received, processed] = await Promise.all([
          publicClient.readContract({ address, abi: routerAbi, functionName: 'totalReceived' }).catch(() => 0n),
          publicClient.readContract({ address, abi: routerAbi, functionName: 'totalProcessed' }).catch(() => 0n),
        ]);
        return { received, processed };
      } catch {
        return { received: 0n, processed: 0n };
      }
    }),
  );

  const block = await publicClient.getBlock({ blockNumber: safe });
  const previous = await store.load();
  const snapshot: Snapshot = {
    chainId: chain.id,
    factory: forgeFactory || forgeFactoryV2!,
    factoryV2: forgeFactoryV2 || undefined,
    cursor: safe.toString(),
    cursorHash: block.hash,
    updatedAt: new Date().toISOString(),
    caughtUp: true,
    events: previous?.events || [],
    tokens,
    routers: allRouterAddresses,
    stats: {
      received: totals.reduce((sum, row) => sum + row.received, 0n).toString(),
      processed: totals.reduce((sum, row) => sum + row.processed, 0n).toString(),
    },
  };
  await store.save(snapshot);
  return snapshot;
}
