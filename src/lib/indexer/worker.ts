import { decodeEventLog, zeroAddress, type Address, type Log } from 'viem';
import { publicClient } from '../client';
import { chain, deploymentBlock, forgeFactory, forgeFactoryV2, deploymentBlockV2 } from '../config';
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
export async function syncIndex(store: IndexStore) {
  if (!forgeFactory && !forgeFactoryV2)
    throw new Error('Factory is required for indexing.');
  if ((await publicClient.getChainId()) !== chain.id) throw new Error('RPC chain mismatch.');

  const head = await publicClient.getBlockNumber();
  const confirmations = BigInt(process.env.INDEXER_CONFIRMATIONS || 12);
  const safe = head > confirmations ? head - confirmations : 0n;

  // Active factory registries (V2 and V1) expose canonical router lists.
  // Querying direct on-chain state avoids rate-limited public RPC block log scans.
  const activeFactories = [
    { address: forgeFactoryV2, abi: factoryV2Abi, isV2: true },
    { address: forgeFactory, abi: factoryAbi, isV2: false },
  ].filter((f): f is { address: Address; abi: typeof factoryV2Abi | typeof factoryAbi; isV2: boolean } => !!f.address);

  if (activeFactories.length > 0) {
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
  let previous = await store.load();
  if (
    previous &&
    (previous.chainId !== chain.id || previous.factory.toLowerCase() !== forgeFactory.toLowerCase())
  )
    previous = null;
  if (previous && previous.factoryV2 !== (forgeFactoryV2 || undefined)) previous = null;
  if (previous && BigInt(previous.cursor) < startBlock - 1n) previous = null;
  if (previous) {
    const block = await publicClient.getBlock({ blockNumber: BigInt(previous.cursor) });
    if (block.hash !== previous.cursorHash) previous = null;
  } // Deep reorg: deterministic replay, never retain orphaned totals.
  let from = previous ? BigInt(previous.cursor) + 1n : startBlock;
  let events = previous?.events || [];
  let cursor = previous ? BigInt(previous.cursor) : startBlock - 1n;
  for (let batch = 0; from <= safe && batch < 10; batch++) {
    // Robinhood's shared public RPC rate-limits wide ranges aggressively.
    // Smaller ranges let a fresh deployment recover its listing snapshot.
    const to = from + 99n < safe ? from + 99n : safe;
    const factoryLogs = await publicClient.getLogs({
      address: indexedFactories,
      fromBlock: from,
      toBlock: to,
    });
    const base: Activity[] = [];
    async function decode(log: Log, kind: 'factory' | 'router' | 'pons') {
      if (
        log.blockNumber === null ||
        !log.blockHash ||
        !log.transactionHash ||
        log.logIndex === null
      )
        return;
      let decoded;
      try {
        const abi =
          kind === 'factory'
            ? forgeFactoryV2?.toLowerCase() === log.address.toLowerCase()
              ? factoryV2Abi
              : factoryAbi
            : routerAbi;
        decoded = decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics,
          strict: true,
        });
      } catch {
        return;
      }
      const args = decoded.args as Record<string, unknown>;
      const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
      base.push({
        id: `${log.transactionHash}:${log.logIndex}`,
        event: decoded.eventName,
        address: log.address,
        token: args.token as Address | undefined,
        router: args.router as Address | undefined,
        creator: (args.creator || args.deployer) as Address | undefined,
        amount:
          args.amount === undefined
            ? args.ethIn === undefined
              ? undefined
              : String(args.ethIn)
            : String(args.amount),
        details: Object.fromEntries(
          Object.entries(args).map(([key, value]) => [key, String(value)]),
        ),
        asset: args.asset as Address | undefined,
        block: log.blockNumber.toString(),
        blockHash: log.blockHash,
        timestamp: block.timestamp.toString(),
        hash: log.transactionHash,
        logIndex: log.logIndex,
      });
    }
    for (const log of factoryLogs) await decode(log, 'factory');
    // Token listings are determined by the factory's immutable TokenBound
    // event. Router activity is intentionally not queried here: it adds a
    // request per known router and can starve the listing index on public RPC.
    // A token is listed only once its Forge router emits TokenBound. Indexing
    // every PONS launch is both unnecessary and unsafe on the public RPC: it
    // pulls unrelated ecosystem launches and can exhaust the provider's quota.
    events = [...events, ...base];
    events = [...new Map(events.map((e) => [e.id, e])).values()].sort(
      (a, b) => Number(BigInt(a.block) - BigInt(b.block)) || a.logIndex - b.logIndex,
    );
    cursor = to;
    from = to + 1n;
    if (from <= safe) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (cursor < deploymentBlock) return null;
  const known = registry(events);
  const block = await publicClient.getBlock({ blockNumber: cursor });
  const totals = await Promise.all(
    known.routers.map(async (address) => {
      const [received, processed] = await Promise.all([
        publicClient.readContract({
          address,
          abi: routerAbi,
          functionName: 'totalReceived',
        }),
        publicClient.readContract({
          address,
          abi: routerAbi,
          functionName: 'totalProcessed',
        }),
      ]);
      return { received, processed };
    }),
  );
  const snapshot: Snapshot = {
    chainId: chain.id,
    factory: forgeFactory,
    factoryV2: forgeFactoryV2 || undefined,
    cursor: cursor.toString(),
    cursorHash: block.hash,
    updatedAt: new Date().toISOString(),
    caughtUp: cursor >= safe,
    events,
    tokens: known.tokens,
    routers: known.routers,
    stats: {
      received: totals.reduce((s, r) => s + r.received, 0n).toString(),
      processed: totals.reduce((s, r) => s + r.processed, 0n).toString(),
    },
  };
  await store.save(snapshot);
  return snapshot;
}
