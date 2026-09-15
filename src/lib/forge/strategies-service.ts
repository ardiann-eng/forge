import { type Address } from 'viem';
import { publicClient } from '../client';
import { fileStore } from '../indexer/store';
import { abi } from './ForgeRouterV2.abi';
import { abi as priceAbi } from './PonsStrategyPrice.abi';
import { abi as adapterAbi } from './PonsMarketAdapterV2.abi';
import { destinationLabel } from '../flow';
export async function getStrategies(token: Address) {
  const snapshot = await fileStore.load();
  const record = snapshot?.tokens.find((t) => t.token.toLowerCase() === token.toLowerCase());
  if (!record || !snapshot) return { state: 'empty' as const };
  const address = record.router,
    blockNumber = BigInt(snapshot.cursor);
  const read = <
    N extends
      | 'getDestinations'
      | 'getLevels'
      | 'gradLimits'
      | 'dcaLimits'
      | 'triggerProgressBps'
      | 'gradBoostBalance'
      | 'dcaBuybackBalance'
      | 'anchorPrice'
      | 'dcaEpoch'
      | 'paused'
      | 'lastGradExecution'
      | 'lastDcaExecution'
      | 'lastDcaCheck'
      | 'dcaCancelled'
      | 'priceResolver'
      | 'dcaPlanReserve'
      | 'dcaPlanSpent'
      | 'marketAdapter'
      | 'creator',
  >(
    functionName: N,
  ) => publicClient.readContract({ address, abi, functionName, blockNumber });
  const flow = await read('getDestinations');
  const isV2 = snapshot.events.some(
    (e) =>
      e.event === 'RouterCreated' &&
      e.router?.toLowerCase() === address.toLowerCase() &&
      e.address.toLowerCase() === snapshot.factoryV2?.toLowerCase(),
  );
  if (!isV2)
    return {
      state: 'success' as const,
      version: 1,
      router: address,
      legacy: flow.map((d) => ({ ...d, label: destinationLabel(d.kind) })),
    };
  const [
    levels,
    gradLimits,
    dcaLimits,
    triggerProgressBps,
    gradReserve,
    dcaReserve,
    anchorPrice,
    epoch,
    paused,
    lastGrad,
    lastDca,
    priceResolver,
    planReserve,
    planSpent,
    lastCheck,
    cancelled,
  ] = await Promise.all([
    read('getLevels'),
    read('gradLimits'),
    read('dcaLimits'),
    read('triggerProgressBps'),
    read('gradBoostBalance'),
    read('dcaBuybackBalance'),
    read('anchorPrice'),
    read('dcaEpoch'),
    read('paused'),
    read('lastGradExecution'),
    read('lastDcaExecution'),
    read('priceResolver'),
    read('dcaPlanReserve'),
    read('dcaPlanSpent'),
    read('lastDcaCheck'),
    read('dcaCancelled'),
  ]);
  const block = await publicClient.getBlock({ blockNumber });
  const progress = await publicClient
    .readContract({ address, abi, functionName: 'bondingProgressBps', blockNumber })
    .catch(() => null);
  const adapter = await read('marketAdapter');
  const quote = async (reserve: bigint, max: bigint) => {
    if (reserve === 0n) return 0n;
    return publicClient
      .simulateContract({
        address: adapter,
        abi: adapterAbi,
        functionName: 'quoteBuy',
        args: [token, reserve < max ? reserve : max],
        account: address,
        blockNumber,
      })
      .then(({ result }) => result)
      .catch(() => null);
  };
  const gradQuote = await quote(gradReserve, gradLimits[1]);
  const [priceBounds, dcaPreview] = await Promise.all([
    publicClient
      .readContract({
        address: priceResolver,
        abi: priceAbi,
        functionName: 'bounds',
        args: [token],
        blockNumber,
      })
      .catch(() => null),
    publicClient
      .readContract({ address, abi, functionName: 'previewDca', blockNumber })
      .catch(() => null),
  ]);
  const currentPrice = priceBounds?.[4] ? priceBounds[1] : null;
  const dipBps =
    currentPrice !== null && anchorPrice > 0n
      ? Number(((anchorPrice - currentPrice) * 10000n) / anchorPrice)
      : null;
  const dcaAmount = dcaPreview?.[0] ? dcaPreview[2] : 0n;
  const dcaQuote = dcaAmount > 0n ? await quote(dcaAmount, dcaLimits[1]) : 0n;
  const executions = snapshot.events.filter(
    (e) => e.address.toLowerCase() === address.toLowerCase(),
  );
  const totals = (name: string) =>
    executions
      .filter((e) => e.event === name)
      .reduce(
        (s, e) => ({
          ethSpent: s.ethSpent + BigInt(e.details?.ethIn || 0),
          tokensBought: s.tokensBought + BigInt(e.details?.tokensOut || 0),
        }),
        { ethSpent: 0n, tokensBought: 0n },
      );
  const levelState = await Promise.all(
    levels.map(async (l, i) => ({
      ...l,
      executed: await publicClient.readContract({
        address,
        abi,
        functionName: 'levelExecuted',
        args: [epoch, BigInt(i)],
        blockNumber,
      }),
      triggered: dipBps === null ? null : dipBps >= l.dropBps,
    })),
  );
  const limits = (l: readonly [bigint, bigint, number, number]) => ({
    minExecutionNative: l[0],
    maxExecutionNative: l[1],
    slippageBps: l[2],
    cooldownSeconds: l[3],
  });
  return {
    state: Date.now() - Date.parse(snapshot.updatedAt) > 120000 ? 'stale' : 'success',
    version: 2,
    creator: await read('creator'),
    router: address,
    block: snapshot.cursor,
    updatedAt: snapshot.updatedAt,
    paused,
    flow,
    gradBoost: {
      reserve: gradReserve,
      triggerProgressBps,
      progressBps: progress,
      limits: limits(gradLimits),
      status:
        gradQuote === null || gradQuote === 0n || progress === null
          ? 'WAITING FOR SUPPORTED PONS EXECUTION'
          : 'READY',
      eligible:
        !paused &&
        gradQuote !== null &&
        gradQuote > 0n &&
        progress !== null &&
        progress >= triggerProgressBps &&
        gradReserve >= gradLimits[0] &&
        (lastGrad === 0n || block.timestamp >= lastGrad + BigInt(gradLimits[3])),
      nextExecution: lastGrad + BigInt(gradLimits[3]),
      ...totals('GradBoostExecuted'),
    },
    dca: {
      reserve: dcaReserve,
      anchorPrice,
      epoch,
      levels: levelState,
      referenceMode: 'PREVIOUS_CHECK',
      currentPrice,
      dipBps,
      lastCheck,
      cancelled,
      eligible:
        !cancelled &&
        !paused &&
        !!dcaPreview?.[0] &&
        dcaAmount > 0n &&
        dcaQuote !== null &&
        dcaQuote > 0n,
      checkDue: !!dcaPreview?.[0],
      nextBuyAmount: dcaAmount,
      status: cancelled
        ? 'CANCELLED - CREATOR CLAIMS'
        : paused
          ? 'PAUSED'
          : currentPrice === null
            ? 'WAITING FOR CONFIRMED MARKET PRICES'
            : dcaPreview?.[0]
              ? dcaAmount > 0n
                ? 'DIP ELIGIBLE'
                : 'CHECK DUE - NO BUY'
              : 'WAITING FOR NEXT CHECK',
      automation: 'REQUIRES RUNNING KEEPER',
      priceResolver,
      limits: limits(dcaLimits),
      nextExecution: lastCheck + BigInt(dcaLimits[3]),
      lastExecution: lastDca,
      planReserve,
      planSpent,
      ...totals('DcaBuybackExecuted'),
    },
    executions: executions.filter((e) =>
      [
        'GradBoostExecuted',
        'DcaBuybackExecuted',
      ].includes(e.event),
    ),
  };
}
export type StrategiesResponse = Awaited<ReturnType<typeof getStrategies>>;
