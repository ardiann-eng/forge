import { publicClient } from '../src/lib/client';
import { verifyDeployment } from '../src/lib/pons/writes';
import { getLaunchConfig, requirePons } from '../src/lib/pons/reads';
import { ponsAbi } from '../src/lib/pons/abi';
import { writeFile } from 'node:fs/promises';
await verifyDeployment();
const config = await getLaunchConfig();
const forwarder = await publicClient.readContract({
  address: requirePons(),
  abi: ponsAbi,
  functionName: 'launchForwarder',
});
const block = await publicClient.getBlockNumber();
const result = {
  verifiedAt: new Date().toISOString(),
  block,
  chainId: await publicClient.getChainId(),
  factory: requirePons(),
  ...config,
  forwarder,
};
await writeFile(
  'docs/pons-live-verification.json',
  JSON.stringify(result, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n',
);
console.log(
  'PONS network, runtime hash and read interface verified. Report: docs/pons-live-verification.json',
);
