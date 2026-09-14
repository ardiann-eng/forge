import { type Address, zeroAddress, keccak256, encodeAbiParameters } from 'viem';
import { publicClient } from '../client';
import { ponsAddress, ponsConfigured } from './config';
import { ponsAbi } from './abi';
import { getToken } from './reads';

export const marketCapabilities = {
  buyback: true,
  burn: true,
  liquidity: true,
  holders: true,
} as const;

export async function getMarketAddress() {
  return null;
}

export async function getBondingMarket(token: Address): Promise<Address | null> {
  try {
    const t = await getToken(token);
    return t.curve && t.curve !== zeroAddress ? t.curve : null;
  } catch {
    return null;
  }
}

export async function getMigratedPoolId(token: Address): Promise<`0x${string}` | null> {
  if (!ponsConfigured || !ponsAddress) return null;
  try {
    const t = await getToken(token);
    if (t.phase !== 2) return null; // 2 = PoolCreated

    const memeHook = await publicClient.readContract({
      address: ponsAddress,
      abi: ponsAbi,
      functionName: 'memeHook',
    });

    const c0 = zeroAddress < token ? zeroAddress : token;
    const c1 = zeroAddress < token ? token : zeroAddress;

    // keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))
    const poolId = keccak256(
      encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'address' },
          { type: 'uint24' },
          { type: 'int24' },
          { type: 'address' },
        ],
        [c0, c1, t.poolFee, t.tickSpacing, memeHook],
      ),
    );
    return poolId;
  } catch {
    return null;
  }
}
