import { isAddress, zeroAddress, type Address } from 'viem';
import {
  Sparkles,
  RefreshCw,
  Flame,
  Droplets,
  Users,
  Wallet,
  GitBranch,
  TrendingUp,
  ShieldCheck,
  CheckCircle2,
  Sliders,
  type LucideIcon,
} from 'lucide-react';
import type { Activity, IndexedToken } from '@/lib/indexer/types';
import type { TokenMetadata } from './types';

export type ActivityAccent = 'lime' | 'orange' | 'cyan' | 'violet' | 'neutral';

export interface NormalizedActivity {
  id: string;
  rawEvent: string;
  type:
    | 'LAUNCH'
    | 'FLOW_CREATED'
    | 'TOKEN_BOUND'
    | 'FLOW_CONFIGURED'
    | 'BUYBACK'
    | 'BUY_BURN'
    | 'FEES_ROUTED'
    | 'FEES_RECEIVED'
    | 'CLAIM'
    | 'HOLDER_REWARDS'
    | 'LIQUIDITY'
    | 'GRADUATION'
    | 'MIGRATION'
    | 'GOVERNANCE'
    | 'OTHER';
  title: string;
  tokenAddress?: Address;
  tokenSymbol?: string;
  tokenName?: string;
  tokenLogo?: string;
  primaryValue?: string;
  secondaryValue?: string;
  description: string;
  timestamp: number;
  timeAgo: string;
  fullDate: string;
  txHash: string;
  blockNumber: string;
  icon: LucideIcon;
  accent: ActivityAccent;
}

