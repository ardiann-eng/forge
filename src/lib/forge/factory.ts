import { parseEventLogs, type Address, type WalletClient } from 'viem';
import { publicClient } from '../client';
import { forgeFactory, forgeFactoryV2, chain, writesEnabled } from '../config';
import { abi } from './ForgeRouterFactory.abi';
import { abi as v2Abi } from './ForgeRouterFactoryV2.abi';
import { strategyArgs, validateStrategies, type Strategies } from '../strategies';
export { v2Abi };
export function requireFactoryV2() { if(!forgeFactoryV2) throw new Error('ForgeRouterFactoryV2 is not deployed or configured.'); return forgeFactoryV2; }
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
  strategies: Strategies,
) {
  if (!writesEnabled || (await wallet.getChainId()) !== chain.id)
    throw new Error('Writes disabled or wrong network.');
  const issues = [...validateFlow(flow, account),...validateStrategies(strategies,flow)];
  if (issues.length) throw new Error(issues.join(' '));
  const { request } = await publicClient.simulateContract({
    address: requireFactoryV2(),
    abi: v2Abi,
    functionName: 'createRouter',
    args: [flow.map((d) => ({ ...d, recipient: d.recipient as Address })), uri, strategyArgs(strategies)],
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
    logs: receipt.logs.filter((l) => [forgeFactory,forgeFactoryV2].some(f=>f?.toLowerCase()===l.address.toLowerCase())),
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
    address: await publicClient.readContract({address:router,abi: [{type:'function',name:'factory',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}] as const,functionName:'factory'}),
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
export async function getCreatorRouters(creator:Address) {
 const results=await Promise.all([forgeFactory,forgeFactoryV2].filter((f):f is Address=>!!f).map(address=>publicClient.readContract({address,abi,functionName:'getCreatorRouters',args:[creator]})));
 return results.flat();
}
export async function findTokenRouter(token:Address) {
 for(const address of [forgeFactoryV2,forgeFactory]) {
  if(!address) continue;
  const router=await publicClient.readContract({address,abi,functionName:'tokenToRouter',args:[token]});
  if(!/^0x0{40}$/i.test(router)) return router;
 }
 return null;
}
