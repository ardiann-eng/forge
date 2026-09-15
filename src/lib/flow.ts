import { isAddress, zeroAddress, type Address } from 'viem';

export const destinationOptions = [
  {value:'0',label:'Creator',description:'Claim creator fees.',disabled:false},
  {value:'1',label:'Treasury',description:'Fund your project wallet.',disabled:false},
  {value:'3',label:'Buyback',description:'Buy real tokens into the buyback vault.',disabled:false},
  {value:'4',label:'Buy + burn',description:'Buy and permanently burn tokens.',disabled:false},
  {value:'6',label:'Holders',description:'Fund claim-based holder rewards.',disabled:false},
  {value:'7',label:'Grad Boost',description:'Accelerate Graduation',disabled:false},
  {value:'8',label:'DCA Buyback',description:'Buy the Dip Automatically',disabled:false},
];
export function destinationLabel(kind:number) {
  if(kind===2) return 'Custom wallet - LEGACY';
  if(kind===5) return 'Liquidity - LEGACY';
  return destinationOptions.find(d=>Number(d.value)===kind)?.label || 'Unknown route';
}

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
    errors.push('Each automated fee destination can only be added once.');
  }

  if (flow.some((d) => !Number.isInteger(d.kind) || ![0,1,3,4,6,7,8].includes(d.kind)))
    errors.push('This destination is not available.');
  if (
    flow.some(
      (d) => d.kind === 0 && (!creator || d.recipient.toLowerCase() !== creator.toLowerCase()),
    )
  )
    errors.push('The creator destination must be your connected wallet.');
  if(flow.some(d=>d.kind>=3 && d.recipient.toLowerCase()!==zeroAddress)) errors.push("Action recipients must be the zero address.");
  return errors;
}
