import { defineChain, isAddress, type Address } from 'viem';
const id = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 4663);
export const chain = defineChain({
  id,
  name: process.env.NEXT_PUBLIC_PONS_NETWORK || 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://robinhoodchain.blockscout.com',
    },
  },
  testnet: id !== 4663,
});
export function addressOrNull(value?: string): Address | null {
  return value && isAddress(value) && !/^0x0{40}$/i.test(value) ? value : null;
}
export const forgeFactory = addressOrNull(process.env.NEXT_PUBLIC_FORGE_ROUTER_FACTORY);
export const deploymentBlock = process.env.NEXT_PUBLIC_FORGE_DEPLOYMENT_BLOCK
  ? BigInt(process.env.NEXT_PUBLIC_FORGE_DEPLOYMENT_BLOCK)
  : null;
// Only the verified manifest network is eligible; an arbitrary ID is never treated as a supported testnet.
export const writesEnabled = chain.id === 4663 && process.env.NEXT_PUBLIC_ENABLE_MAINNET === 'true';
export function explorer(kind: 'address' | 'tx' | 'block', value: string) {
  return `${chain.blockExplorers.default.url}/${kind}/${value}`;
}
