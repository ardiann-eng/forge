import {
  decodeEventLog,
  type Address,
} from 'viem';
import { publicClient } from '../client';
import { abi as legacyAbi } from '../forge/ForgeRouter.abi';
import { abi as v2Abi } from '../forge/ForgeRouterV2.abi';
const routerAbi=[...legacyAbi,...v2Abi];
import { ponsAbi } from '../pons/abi';
import { requirePons } from '../pons/reads';
import type { Candle, ForgeChartEvent, LiveActivityItem } from './types';

export const EVENT_COLORS = {
  GRAD_BOOST:{badge:'#0891b2',text:'#ffffff',border:'#0891b2',label:'GRAD BOOST'},
  DCA_BUY:{badge:'#e879a6',text:'#000000',border:'#e879a6',label:'DCA BUY'},
  BUYBACK: {
    badge: '#a3e635',
    text: '#000000',
    border: '#65a30d',
    label: 'BUYBACK',
  },
  BURN: {
    badge: '#f97316',
    text: '#ffffff',
    border: '#ea580c',
    label: 'BURN',
  },
  LIQUIDITY: {
    badge: '#06b6d4',
    text: '#ffffff',
    border: '#0891b2',
    label: 'LEGACY LIQUIDITY',
  },
  HOLDER_REWARD: {
    badge: '#a855f7',
    text: '#ffffff',
    border: '#9333ea',
    label: 'HOLDERS',
  },
  FEE_ROUTED: {
    badge: '#10b981',
    text: '#ffffff',
    border: '#059669',
    label: 'ROUTED',
  },
  GRADUATION: {
    badge: '#09090b',
    text: '#a3e635',
    border: '#27272a',
    label: 'GRADUATED',
  },
  LAUNCH: {
    badge: '#0b0b0b',
    text: '#b7ff00',
    border: '#27272a',
    label: 'LAUNCH',
  },
  MIGRATION: {
    badge: '#3b82f6',
    text: '#ffffff',
    border: '#2563eb',
    label: 'MIGRATED',
  },
} as const;

