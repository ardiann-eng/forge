import { createPublicClient, http } from 'viem';
import { chain } from './config';
export const publicClient = createPublicClient({
  chain,
  transport: http(chain.rpcUrls.default.http[0], { timeout: 15_000, retryCount: 1 }),
  batch: { multicall: false },
});
