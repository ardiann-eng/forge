import { parseEventLogs, type Address, type WalletClient } from 'viem';
import { publicClient } from '../client';
import { forgeFactory, chain, writesEnabled } from '../config';
import { abi } from './ForgeRouterFactory.abi';
import { validateFlow, type Flow } from '../flow';
export { abi as factoryAbi };
export function requireFactory() {
  if (!forgeFactory) throw new Error('ForgeRouterFactory is not deployed or configured.');
  return forgeFactory;
}
export async function createRouter(
  wallet: WalletClient,
  account: Address,
  flow: Flow,
  uri: string,
  onHash: (hash: string) => void,
) {
  if (!writesEnabled || (await wallet.getChainId()) !== chain.id)
    throw new Error('Writes disabled or wrong network.');
  const issues = validateFlow(flow, account);
  if (issues.length) throw new Error(issues.join(' '));
  const { request } = await publicClient.simulateContract({
    address: requireFactory(),
    abi,
    functionName: 'createRouter',
    args: [flow.map((d) => ({ ...d, recipient: d.recipient as Address })), uri],
    account,
  });
  const hash = await wallet.writeContract({ ...request, chain });
  onHash(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
  return routerFromReceipt(receipt, account);
}
export function routerFromReceipt(
  receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>,
  account: Address,
) {
  if (receipt.status !== 'success') throw new Error('Router deployment reverted.');
  const found = parseEventLogs({
    abi,
    eventName: 'RouterCreated',
    logs: receipt.logs.filter((l) => l.address.toLowerCase() === requireFactory().toLowerCase()),
  }).find((l) => l.args.creator.toLowerCase() === account.toLowerCase());
  if (!found) throw new Error('Router event missing. Recover using your transaction hash.');
  return found.args.router;
}
export async function bindToken(
  wallet: WalletClient,
  account: Address,
  router: Address,
  token: Address,
  onHash: (hash: string) => void,
) {
  if (!writesEnabled || (await wallet.getChainId()) !== chain.id)
    throw new Error('Writes disabled or wrong network.');
  const { request } = await publicClient.simulateContract({
    address: requireFactory(),
    abi,
    functionName: 'bindToken',
    args: [router, token],
    account,
  });
  const hash = await wallet.writeContract({ ...request, chain });
  onHash(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
  if (receipt.status !== 'success') throw new Error('Token binding reverted.');
  return receipt;
}
export async function getCreatorRouters(creator: Address) {
  return publicClient.readContract({
    address: requireFactory(),
    abi,
    functionName: 'getCreatorRouters',
    args: [creator],
  });
}