export async function getForgeEventsForToken(
  tokenAddress: Address,
  routerAddress?: Address,
  fromBlock?: bigint,
): Promise<{
  chartEvents: ForgeChartEvent[];
  activityItems: LiveActivityItem[];
}> {
  const chartEvents: ForgeChartEvent[] = [];
  const activityItems: LiveActivityItem[] = [];

  try {
    const latest = await publicClient.getBlockNumber();
    const confirmations=BigInt(process.env.INDEXER_CONFIRMATIONS || 12);
    const head=latest>confirmations?latest-confirmations:0n;
    const from = fromBlock ?? (head > 50000n ? head - 50000n : 0n);

    // 1. Fetch router logs if router is known
    if (routerAddress) {
      const logs = await publicClient.getLogs({
        address: routerAddress,
        fromBlock: from,
        toBlock: head,
      });

      for (const log of logs) {
        try {
          const decoded = decodeEventLog({
            abi: routerAbi,
            data: log.data,
            topics: log.topics,
          });

          const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
          const timestamp = Number(block.timestamp);
          const txHash = log.transactionHash;
          const id = `${txHash}:${log.logIndex}`;

          if(['GradBoostExecuted','DcaBuybackExecuted'].includes(decoded.eventName)) {
            const args=decoded.args as {ethIn:bigint;tokensOut:bigint;progressBps?:bigint;level?:bigint};
            const type=decoded.eventName==='GradBoostExecuted'?'GRAD_BOOST':'DCA_BUY';
            const description=type==='GRAD_BOOST'?`Grad Boost at ${Number(args.progressBps)/100}% bonding`:`DCA level ${Number(args.level)+1}`;
            chartEvents.push({id,type,timestamp,blockNumber:log.blockNumber,txHash,nativeAmount:args.ethIn,tokenAmount:args.tokensOut,description});
            activityItems.push({id,type,category:'FORGE',timestamp,blockNumber:log.blockNumber,txHash,nativeAmount:args.ethIn,tokenAmount:args.tokensOut,details:description});
          } else if (decoded.eventName === 'BuybackExecuted') {
            const args = decoded.args as {
              token: Address;
              market: Address;
              ethIn: bigint;
              tokensOut: bigint;
              recipient: Address;
            };
            chartEvents.push({
              id,
              type: 'BUYBACK',
              timestamp,
              blockNumber: log.blockNumber,
              txHash,
              nativeAmount: args.ethIn,
              tokenAmount: args.tokensOut,
              destination: args.recipient,
              description: `Buyback: ${(Number(args.ethIn) / 1e18).toFixed(4)} ETH`,
            });
            activityItems.push({
              id,
              category: 'FORGE',
              type: 'BUYBACK',
              timestamp,
              txHash,
              blockNumber: log.blockNumber,
              recipient: args.recipient,
              nativeAmount: args.ethIn,
              tokenAmount: args.tokensOut,
              details: 'On-chain market buyback',
            });
          } else if (decoded.eventName === 'BuyAndBurnExecuted') {
            const args = decoded.args as {
              token: Address;
              ethIn: bigint;
              tokensBought: bigint;
              burnDestination: Address;
            };
            chartEvents.push({
              id,
              type: 'BURN',
              timestamp,
              blockNumber: log.blockNumber,
              txHash,
              nativeAmount: args.ethIn,
              tokenAmount: args.tokensBought,
              destination: args.burnDestination,
              description: `Burn: ${(Number(args.tokensBought) / 1e18).toLocaleString()} tokens`,
            });
            activityItems.push({
              id,
              category: 'FORGE',
              type: 'BURN',
              timestamp,
              txHash,
              blockNumber: log.blockNumber,
              recipient: args.burnDestination,
              nativeAmount: args.ethIn,
              tokenAmount: args.tokensBought,
              details: 'Buy and burn',
            });
          } else if (
            decoded.eventName === 'LiquidityProcessed' ||
            decoded.eventName === 'LiquidityReserveAdded'
          ) {
            const args = decoded.args as { token: Address; amount: bigint };
            chartEvents.push({
              id,
              type: 'LIQUIDITY',
              timestamp,
              blockNumber: log.blockNumber,
              txHash,
              nativeAmount: args.amount,
              description: `Legacy liquidity reserved: ${(Number(args.amount) / 1e18).toFixed(4)} ETH`,
            });
            activityItems.push({
              id,
              category: 'FORGE',
              type: 'LIQUIDITY',
              timestamp,
              txHash,
              blockNumber: log.blockNumber,
              nativeAmount: args.amount,
              details: 'Legacy liquidity reserve',
            });
          } else if (
            decoded.eventName === 'HolderRewardsFunded' ||
            decoded.eventName === 'HolderRewardReserveAdded'
          ) {
            const args = decoded.args as { token: Address; amount: bigint };
            chartEvents.push({
              id,
              type: 'HOLDER_REWARD',
              timestamp,
              blockNumber: log.blockNumber,
              txHash,
              nativeAmount: args.amount,
              description: `Holder Rewards: ${(Number(args.amount) / 1e18).toFixed(4)} ETH`,
            });
            activityItems.push({
              id,
              category: 'FORGE',
              type: 'HOLDER_REWARD',
              timestamp,
              txHash,
              blockNumber: log.blockNumber,
              nativeAmount: args.amount,
              details: 'Holder distribution',
            });
          } else if (decoded.eventName === 'FeesProcessed') {
            const args = decoded.args as { asset: Address; amount: bigint };
            chartEvents.push({
              id,
              type: 'FEE_ROUTED',
              timestamp,
              blockNumber: log.blockNumber,
              txHash,
              nativeAmount: args.amount,
              description: `Processed: ${(Number(args.amount) / 1e18).toFixed(4)} ETH`,
            });
            activityItems.push({
              id,
              category: 'FORGE',
              type: 'FEE_ROUTED',
              timestamp,
              txHash,
              blockNumber: log.blockNumber,
              nativeAmount: args.amount,
              details: 'Routed creator fees',
            });
          } else if (decoded.eventName === 'Claimed') {
            const args = decoded.args as {
              asset: Address;
              recipient: Address;
              amount: bigint;
            };
            activityItems.push({
              id,
              category: 'FORGE',
              type: 'CLAIM',
              timestamp,
              txHash,
              blockNumber: log.blockNumber,
              recipient: args.recipient,
              nativeAmount: args.amount,
              details: 'Fee claim executed',
            });
          }
        } catch {
          // Skip unparseable logs
        }
      }
    }

    // 2. Check PONS Factory graduation / migration events for this token
    try {
      const ponsAddress = requirePons();
      const factoryLogs = await publicClient.getLogs({
        address: ponsAddress,
        fromBlock: from,
        toBlock: head,
      });

      for (const log of factoryLogs) {
        try {
          const decoded = decodeEventLog({
            abi: ponsAbi,
            data: log.data,
            topics: log.topics,
          });

          if (
            (decoded.eventName === 'LaunchSwept' || decoded.eventName === 'PoolGraduated') &&
            decoded.args &&
            'token' in decoded.args &&
            (decoded.args.token as Address).toLowerCase() === tokenAddress.toLowerCase()
          ) {
            const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
            const timestamp = Number(block.timestamp);
            const txHash = log.transactionHash;
            const id = `${txHash}:${log.logIndex}`;

            chartEvents.push({
              id,
              type: 'GRADUATION',
              timestamp,
              blockNumber: log.blockNumber,
              txHash,
              description: 'Graduated: Bonding completed',
            });
            activityItems.push({
              id,
              category: 'FORGE',
              type: 'FEE_ROUTED',
              timestamp,
              txHash,
              blockNumber: log.blockNumber,
              details: 'PONS Bonding Curve Graduated',
            });
          }

          if (
            decoded.eventName === 'TokenLaunched' &&
            decoded.args &&
            'token' in decoded.args &&
            (decoded.args.token as Address).toLowerCase() === tokenAddress.toLowerCase()
          ) {
            const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
            const timestamp = Number(block.timestamp);
            const txHash = log.transactionHash;
            const id = `${txHash}:${log.logIndex}`;
            const args = decoded.args as { deployer: Address; curve: Address };

            chartEvents.push({
              id,
              type: 'LAUNCH',
              timestamp,
              blockNumber: log.blockNumber,
              txHash,
              description: 'Token launched on PONS bonding curve',
            });
            activityItems.push({
              id,
              category: 'FORGE',
              type: 'LAUNCH',
              timestamp,
              txHash,
              blockNumber: log.blockNumber,
              actor: args.deployer,
              details: 'Token launched on bonding curve',
            });
          }
        } catch {
          // Ignore unrelated
        }
      }
    } catch {
      // Ignore if PONS not configured
    }

    return {
      chartEvents: chartEvents.sort((a, b) => a.timestamp - b.timestamp),
      activityItems: activityItems.sort((a, b) => b.timestamp - a.timestamp),
    };
  } catch (err) {
    console.error('Failed to get FORGE events for token:', err);
    return { chartEvents: [], activityItems: [] };
  }
}

/**
 * Maps each ForgeChartEvent to the closest matching chart candle timestamp (UTC).
 * Ensures zero timezone skew.
 */
export function mapEventsToCandles(
  events: ForgeChartEvent[],
  candles: Candle[],
): Map<number, ForgeChartEvent[]> {
  const map = new Map<number, ForgeChartEvent[]>();
  if (candles.length === 0 || events.length === 0) return map;

  const candleTimes = candles.map((c) => c.time);

  for (const event of events) {
    // Find closest candle by timestamp
    let closestTime = candleTimes[0];
    let minDiff = Math.abs(event.timestamp - closestTime);

    for (let i = 1; i < candleTimes.length; i++) {
      const diff = Math.abs(event.timestamp - candleTimes[i]);
      if (diff < minDiff) {
        minDiff = diff;
        closestTime = candleTimes[i];
      }
    }

    const list = map.get(closestTime) || [];
    list.push(event);
    map.set(closestTime, list);
  }

  return map;
}
