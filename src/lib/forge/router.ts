import { type Address, type WalletClient } from 'viem';
import { publicClient } from '../client';
import { chain, writesEnabled, forgeFactoryV2 } from '../config';
import { abi } from './ForgeRouter.abi';
import { abi as v2Abi } from './ForgeRouterV2.abi';
import { formatEther } from 'viem';
import type { Strategies } from '../strategies';

export { abi as routerAbi };

export async function getRouter(address: Address, recipient?: Address) {
  const [
    creator,
    token,
    flow,
    received,
    processed,
    balance,
    claimable,
    metadataURI,
    buybackReserve,
    burnReserve,
    liquidityReserve,
    holderRewardReserve,
    totalETHUsedForBuyback,
    totalTokensBoughtBack,
    totalETHUsedForBurn,
    totalTokensBurned,
  ] = await Promise.all([
    publicClient.readContract({ address, abi, functionName: 'creator' }),
    publicClient.readContract({ address, abi, functionName: 'token' }),
    publicClient.readContract({ address, abi, functionName: 'getDestinations' }),
    publicClient.readContract({ address, abi, functionName: 'totalReceived' }),
    publicClient.readContract({ address, abi, functionName: 'totalProcessed' }),
    publicClient.getBalance({ address }),
    recipient
      ? publicClient.readContract({ address, abi, functionName: 'claimable', args: [recipient] })
      : Promise.resolve(null),
    publicClient.readContract({ address, abi, functionName: 'metadataURI' }),
    publicClient.readContract({ address, abi, functionName: 'buybackReserve' }).catch(() => 0n),
    publicClient.readContract({ address, abi, functionName: 'burnReserve' }).catch(() => 0n),
    publicClient.readContract({ address, abi, functionName: 'liquidityReserve' }).catch(() => 0n),
    publicClient.readContract({ address, abi, functionName: 'holderRewardReserve' }).catch(() => 0n),
    publicClient.readContract({ address, abi, functionName: 'totalETHUsedForBuyback' }).catch(() => 0n),
    publicClient.readContract({ address, abi, functionName: 'totalTokensBoughtBack' }).catch(() => 0n),
    publicClient.readContract({ address, abi, functionName: 'totalETHUsedForBurn' }).catch(() => 0n),
    publicClient.readContract({ address, abi, functionName: 'totalTokensBurned' }).catch(() => 0n),
  ]);

  const factory=await publicClient.readContract({address,abi,functionName:'factory'});
  let strategies:Strategies|null=null;
  if(factory.toLowerCase()===forgeFactoryV2?.toLowerCase()) {
    const [triggerProgressBps,grad,dca,levels]=await Promise.all([
      publicClient.readContract({address,abi:v2Abi,functionName:'triggerProgressBps'}),
      publicClient.readContract({address,abi:v2Abi,functionName:'gradLimits'}),
      publicClient.readContract({address,abi:v2Abi,functionName:'dcaLimits'}),
      publicClient.readContract({address,abi:v2Abi,functionName:'getLevels'}),
    ]);
    const limits=(l:readonly [bigint,bigint,number,number])=>({minExecutionNative:formatEther(l[0]),maxExecutionNative:formatEther(l[1]),slippageBps:l[2],cooldownSeconds:l[3]});
    strategies={triggerProgressBps,grad:limits(grad),dca:limits(dca),levels:levels.map(l=>({...l}))};
  }
  return {
    address,
    strategies,
    creator,
    token,
    flow,
    received,
    processed,
    balance,
    claimable,
    metadataURI,
    buybackReserve,
    burnReserve,
    liquidityReserve,
    holderRewardReserve,
    totalETHUsedForBuyback,
    totalTokensBoughtBack,
    totalETHUsedForBurn,
    totalTokensBurned,
  };
}

export async function routerTransaction(
  wallet: WalletClient,
  account: Address,
  address: Address,
  functionName: 'process' | 'claim' | 'collectFees',
  onHash: (hash: string) => void,
) {
  if (!writesEnabled || (await wallet.getChainId()) !== chain.id)
    throw new Error('Writes disabled or wrong network.');
  const { request } = await publicClient.simulateContract({ address, abi, functionName, account });
  const hash = await wallet.writeContract({ ...request, chain });
  onHash(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
  if (receipt.status !== 'success') throw new Error('Transaction reverted.');
  return receipt;
}

export async function executeBuybackTransaction(
  wallet: WalletClient,
  account: Address,
  address: Address,
  amount: bigint,
  minTokensOut: bigint,
  onHash: (hash: string) => void,
) {
  if (!writesEnabled || (await wallet.getChainId()) !== chain.id)
    throw new Error('Writes disabled or wrong network.');
  const { request } = await publicClient.simulateContract({
    address,
    abi,
    functionName: 'executeBuyback',
    args: [amount, minTokensOut],
    account,
  });
  const hash = await wallet.writeContract({ ...request, chain });
  onHash(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
  if (receipt.status !== 'success') throw new Error('Buyback reverted.');
  return receipt;
}

export async function executeBurnTransaction(
  wallet: WalletClient,
  account: Address,
  address: Address,
  amount: bigint,
  minTokensOut: bigint,
  onHash: (hash: string) => void,
) {
  if (!writesEnabled || (await wallet.getChainId()) !== chain.id)
    throw new Error('Writes disabled or wrong network.');
  const { request } = await publicClient.simulateContract({
    address,
    abi,
    functionName: 'executeBurn',
    args: [amount, minTokensOut],
    account,
  });
  const hash = await wallet.writeContract({ ...request, chain });
  onHash(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
  if (receipt.status !== 'success') throw new Error('Burn reverted.');
  return receipt;
}
