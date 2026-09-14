import { isAddress, zeroAddress, type Address } from 'viem';

export const destinationOptions = [
  { value: '0', label: 'Creator', description: 'Claim fees in your connected wallet.', disabled: false },
  { value: '1', label: 'Treasury', description: 'Fund the wallet behind your project.', disabled: false },
  { value: '2', label: 'Custom wallet', description: 'Route to another recipient.', disabled: false },
  { value: '3', label: 'Buyback', description: 'Real market buyback into the ForgeBuybackVault.', disabled: false },
  {
    value: '4',
    label: 'Buy + burn',
    description: 'Market buy followed by permanent token burn.',
    disabled: false,
  },
  {
    value: '5',
    label: 'Liquidity',
    description: 'Accumulates creator fees into dedicated liquidity reserve.',
    disabled: false,
  },
  {
    value: '6',
    label: 'Holders',
    description: 'Funds claim-based Merkle holder rewards distribution.',
    disabled: false,
  },
];

export type Flow = { recipient: string; bps: number; kind: number }[];

export function validateFlow(flow: Flow, creator?: Address) {
  const errors: string[] = [];
  if (!flow.length || flow.length > 16) errors.push('Choose between 1 and 16 destinations.');
  if (
    flow.some((d) => !Number.isInteger(d.bps) || d.bps <= 0 || d.bps > 10000) ||
    flow.reduce((s, d) => s + d.bps, 0) !== 10000
  )
    errors.push('Allocate exactly 100% using positive percentages.');

  const directDestinations = flow.filter((d) => d.kind <= 2);
  if (directDestinations.some((d) => !isAddress(d.recipient) || d.recipient.toLowerCase() === zeroAddress))
    errors.push('Enter a valid, non-zero wallet for every direct payment destination.');
  if (new Set(directDestinations.map((d) => d.recipient.toLowerCase())).size !== directDestinations.length)
    errors.push('Each direct destination must have a different wallet.');

  // Protocol action destinations (kinds 3, 4, 5, 6) cannot be duplicated in the same flow
  const protocolKinds = flow.filter((d) => d.kind > 2).map((d) => d.kind);
  if (new Set(protocolKinds).size !== protocolKinds.length) {
    errors.push('Each automated fee destination (Buyback, Burn, Liquidity, Holders) can only be added once.');
  }

  if (flow.some((d) => d.kind < 0 || d.kind > 6))
    errors.push('This destination is not available.');
  if (
    flow.some(
      (d) => d.kind === 0 && (!creator || d.recipient.toLowerCase() !== creator.toLowerCase()),
    )
  )
    errors.push('The creator destination must be your connected wallet.');
  return errors;
}
