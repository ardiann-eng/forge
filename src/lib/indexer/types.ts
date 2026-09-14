import type { Address } from 'viem';
export type Activity = {
  id: string;
  event: string;
  address: Address;
  token?: Address;
  router?: Address;
  creator?: Address;
  amount?: string;
  asset?: Address;
  block: string;
  blockHash: string;
  timestamp: string;
  hash: string;
  logIndex: number;
};
export type IndexedToken = {
  token: Address;
  router: Address;
  creator: Address;
  name?: string;
  symbol?: string;
  phase?: number;
};
export type Snapshot = {
  chainId: number;
  factory: Address;
  cursor: string;
  cursorHash: string;
  updatedAt: string;
  caughtUp: boolean;
  events: Activity[];
  tokens: IndexedToken[];
  routers: Address[];
  stats: { received: string; processed: string } | null;
};
export interface IndexStore {
  load(): Promise<Snapshot | null>;
  save(snapshot: Snapshot): Promise<void>;
}
