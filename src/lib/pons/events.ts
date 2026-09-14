import { parseEventLogs, type TransactionReceipt, type Address } from 'viem';
import { ponsAbi } from './abi';
import { requirePons } from './reads';
export function tokenFromReceipt(receipt: TransactionReceipt, creator: Address) {
  if (receipt.status !== 'success') throw new Error('Launch transaction reverted.');
  const logs = parseEventLogs({
    abi: ponsAbi,
    eventName: 'TokenLaunched',
    logs: receipt.logs.filter((l) => l.address.toLowerCase() === requirePons().toLowerCase()),
    strict: true,
  });
  const matched = logs.filter((l) => l.args.deployer.toLowerCase() === creator.toLowerCase());
  if (matched.length !== 1)
    throw new Error(
      'Could not identify a unique PONS launch event. Keep the transaction hash for recovery.',
    );
  return matched[0].args.token;
}
