import type { Address, Log } from 'viem';
import type { publicClient } from '../client';

type ChainClient = typeof publicClient;
// Confirmed (non-pending) logs: blockNumber and transactionHash are non-null.
type ConfirmedLog = Log<bigint, number, false>;

function isRangeLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /range|too many|exceed|limit/i.test(msg);
}

/**
 * eth_getLogs with adaptive range splitting. Providers (e.g. Chainstack)
 * reject wide block ranges; on a range-limit error the window is halved
 * recursively until every chunk succeeds. Results stay time-ordered.
 */
export async function getLogsChunked(
  client: ChainClient,
  params: { address: Address },
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ConfirmedLog[]> {
  try {
    const logs = await client.getLogs({
      address: params.address,
      fromBlock,
      toBlock,
    });
    return logs as ConfirmedLog[];
  } catch (err) {
    if (isRangeLimitError(err) && toBlock - fromBlock > 1n) {
      const mid = (fromBlock + toBlock) / 2n;
      const [first, second] = await Promise.all([
        getLogsChunked(client, params, fromBlock, mid),
        getLogsChunked(client, params, mid + 1n, toBlock),
      ]);
      return [...first, ...second];
    }
    throw err;
  }
}
