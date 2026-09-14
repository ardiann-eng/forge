import fs from 'node:fs';
import { keccak256 } from 'viem';
const r = JSON.parse(fs.readFileSync('research/pons-abi-response.json', 'utf8'));
if (r.status !== '1') throw new Error('Explorer did not return a verified ABI.');
const abi = JSON.parse(r.result);
fs.mkdirSync('src/lib/pons', { recursive: true });
fs.writeFileSync(
  'src/lib/pons/abi.ts',
  '// Retrieved from Blockscout verified ABI API; see manifest.json.\nexport const ponsAbi = ' +
    JSON.stringify(abi) +
    ' as const;\n',
);
const code = JSON.parse(
  fs.readFileSync('research/pons-bytecode.json', 'utf8').replace(/^\uFEFF/, ''),
).result;
const manifest = {
  chainId: 4663,
  address: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
  runtimeCodeHash: keccak256(code),
  abiHash: keccak256(new TextEncoder().encode(JSON.stringify(abi))),
  retrievedAt: new Date().toISOString(),
  sourceCommit: 'f2e069c1bf26bde0760446ecce3cf2501cf50846',
  abiSource:
    'https://robinhoodchain.blockscout.com/api?module=contract&action=getabi&address=0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
  source: 'https://github.com/ponsdotdev/ponsfamily',
  verification:
    'Explorer ABI and RPC runtime pinned. Reproducible compilation against deployed source remains outstanding.',
};
fs.writeFileSync('src/lib/pons/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