export function formatRelativeTime(timestampSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const seconds = Math.max(0, now - timestampSec);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function formatFullUtcDate(timestampSec: number): string {
  const d = new Date(timestampSec * 1000);
  return d.toUTCString();
}

export interface ActivityNormalizationContext {
  tokens?: IndexedToken[];
  metadata?: Record<string, TokenMetadata>;
  allEvents?: Activity[];
  connectedWallet?: Address;
}

/**
 * Normalizes raw blockchain event logs into human-readable launchpad feed items.
 * ZERO fake data: all metrics derived from real on-chain parameters.
 */
export function normalizeForgeActivity(
  event: Activity,
  context?: ActivityNormalizationContext,
): NormalizedActivity {
  const timestamp = Number(event.timestamp) || Math.floor(Date.now() / 1000);
  const timeAgo = formatRelativeTime(timestamp);
  const fullDate = formatFullUtcDate(timestamp);

  // 1. Identify associated token
  let tokenAddress: Address | undefined = event.token;
  if (!tokenAddress && event.router && context?.tokens) {
    const match = context.tokens.find(
      (t) => t.router.toLowerCase() === event.router?.toLowerCase(),
    );
    if (match) tokenAddress = match.token;
  }

  // 2. Token details from metadata or indexer
  let tokenSymbol: string | undefined;
  let tokenName: string | undefined;
  let tokenLogo: string | undefined;

  if (tokenAddress) {
    const meta = context?.metadata?.[tokenAddress.toLowerCase()];
    if (meta) {
      tokenSymbol = meta.symbol;
      tokenName = meta.name;
      tokenLogo = meta.logo;
    } else if (context?.tokens) {
      const match = context.tokens.find(
        (t) => t.token.toLowerCase() === tokenAddress?.toLowerCase(),
      );
      if (match) {
        tokenSymbol = match.symbol;
        tokenName = match.name;
      }
    }
  }

  const ticker = tokenSymbol ? `$${tokenSymbol}` : undefined;

  // 3. Format primary native amount if present
  let formattedEthAmount: string | undefined;
  if (event.amount) {
    try {
      const bn = BigInt(event.amount);
      if (event.asset && isAddress(event.asset) && event.asset.toLowerCase() !== zeroAddress) {
        formattedEthAmount = `${event.amount} units`;
      } else {
        formattedEthAmount = `${(Number(bn) / 1e18).toFixed(4)} ETH`;
      }
    } catch {
      // ignore
    }
  }

  // 4. Calculate deterministic sequence for TokenLaunched events
  let launchNumber: number | null = null;
  if (event.event === 'TokenLaunched' && context?.allEvents) {
    const launches = context.allEvents
      .filter((e) => e.event === 'TokenLaunched')
      .sort((a, b) => {
        const blockDiff = BigInt(a.block) - BigInt(b.block);
        if (blockDiff !== 0n) return Number(blockDiff);
        return a.logIndex - b.logIndex;
      });
    const idx = launches.findIndex((l) => l.id === event.id);
    if (idx !== -1) {
      launchNumber = idx + 1;
    }
  }

  // 5. Map technical event to product language
  switch (event.event) {
    case 'TokenLaunched': {
      const title = launchNumber ? `TOKEN LAUNCH #${launchNumber}` : ticker ? `${ticker} LAUNCHED` : 'TOKEN LAUNCHED';
      return {
        id: event.id,
        rawEvent: event.event,
        type: 'LAUNCH',
        title,
        tokenAddress,
        tokenSymbol,
        tokenName,
        tokenLogo,
        description: 'Launched on Robinhood Chain · Creator fee flow active',
        timestamp,
        timeAgo,
        fullDate,
        txHash: event.hash,
        blockNumber: event.block,
        icon: Sparkles,
        accent: 'lime',
      };
    }

    case 'RouterCreated': {
      const title = ticker ? `${ticker} FLOW ACTIVATED` : 'FLOW ACTIVATED';
      return {
        id: event.id,
        rawEvent: event.event,
        type: 'FLOW_CREATED',
        title,
        tokenAddress,
        tokenSymbol,
        tokenName,
        tokenLogo,
        description: 'Creator-fee routing rules deployed on-chain',
        timestamp,
        timeAgo,
        fullDate,
        txHash: event.hash,
        blockNumber: event.block,
        icon: Sliders,
        accent: 'lime',
      };
    }

    case 'TokenBound': {
      return {
        id: event.id,
        rawEvent: event.event,
        type: 'TOKEN_BOUND',
        title: 'TOKEN BOUND TO FLOW',
        tokenAddress,
        tokenSymbol,
        tokenName,
        tokenLogo,
        description: 'Creator fees now route through FORGE',
        timestamp,
        timeAgo,
        fullDate,
        txHash: event.hash,
        blockNumber: event.block,
        icon: GitBranch,
        accent: 'lime',
      };
    }

    case 'AdaptersConfigured': {
      return {
        id: event.id,
        rawEvent: event.event,
        type: 'FLOW_CONFIGURED',
        title: 'FLOW CONFIGURED',
        tokenAddress,
        tokenSymbol,
        tokenName,
        tokenLogo,
        description: 'Execution adapters linked to FORGE ecosystem',
        timestamp,
        timeAgo,
        fullDate,
        txHash: event.hash,
        blockNumber: event.block,
        icon: Sliders,
        accent: 'neutral',
      };
    }

    case 'OwnershipTransferred': {
      return {
        id: event.id,
        rawEvent: event.event,
        type: 'GOVERNANCE',
        title: 'GOVERNANCE INITIALIZED',
        tokenAddress,
        tokenSymbol,
        tokenName,
        tokenLogo,
        description: 'Factory ownership verified and initialized',
        timestamp,
        timeAgo,
        fullDate,
        txHash: event.hash,
        blockNumber: event.block,
        icon: ShieldCheck,
        accent: 'neutral',
      };
    }

    case 'FeesProcessed': {
      return {
        id: event.id,
        rawEvent: event.event,
        type: 'FEES_ROUTED',
        title: 'FEES ROUTED',
        tokenAddress,
        tokenSymbol,
        tokenName,
        tokenLogo,
        primaryValue: formattedEthAmount,
        description: formattedEthAmount
          ? `${formattedEthAmount} routed across configured destinations`
          : 'Creator fees routed across configured destinations',
        timestamp,
        timeAgo,
        fullDate,
        txHash: event.hash,
        blockNumber: event.block,
        icon: RefreshCw,
        accent: 'lime',
      };
    }

    case 'FeesReceived': {
      return {
        id: event.id,
        rawEvent: event.event,
        type: 'FEES_RECEIVED',
        title: 'FEES RECEIVED',
        tokenAddress,
        tokenSymbol,
        tokenName,
        tokenLogo,
        primaryValue: formattedEthAmount,
        description: formattedEthAmount
          ? `${formattedEthAmount} creator revenue received in dedicated router`
          : 'Creator revenue received in dedicated router',
        timestamp,
        timeAgo,
        fullDate,
        txHash: event.hash,
        blockNumber: event.block,
        icon: Droplets,
        accent: 'lime',
      };
    }

    case 'BuybackExecuted': {
      return {
        id: event.id,
        rawEvent: event.event,
        type: 'BUYBACK',
        title: 'BUYBACK',
        tokenAddress,
        tokenSymbol,
        tokenName,
        tokenLogo,
        primaryValue: formattedEthAmount,
        description: formattedEthAmount
          ? `${formattedEthAmount} deployed for on-chain market buyback`
          : 'On-chain market buyback executed into vault',
        timestamp,
        timeAgo,
        fullDate,
        txHash: event.hash,
        blockNumber: event.block,
        icon: RefreshCw,
        accent: 'lime',
      };
    }

    case 'BuyAndBurnExecuted': {
      return {
        id: event.id,
        rawEvent: event.event,
        type: 'BUY_BURN',
        title: 'BUY + BURN',
        tokenAddress,
        tokenSymbol,
        tokenName,
        tokenLogo,
        primaryValue: formattedEthAmount,
        description: formattedEthAmount
          ? `${formattedEthAmount} used for buy and permanent token burn`
          : 'Market buy followed by permanent native token burn',
        timestamp,
        timeAgo,
        fullDate,
        txHash: event.hash,
        blockNumber: event.block,
        icon: Flame,
        accent: 'orange',
      };
    }

    case 'Claimed': {
      const isYou =
        context?.connectedWallet &&
        event.creator &&
        event.creator.toLowerCase() === context.connectedWallet.toLowerCase();

      const claimantText = isYou
        ? 'You'
        : event.creator
          ? `${event.creator.slice(0, 6)}…${event.creator.slice(-4)}`
          : 'Creator';

      const desc = formattedEthAmount
        ? `${claimantText} claimed ${formattedEthAmount}`
        : `Fee share claimed by ${claimantText}`;

      return {
        id: event.id,
        rawEvent: event.event,
        type: 'CLAIM',
        title: isYou ? 'YOU CLAIMED FEES' : 'CREATOR CLAIM',
        tokenAddress,
        tokenSymbol,
        tokenName,
        tokenLogo,
        primaryValue: formattedEthAmount,
        description: desc,
        timestamp,
        timeAgo,
        fullDate,
        txHash: event.hash,
        blockNumber: event.block,
        icon: Wallet,
        accent: 'neutral',
      };
    }

    case 'HolderRewardsFunded':
    case 'HolderRewardReserveAdded': {
      return {
        id: event.id,
        rawEvent: event.event,
        type: 'HOLDER_REWARDS',
        title: 'HOLDER REWARDS',
        tokenAddress,
        tokenSymbol,
        tokenName,
        tokenLogo,
        primaryValue: formattedEthAmount,
        description: formattedEthAmount
          ? `${formattedEthAmount} allocated to community holder rewards`
          : 'Allocated to community holder rewards',
        timestamp,
        timeAgo,
        fullDate,
        txHash: event.hash,
        blockNumber: event.block,
        icon: Users,
        accent: 'violet',
      };
    }

    case 'LiquidityProcessed':
    case 'LiquidityReserveAdded': {
      return {
        id: event.id,
        rawEvent: event.event,
        type: 'LIQUIDITY',
        title: 'LIQUIDITY RESERVED',
        tokenAddress,
        tokenSymbol,
        tokenName,
        tokenLogo,
        primaryValue: formattedEthAmount,
        description: formattedEthAmount
          ? `${formattedEthAmount} held in liquidity reserve until graduation`
          : 'Held in liquidity reserve until graduation',
        timestamp,
        timeAgo,
        fullDate,
        txHash: event.hash,
        blockNumber: event.block,
        icon: Droplets,
        accent: 'cyan',
      };
    }

    case 'LaunchSwept':
    case 'PoolGraduated': {
      return {
        id: event.id,
        rawEvent: event.event,
        type: 'GRADUATION',
        title: 'TOKEN GRADUATED',
        tokenAddress,
        tokenSymbol,
        tokenName,
        tokenLogo,
        description: 'Bonding curve threshold reached · Swept to DEX pool',
        timestamp,
        timeAgo,
        fullDate,
        txHash: event.hash,
        blockNumber: event.block,
        icon: TrendingUp,
        accent: 'lime',
      };
    }

    default: {
      const cleanTitle = event.event.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
      return {
        id: event.id,
        rawEvent: event.event,
        type: 'OTHER',
        title: cleanTitle,
        tokenAddress,
        tokenSymbol,
        tokenName,
        tokenLogo,
        primaryValue: formattedEthAmount,
        description: formattedEthAmount
          ? `${formattedEthAmount} on-chain value moved`
          : 'On-chain protocol action executed',
        timestamp,
        timeAgo,
        fullDate,
        txHash: event.hash,
        blockNumber: event.block,
        icon: CheckCircle2,
        accent: 'neutral',
      };
    }
  }
}
