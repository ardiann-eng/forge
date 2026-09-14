import { type Address, erc20Abi, parseAbi } from 'viem';
import { publicClient } from '../client';
import { ponsAddress, ponsConfigured } from './config';
import { ponsAbi } from './abi';
import type { Lifecycle } from './types';
export function requirePons() {
  if (!ponsConfigured || !ponsAddress)
    throw new Error('Verified PONS deployment is not configured.');
  return ponsAddress;
}
export async function getLaunchConfig() {
  const address = requirePons();
  const [count, fee, escrow] = await Promise.all([
    publicClient.readContract({ address, abi: ponsAbi, functionName: 'launchConfigCount' }),
    publicClient.readContract({ address, abi: ponsAbi, functionName: 'launchFee' }),
    publicClient.readContract({ address, abi: ponsAbi, functionName: 'feeEscrow' }),
  ]);
  if (count > 100n) throw new Error('Launch configuration list exceeds review limit.');
  const configs = await Promise.all(
    Array.from({ length: Number(count) }, async (_, i) => ({
      id: BigInt(i),
      ...(await publicClient.readContract({
        address,
        abi: ponsAbi,
        functionName: 'getLaunchConfig',
        args: [BigInt(i)],
      })),
    })),
  );
  return { fee, escrow, configs: configs.filter((c) => c.enabled) };
}
export async function getToken(token: Address) {
  const launch = await publicClient.readContract({
    address: requirePons(),
    abi: ponsAbi,
    functionName: 'getLaunchedToken',
    args: [token],
  });
  if (!launch.exists)
    throw new Error('This address is not registered by the configured PONS factory.');
  const [name, symbol] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'name' }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
  ]);
  return { ...launch, name, symbol };
}
export function phaseLabel(phase: number): Lifecycle {
  return (['BONDING', 'GRADUATED', 'MIGRATED', 'RESCUED'] as const)[phase] ?? 'NOT AVAILABLE';
}
export async function getTokenStatus(token: Address) {
  return phaseLabel((await getToken(token)).phase);
}
const curveReads = parseAbi(['function realQuoteReserve() view returns (uint256)']); // Official ILaunchpadV2.sol.
export async function getBondingProgress(token: Address) {
  const t = await getToken(token);
  if (t.phase !== 0 || t.graduationThreshold === 0n) return null;
  const reserve = await publicClient.readContract({
    address: t.curve,
    abi: curveReads,
    functionName: 'realQuoteReserve',
  });
  return Math.min(100, Number((reserve * 10000n) / t.graduationThreshold) / 100);
}
export async function getCreatorFeeState(token: Address) {
  const t = await getToken(token);
  return { receiver: t.creatorFeeRecipient };
}
