import { type Address, type WalletClient } from 'viem';
import { publicClient } from '../client';
import { chain, forgeAutomationExecutor, writesEnabled } from '../config';
import type { Flow } from '../flow';
import { abi } from './ForgeAutomationExecutor.abi';

export const AUTOMATED_KINDS = new Set([3, 4, 7, 8]);

export function flowNeedsAutomation(flow: Flow) {
  return flow.some((destination) => AUTOMATED_KINDS.has(destination.kind));
}

export function requireAutomationExecutor() {
  if (!forgeAutomationExecutor)
    throw new Error('FORGE automation executor is not deployed or configured.');
  return forgeAutomationExecutor;
}

export async function getAutomationBalance(router: Address) {
  if (!forgeAutomationExecutor) return 0n;
  return publicClient.readContract({
    address: forgeAutomationExecutor,
    abi,
    functionName: 'automationBalance',
    args: [router],
  });
}

export async function getAutomationState(router: Address) {
  if (!forgeAutomationExecutor) return { balance: 0n, paused: true };
  const [balance, paused] = await Promise.all([
    getAutomationBalance(router),
    publicClient.readContract({
      address: forgeAutomationExecutor,
      abi,
      functionName: 'automationPaused',
      args: [router],
    }),
  ]);
  return { balance, paused };
}

export async function fundAutomation(
  wallet: WalletClient,
  account: Address,
  router: Address,
  amount: bigint,
  onHash: (hash: string) => void,
) {
  if (!writesEnabled || (await wallet.getChainId()) !== chain.id)
    throw new Error('Writes disabled or wrong network.');
  if (amount <= 0n) throw new Error('Automation gas deposit must be greater than zero.');
  const { request } = await publicClient.simulateContract({
    address: requireAutomationExecutor(),
    abi,
    functionName: 'fund',
    args: [router],
    account,
    value: amount,
  });
  const hash = await wallet.writeContract({ ...request, chain });
  onHash(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
  if (receipt.status !== 'success') throw new Error('Automation funding reverted.');
  return receipt;
}

export async function updateAutomation(
  wallet: WalletClient,
  account: Address,
  router: Address,
  action: 'pause' | 'resume' | 'withdraw',
  onHash: (hash: string) => void,
) {
  if (!writesEnabled || (await wallet.getChainId()) !== chain.id)
    throw new Error('Writes disabled or wrong network.');
  const address = requireAutomationExecutor();
  let hash;
  if (action === 'withdraw') {
    const { request } = await publicClient.simulateContract({
      address,
      abi,
      functionName: 'withdraw',
      args: [router, await getAutomationBalance(router), account],
      account,
    });
    hash = await wallet.writeContract({ ...request, chain });
  } else {
    const { request } = await publicClient.simulateContract({
      address,
      abi,
      functionName: 'setPaused',
      args: [router, action === 'pause'],
      account,
    });
    hash = await wallet.writeContract({ ...request, chain });
  }
  onHash(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
  if (receipt.status !== 'success') throw new Error('Automation update reverted.');
  return receipt;
}
