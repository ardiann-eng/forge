import type { Address, Hex } from 'viem';
export type LaunchInput = {
  name: string;
  ticker: string;
  description: string;
  imageURI: string;
  metadataURI: string;
  twitter: string;
  telegram: string;
  developerBuy: string;
  configId: bigint;
  router: Address;
  salt: Hex;
};
export type Lifecycle = 'BONDING' | 'GRADUATED' | 'MIGRATED' | 'RESCUED' | 'NOT AVAILABLE';
