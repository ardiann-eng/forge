import { type Address, type WalletClient } from 'viem';
import { publicClient } from '../client';
import { chain, writesEnabled } from '../config';
import { abi } from './ForgeRouterV2.abi';
import { abi as marketAbi } from './PonsMarketAdapterV2.abi';
export async function strategyTransaction(
  wallet: WalletClient,
  account: Address,
  address: Address,
  action:
    | 'executeGradBoost'
    | 'checkDca'
    | 'cancelDca'
    | 'claim',
  onHash: (hash: string) => void,
) {
  if (!writesEnabled || (await wallet.getChainId()) !== chain.id)
    throw Error('Writes disabled or wrong network.');
  let hash;
  if (action === 'cancelDca' || action === 'claim') {
    const { request } = await publicClient.simulateContract({
      address,
      abi,
      functionName: action,
      account,
    });
    hash = await wallet.writeContract({ ...request, chain });
  } else if (action === 'checkDca') {
    const { prepareDcaCheck } = await import('./dca-keeper');
    const prepared = await prepareDcaCheck(publicClient, address, account);
    if (!prepared) throw Error('DCA check is not due or confirmed prices are unavailable.');
    hash = await wallet.writeContract({ ...prepared.request, chain });
  } else {
    const [token, adapter, limits, reserve, block] = await Promise.all([
      publicClient.readContract({ address, abi, functionName: 'token' }),
      publicClient.readContract({ address, abi, functionName: 'marketAdapter' }),
      publicClient.readContract({
        address,
        abi,
        functionName: 'gradLimits',
      }),
      publicClient.readContract({
        address,
        abi,
        functionName: 'gradBoostBalance',
      }),
      publicClient.getBlock(),
    ]);
    const amount = reserve > limits[1] ? limits[1] : reserve;
    if (amount < limits[0])
      throw Error('Reserve is not ready for execution.');
    const { result: quote } = await publicClient.simulateContract({
      address: adapter,
      abi: marketAbi,
      functionName: 'quoteBuy',
      args: [token, amount],
      account: address,
    });
    const minOut = (quote * BigInt(10000 - limits[2])) / 10000n;
    if (minOut === 0n)
      throw Error('Waiting for supported PONS execution: protected quote unavailable.');
    const { request } = await publicClient.simulateContract({
      address,
      abi,
      functionName: action,
      args: [amount, minOut, block.timestamp + 180n],
      account,
    });
    hash = await wallet.writeContract({ ...request, chain });
  }
  onHash(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
  if (receipt.status !== 'success') throw Error('Strategy transaction reverted.');
  return receipt;
}
