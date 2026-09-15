import { zeroAddress, decodeEventLog, type Address } from 'viem';
import { publicClient } from '../client';
import { chain, deploymentBlock, deploymentBlockV2, forgeFactory, forgeFactoryV2 } from '../config';
import { factoryAbi, v2Abi as factoryV2Abi } from '../forge/factory';
import { routerAbi as legacyRouterAbi } from '../forge/router';
import { abi as v2RouterAbi } from '../forge/ForgeRouterV2.abi';
const routerAbi = [...legacyRouterAbi, ...v2RouterAbi];
import { ponsAbi } from '../pons/abi';
import { ponsAddress } from '../pons/config';
import { getLogsChunked } from '../market/logs';
import type { Activity, IndexStore, IndexedToken, Snapshot } from './types';

export function registry(events: Activity[]) {  const routers = events
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

const MAX_ACTIVITY_EVENTS = 500;
// Fresh boots (ephemeral disk) scan at most this far back; later syncs are incremental.
const MAX_FRESH_SCAN_WINDOW = 250_000n;

const TRACKED_ACTIVITY_EVENTS = new Set([
  'RouterCreated',
  'TokenBound',
  'AdaptersConfigured',
  'OwnershipTransferred',
  'FeesReceived',
  'FeesProcessed',
  'BuybackExecuted',
  'BuyAndBurnExecuted',
  'Claimed',
  'HolderRewardsFunded',
  'HolderRewardReserveAdded',
  'LiquidityProcessed',
  'LiquidityReserveAdded',
  'TokenLaunched',
  'LaunchSwept',
  'PoolGraduated',
  'GradBoostExecuted',
  'DcaBuybackExecuted',
  'DcaChecked',
  'DcaCancelled',
  'StrategyPaused',
  'StrategyReserveAdded',
]);

export type LogRef = {
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  logIndex: number;
};

function asActivityAddress(value: unknown): Address | undefined {
  return typeof value === 'string' && value.startsWith('0x') ? (value as Address) : undefined;
}

function asActivityAmount(value: unknown): string | undefined {
  return typeof value === 'bigint' ? value.toString() : undefined;
}

/** Pure assembler: decoded log + block timestamp -> indexable Activity row. */
export function buildActivity(
  address: Address,
  eventName: string,
  args: Record<string, unknown>,
  log: LogRef,
  timestamp: number,
): Activity | null {
  if (!TRACKED_ACTIVITY_EVENTS.has(eventName)) return null;
  const activity: Activity = {
    id: `${log.transactionHash}:${log.logIndex}`,
    event: eventName,
    address,
    block: log.blockNumber.toString(),
    blockHash: log.blockHash,
    timestamp: String(timestamp),
    hash: log.transactionHash,
    logIndex: log.logIndex,
  };
  const token = asActivityAddress(args.token);
  const router = asActivityAddress(args.router);
  const creator = asActivityAddress(args.creator) ?? asActivityAddress(args.deployer);
  const amount =
    asActivityAmount(args.amount) ??
    asActivityAmount(args.ethIn) ??
    asActivityAmount(args.quoteIn) ??
    asActivityAmount(args.tokensOut);
  const asset = asActivityAddress(args.asset);
  if (token) activity.token = token;
  if (router) activity.router = router;
  if (creator) activity.creator = creator;
  if (amount) activity.amount = amount;
  if (asset) activity.asset = asset;
  return activity;
}

type ScannableSource = { address: Address; abi: typeof factoryV2Abi | typeof factoryAbi | typeof routerAbi | typeof ponsAbi };

/** Scans event logs across factories, routers and PONS; failures never throw. */
export async function scanActivityEvents(
  sources: ScannableSource[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Activity[]> {
  if (sources.length === 0 || fromBlock > toBlock) return [];
  const perSource = await Promise.all(
    sources.map(async ({ address, abi }) => {
      try {
        const logs = await getLogsChunked(publicClient, { address }, fromBlock, toBlock);
        const blockNumbers = [...new Set(logs.map((l) => l.blockNumber))];
        const timestamps = new Map<bigint, number>();
        await Promise.all(
          blockNumbers.map(async (b) => {
            try {
              const block = await publicClient.getBlock({ blockNumber: b });
              timestamps.set(b, Number(block.timestamp));
            } catch {
              // Skip logs from unreadable blocks.
            }
          }),
        );
        const rows: Activity[] = [];
        for (const log of logs) {
          try {
            const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
            const timestamp = timestamps.get(log.blockNumber);
            if (timestamp === undefined) continue;
            const row = buildActivity(
              log.address,
              decoded.eventName,
              (decoded.args ?? {}) as Record<string, unknown>,
              {
                blockNumber: log.blockNumber,
                blockHash: log.blockHash,
                transactionHash: log.transactionHash,
                logIndex: log.logIndex,
              },
              timestamp,
            );
            if (row) rows.push(row);
          } catch {
            // Skip logs that do not match the ABI.
          }
        }
        return rows;
      } catch (err) {
        console.error(`Activity scan failed for ${address}:`, err);
        return [] as Activity[];
      }
    }),
  );
  return perSource
    .flat()
    .sort((a, b) => (BigInt(a.block) === BigInt(b.block) ? a.logIndex - b.logIndex : Number(BigInt(a.block) - BigInt(b.block))));
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

  // Incremental activity feed: previous runs already covered blocks through
  // the stored cursor, so only scan forward. Fresh boots scan a bounded window.
  let events: Activity[] = previous?.events ?? [];
  try {
    const deployBase =
      deploymentBlockV2 ?? deploymentBlock ?? (safe > MAX_FRESH_SCAN_WINDOW ? safe - MAX_FRESH_SCAN_WINDOW : 0n);
    const freshBase = safe > MAX_FRESH_SCAN_WINDOW ? safe - MAX_FRESH_SCAN_WINDOW : 0n;
    const scanFrom = previous?.cursor
      ? BigInt(previous.cursor) + 1n
      : deployBase < freshBase
        ? freshBase
        : deployBase;
    if (scanFrom <= safe) {
      const sources: ScannableSource[] = [
        ...activeFactories.map(({ address, abi }) => ({ address, abi })),
        ...allRouterAddresses.map((address) => ({ address, abi: routerAbi })),
      ];
      if (ponsAddress) sources.push({ address: ponsAddress, abi: ponsAbi });
      const fresh = await scanActivityEvents(sources, scanFrom, safe);
      if (fresh.length > 0) {
        const merged = new Map(events.map((e) => [e.id, e]));
        for (const e of fresh) merged.set(e.id, e);
        events = [...merged.values()]
          .sort((a, b) =>
            BigInt(a.block) === BigInt(b.block) ? a.logIndex - b.logIndex : Number(BigInt(a.block) - BigInt(b.block)),
          )
          .slice(-MAX_ACTIVITY_EVENTS);
      }
    }
  } catch (err) {
    console.error('Activity feed scan failed, keeping previous events:', err);
  }

  const snapshot: Snapshot = {
    chainId: chain.id,
    factory: forgeFactory || forgeFactoryV2!,
    factoryV2: forgeFactoryV2 || undefined,
    cursor: safe.toString(),
    cursorHash: block.hash,
    updatedAt: new Date().toISOString(),
    caughtUp: true,
    events,
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
