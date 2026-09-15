import { type Address, type PublicClient } from 'viem';
import { abi } from './ForgeRouterV2.abi';
import { abi as marketAbi } from './PonsMarketAdapterV2.abi';

export async function prepareAutomatedFeeBatch(
  client: PublicClient,
  address: Address,
  account: Address,
  action: 'executeBuyback' | 'executeBurn',
) {
  const block = await client.getBlock();
  const reserveFunction = action === 'executeBuyback' ? 'buybackReserve' : 'burnReserve';
  const lastFunction = action === 'executeBuyback' ? 'lastBuybackExecution' : 'lastBurnExecution';
  const [token, adapter, limits, amount, lastExecution, creationTimestamp] = await Promise.all([
    client.readContract({ address, abi, functionName: 'token', blockNumber: block.number }),
    client.readContract({ address, abi, functionName: 'marketAdapter', blockNumber: block.number }),
    client.readContract({ address, abi, functionName: 'baseLimits', blockNumber: block.number }),
    client.readContract({ address, abi, functionName: reserveFunction, blockNumber: block.number }),
    client.readContract({ address, abi, functionName: lastFunction, blockNumber: block.number }),
    client.readContract({
      address,
      abi,
      functionName: 'creationTimestamp',
      blockNumber: block.number,
    }),
  ]);
  const intervalStart = lastExecution === 0n ? creationTimestamp : lastExecution;
  if (amount === 0n || block.timestamp < intervalStart + 300n) return null;
  const { result: quote } = await client.simulateContract({
    address: adapter,
    abi: marketAbi,
    functionName: 'quoteBuyForRecipient',
    args: [token, amount, address],
    account,
    blockNumber: block.number,
  });
  const minOut = (quote * BigInt(10000 - limits[2])) / 10000n;
  if (minOut === 0n) throw Error('Protected automated fee quote unavailable.');
  const { request } = await client.simulateContract({
    address,
    abi,
    functionName: action,
    args: [amount, minOut],
    account,
  });
  return { request, amount, minOut };
}

// Shared by wallet review and the opt-in standalone keeper. Never submits a transaction.
export async function prepareDcaCheck(client: PublicClient, address: Address, account: Address) {
  const block = await client.getBlock();
  const preview = await client.readContract({
    address,
    abi,
    functionName: 'previewDca',
    blockNumber: block.number,
  });
  if (!preview[0]) return null;
  const amount = preview[2];
  let minOut = 0n;
  if (amount > 0n) {
    const [token, adapter, limits] = await Promise.all([
      client.readContract({ address, abi, functionName: 'token', blockNumber: block.number }),
      client.readContract({
        address,
        abi,
        functionName: 'marketAdapter',
        blockNumber: block.number,
      }),
      client.readContract({ address, abi, functionName: 'dcaLimits', blockNumber: block.number }),
    ]);
    const { result: quote } = await client.simulateContract({
      address: adapter,
      abi: marketAbi,
      functionName: 'quoteBuyForRecipient',
      args: [token, amount, address],
      account,
      blockNumber: block.number,
    });
    minOut = (quote * BigInt(10000 - limits[2])) / 10000n;
    if (minOut === 0n) throw Error('Protected DCA quote unavailable.');
  }
  const deadline = block.timestamp + 180n;
  const { request } = await client.simulateContract({
    address,
    abi,
    functionName: 'checkDca',
    args: [minOut, deadline],
    account,
  });
  return { request, amount, minOut, deadline };
}

export async function prepareGradBoost(
  client: PublicClient,
  address: Address,
  account: Address,
) {
  const block = await client.getBlock();
  const [token, adapter, limits, reserve] = await Promise.all([
    client.readContract({ address, abi, functionName: 'token', blockNumber: block.number }),
    client.readContract({ address, abi, functionName: 'marketAdapter', blockNumber: block.number }),
    client.readContract({
      address,
      abi,
      functionName: 'gradLimits',
      blockNumber: block.number,
    }),
    client.readContract({
      address,
      abi,
      functionName: 'gradBoostBalance',
      blockNumber: block.number,
    }),
  ]);
  const amount = reserve > limits[1] ? limits[1] : reserve;
  if (amount < limits[0]) return null;
  const { result: quote } = await client.simulateContract({
    address: adapter,
    abi: marketAbi,
    functionName: 'quoteBuyForRecipient',
    args: [token, amount, address],
    account,
    blockNumber: block.number,
  });
  const minOut = (quote * BigInt(10000 - limits[2])) / 10000n;
  if (minOut === 0n) throw Error('Protected strategy quote unavailable.');
  const deadline = block.timestamp + 180n;
  const { request } = await client.simulateContract({
    address,
    abi,
    functionName: 'executeGradBoost',
    args: [amount, minOut, deadline],
    account,
  });
  return { request, amount, minOut, deadline };
}
