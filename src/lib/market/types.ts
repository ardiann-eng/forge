import type { Address, Hash } from 'viem';

export type TokenLifecycle =
  | 'BONDING'
  | 'GRADUATING'
  | 'GRADUATED'
  | 'MIGRATED'
  | 'RESCUED'
  | 'UNKNOWN';

export type DataState = 'loading' | 'success' | 'empty' | 'error' | 'stale';

export type MarketSource = 'pons' | 'dexscreener' | 'geckoterminal' | 'rpc';

export interface TokenMarketSnapshot {
  tokenAddress: Address;
  lifecycle: TokenLifecycle;

  priceNative?: bigint | string;
  priceUsd?: number;

  marketCapUsd?: number;
  fdvUsd?: number;
  liquidityUsd?: number;

  volume5m?: number;
  volume1h?: number;
  volume6h?: number;
  volume24h?: number;

  change5m?: number;
  change1h?: number;
  change6h?: number;
  change24h?: number;

  buys24h?: number;
  sells24h?: number;

  holders?: number;

  pairAddress?: Address;
  marketAddress?: Address;
  dexId?: string;

  bondingReserves?: string;
  bondingThreshold?: string;
  bondingProgress?: number;

  updatedAt: number;
  sources: MarketSource[];
}

export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint | string;
  description?: string;
  logo?: string;
  socials?: {
    twitter?: string;
    telegram?: string;
    discord?: string;
    website?: string;
    farcaster?: string;
  };
  deployer: Address;
  curve?: Address;
  launchedAt?: number;
}

export interface Candle {
  time: number; // Unix timestamp in seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ChartTimeframe = '1M' | '5M' | '15M' | '1H' | '4H' | '1D';
export type ChartRange = '1H' | '6H' | '24H' | '7D' | 'ALL';

export interface ForgeChartEvent {
  id: string;
  type:
    | 'BUYBACK'
    | 'BURN'
    | 'LIQUIDITY'
    | 'HOLDER_REWARD'
    | 'FEE_ROUTED'
    | 'GRADUATION'
    | 'MIGRATION';

  timestamp: number;
  blockNumber: bigint;
  txHash: Hash;

  nativeAmount?: bigint;
  tokenAmount?: bigint;

  priceUsdAtEvent?: number;
  destination?: Address;
  description?: string;
}

export interface LiveTrade {
  id: string;
  type: 'BUY' | 'SELL';
  timestamp: number;
  txHash: Hash;
  blockNumber: bigint;
  buyer?: Address;
  seller?: Address;
  recipient: Address;
  nativeAmount: bigint;
  tokenAmount: bigint;
  feeNative?: bigint;
  taxNative?: bigint;
  priceUsd?: number;
}

export interface LiveActivityItem {
  id: string;
  category: 'TRADE' | 'FORGE';
  type:
    | 'BUY'
    | 'SELL'
    | 'BUYBACK'
    | 'BURN'
    | 'LIQUIDITY'
    | 'HOLDER_REWARD'
    | 'FEE_ROUTED'
    | 'FEE_RECEIVED'
    | 'FEE_PROCESS'
    | 'CLAIM'
    | 'GRADUATION'
    | 'MIGRATION';
  timestamp: number;
  txHash: Hash;
  blockNumber: bigint;
  actor?: Address;
  recipient?: Address;
  nativeAmount?: bigint;
  tokenAmount?: bigint;
  priceUsd?: number;
  details?: string;
}
