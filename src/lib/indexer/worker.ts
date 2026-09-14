import { decodeEventLog, type Address, type Log } from 'viem';
import { publicClient } from '../client';
import { chain, deploymentBlock, forgeFactory } from '../config';
import { factoryAbi } from '../forge/factory';
import { routerAbi } from '../forge/router';
import { ponsAbi } from '../pons/abi';
import { requirePons } from '../pons/reads';
import type { Activity, IndexStore, IndexedToken, Snapshot } from './types';
export function registry(events: Activity[]) {
  const routers = events
    .filter((e) => e.event === 'RouterCreated' && e.router)
    .map((e) => e.router!);
  const tokens: IndexedToken[] = events
    .filter(
      (e) =>
        e.event === 'TokenBound' &&
        e.address.toLowerCase() === forgeFactory?.toLowerCase() &&
        e.token &&
        e.router &&
        e.creator,
    )
    .map((e) => ({ token: e.token!, router: e.router!, creator: e.creator! }));
  return { routers: [...new Set(routers)], tokens };
}
export async function syncIndex(store: IndexStore) {
  if (!forgeFactory || deploymentBlock === null)
    throw new Error('Factory and deployment block are required for indexing.');
  if ((await publicClient.getChainId()) !== chain.id) throw new Error('RPC chain mismatch.');
  const head = await publicClient.getBlockNumber();
  const confirmations = BigInt(process.env.INDEXER_CONFIRMATIONS || 12);
  const safe = head > confirmations ? head - confirmations : 0n;
  let previous = await store.load();
  if (
    previous &&
    (previous.chainId !== chain.id || previous.factory.toLowerCase() !== forgeFactory.toLowerCase())
  )
    previous = null;
  if (previous) {
    const block = await publicClient.getBlock({ blockNumber: BigInt(previous.cursor) });
    if (block.hash !== previous.cursorHash) previous = null;
  } // Deep reorg: deterministic replay, never retain orphaned totals.
  let from = previous ? BigInt(previous.cursor) + 1n : deploymentBlock;
  let events = previous?.events || [];
  let cursor = previous ? BigInt(previous.cursor) : deploymentBlock - 1n;
  for (let batch = 0; from <= safe && batch < 10; batch++) {
    const to = from + 999n < safe ? from + 999n : safe;
    const factoryLogs = await publicClient.getLogs({
      address: forgeFactory,
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
        decoded = decodeEventLog({
          abi: kind === 'factory' ? factoryAbi : kind === 'router' ? routerAbi : ponsAbi,
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
        amount: args.amount === undefined ? undefined : String(args.amount),
        asset: args.asset as Address | undefined,
        block: log.blockNumber.toString(),
        blockHash: log.blockHash,
        timestamp: block.timestamp.toString(),
        hash: log.transactionHash,
        logIndex: log.logIndex,
      });
    }
    for (const log of factoryLogs) await decode(log, 'factory');
    const known = registry([...events, ...base]);
    for (let i = 0; i < known.routers.length; i += 50) {
      const logs = await publicClient.getLogs({
        address: known.routers.slice(i, i + 50),
        fromBlock: from,
        toBlock: to,
      });
      for (const l of logs) await decode(l, 'router');
    }
    if (known.routers.length) {
      const logs = await publicClient.getLogs({
        address: requirePons(),
        fromBlock: from,
        toBlock: to,
      });
      for (const l of logs) await decode(l, 'pons');
    }
    const tokenSet = new Set(known.tokens.map((t) => t.token.toLowerCase()));
    const routerSet = new Set(known.routers.map((r) => r.toLowerCase()));
    const retained: Activity[] = [];
    for (const event of base) {
      if (event.address.toLowerCase() !== requirePons().toLowerCase()) {
        retained.push(event);
        continue;
      }
      if (!event.token) continue;
      if (tokenSet.has(event.token.toLowerCase())) {
        retained.push(event);
        continue;
      }
      // A launch precedes binding. Verify its receiver rather than discarding it as unregistered.
      const record = await publicClient.readContract({
        address: requirePons(),
        abi: ponsAbi,
        functionName: 'getLaunchedToken',
        args: [event.token],
        blockNumber: to,
      });
      if (record.exists && routerSet.has(record.creatorFeeRecipient.toLowerCase())) {
        retained.push({ ...event, router: record.creatorFeeRecipient, creator: record.deployer });
      }
    }
    events = [...events, ...retained];
    events = [...new Map(events.map((e) => [e.id, e])).values()].sort(
      (a, b) => Number(BigInt(a.block) - BigInt(b.block)) || a.logIndex - b.logIndex,
    );
    cursor = to;
    from = to + 1n;
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
          blockNumber: cursor,
        }),
        publicClient.readContract({
          address,
          abi: routerAbi,
          functionName: 'totalProcessed',
          blockNumber: cursor,
        }),
      ]);
      return { received, processed };
    }),
  );
  const snapshot: Snapshot = {
    chainId: chain.id,
    factory: forgeFactory,
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
