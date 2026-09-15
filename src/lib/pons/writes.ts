import {
  encodeFunctionData,
  keccak256,
  parseEther,
  zeroAddress,
  type Address,
  type WalletClient,
  type Hex,
} from 'viem';
import { publicClient } from '../client';
import { chain, writesEnabled } from '../config';
import { ponsAbi } from './abi';
import { forwarderAbi } from './forwarder.abi';
import forwarder from './forwarder.json';
import { manifest } from './config';
import { requirePons } from './reads';
import type { LaunchInput } from './types';
export function developerBuyValue(value: string) {
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value))
    throw new Error('Developer buy must be a non-negative ETH amount with up to 18 decimals.');
  return parseEther(value);
}
export function validateLaunch(input: LaunchInput) {
  const issues: string[] = [];
  if (!input.name.trim() || !input.ticker.trim()) issues.push('Name and ticker are required.');
  if (
    !/^ipfs:\/\/[a-zA-Z0-9]{20,120}$/.test(input.metadataURI) ||
    !/^ipfs:\/\/[a-zA-Z0-9]{20,120}$/.test(input.imageURI)
  )
    issues.push('Upload real metadata before launching.');
  try {
    developerBuyValue(input.developerBuy || '0');
  } catch (e) {
    issues.push((e as Error).message);
  }
  return issues;
}
export async function verifyDeployment() {
  const address = requirePons();
  const [id, code] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getCode({ address }),
  ]);
  if (id !== manifest.chainId || !code || keccak256(code) !== manifest.runtimeCodeHash)
    throw new Error('PONS chain or runtime bytecode differs from the verified manifest.');
}
export async function verifyForwarder() {
  const address = forwarder.address as Address;
  const [code, current, factory] = await Promise.all([
    publicClient.getCode({ address }),
    publicClient.readContract({
      address: requirePons(),
      abi: ponsAbi,
      functionName: 'launchForwarder',
    }),
    publicClient.readContract({ address, abi: forwarderAbi, functionName: 'factory' }),
  ]);
  if (
    !code ||
    keccak256(code) !== forwarder.runtimeCodeHash ||
    current.toLowerCase() !== address.toLowerCase() ||
    factory.toLowerCase() !== requirePons().toLowerCase()
  )
    throw new Error('PONS atomic launch forwarder changed. Re-verification is required.');
  return address;
}
export async function prepareLaunch(input: LaunchInput, account: Address) {
  if (!writesEnabled) throw new Error('Mainnet writes are disabled.');
  const issues = validateLaunch(input);
  if (issues.length) throw new Error(issues.join(' '));
  await verifyDeployment();
  const factory = requirePons();
  const [fee, expectedEconomics] = await Promise.all([
    publicClient.readContract({ address: factory, abi: ponsAbi, functionName: 'launchFee' }),
    publicClient.readContract({
      address: factory,
      abi: ponsAbi,
      functionName: 'previewLaunchEconomics',
      args: [input.configId, zeroAddress],
    }),
  ]);
  const params = {
    name: input.name.trim(),
    symbol: input.ticker.trim(),
    logo: input.imageURI,
    description: input.description,
    socials: {
      twitter: input.twitter,
      telegram: input.telegram,
      discord: '',
      website: '',
      farcaster: '',
    },
    creatorFeeRecipient: input.router,
    creatorTaxBps: 300,
    buybackEnabled: false,
    expectedEconomics,
    salt: input.salt,
  };
  const buy = developerBuyValue(input.developerBuy || '0');
  let to: Address = factory;
  let data: Hex;
  let minimumTokens = 0n;
  let quotedTokens = 0n;
  const value = fee + buy;
  if (buy > 0n) {
    to = await verifyForwarder();
    // Quote the real atomic launch; no recreated curve formula. This call moves no funds.
    const quote = await publicClient.simulateContract({
      account,
      address: to,
      abi: forwarderAbi,
      functionName: 'launchAndBuy',
      args: [params, input.configId, zeroAddress, buy, 0n, account, []],
      value,
    });
    quotedTokens = quote.result[2];
    minimumTokens = (quotedTokens * 9900n) / 10000n;
    if (minimumTokens === 0n)
      throw new Error('Opening buy is too small for a protected minimum output.');
    const args = [params, input.configId, zeroAddress, buy, minimumTokens, account, []] as const;
    await publicClient.simulateContract({
      account,
      address: to,
      abi: forwarderAbi,
      functionName: 'launchAndBuy',
      args,
      value,
    });
    data = encodeFunctionData({ abi: forwarderAbi, functionName: 'launchAndBuy', args });
  } else {
    const args = [params, input.configId, zeroAddress, []] as const;
    await publicClient.simulateContract({
      account,
      address: factory,
      abi: ponsAbi,
      functionName: 'launchToken',
      args,
      value,
    });
    data = encodeFunctionData({ abi: ponsAbi, functionName: 'launchToken', args });
  }
  const gas = await publicClient.estimateGas({ account, to, data, value });
  return {
    account,
    to,
    data,
    gas,
    value,
    fee,
    buy,
    minimumTokens,
    quotedTokens,
    preparedAt: Date.now(),
  };
}
export async function launchToken(
  wallet: WalletClient,
  prepared: Awaited<ReturnType<typeof prepareLaunch>>,
) {
  if (!writesEnabled || Date.now() - prepared.preparedAt > 120_000)
    throw new Error('Review expired. Prepare the transaction again.');
  if ((await wallet.getChainId()) !== chain.id) throw new Error('Switch to the reviewed network.');
  const addresses = await wallet.getAddresses();
  if (!addresses.some((a) => a.toLowerCase() === prepared.account.toLowerCase()))
    throw new Error('The connected account changed. Review again.');
  await verifyDeployment();
  if (prepared.buy > 0n) await verifyForwarder();
  // Re-simulate exact reviewed calldata. Never silently reprice or replace it.
  await publicClient.call({
    account: prepared.account,
    to: prepared.to,
    data: prepared.data,
    value: prepared.value,
  });
  return wallet.sendTransaction({
    account: prepared.account,
    chain,
    to: prepared.to,
    data: prepared.data,
    value: prepared.value,
  });
}
