import type { Address } from 'viem';
import { getRouter } from './router';
export async function getStats(routers: Address[]) {
  const rows = await Promise.all(routers.map((r) => getRouter(r)));
  return {
    received: rows.reduce((s, r) => s + r.received, 0n),
    processed: rows.reduce((s, r) => s + r.processed, 0n),
  };
}
