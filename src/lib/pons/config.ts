import { addressOrNull, chain } from '../config';
import manifest from './manifest.json';
export const ponsAddress = addressOrNull(
  process.env.NEXT_PUBLIC_PONS_LAUNCH_CONTRACT || manifest.address,
);
export const ponsConfigured =
  chain.id === manifest.chainId && ponsAddress?.toLowerCase() === manifest.address.toLowerCase();
export const integrationLimitations = [
  'No verified PONS testnet deployment is available.',
  'PONS launch interfaces have no on-chain deadline parameter; review expires locally after two minutes.',
  'Buyback, burn, liquidity and holder distribution adapters are unavailable.',
];
export { manifest };
