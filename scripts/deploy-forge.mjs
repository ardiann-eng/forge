import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createPublicClient, http, isAddress, parseAbi } from 'viem';
import manifest from '../src/lib/pons/manifest.json' with { type: 'json' };

const chainId = 4663;
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const explorerUrl = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://robinhoodchain.blockscout.com';
const forge = process.platform === 'win32' && existsSync('.tools/forge.exe')
  ? '.tools/forge.exe'
  : 'forge';
const npmCli = process.env.npm_execpath;

function fail(message) {
  throw new Error(message);
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${command} exited with status ${result.status}.`);
}

function number(value) {
  return typeof value === 'string' && value.startsWith('0x') ? Number(BigInt(value)) : Number(value);
}

function setEnv(source, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(source) ? source.replace(pattern, line) : `${source.replace(/\s*$/, '\n')}${line}\n`;
}

if (!process.env.DEPLOYER_PRIVATE_KEY) {
  fail("DEPLOYER_PRIVATE_KEY is missing. Set it only in your local shell, then run: $env:DEPLOYER_PRIVATE_KEY='<private-key>'; $env:DEPLOY_FORGE_MAINNET='true'; npm run contracts:deploy");
}
const rawPrivateKey = process.env.DEPLOYER_PRIVATE_KEY.trim();
const deployerPrivateKey = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;
if (!/^0x[0-9a-fA-F]{64}$/.test(deployerPrivateKey)) fail('DEPLOYER_PRIVATE_KEY is not a valid 32-byte private key.');
if (process.env.DEPLOY_FORGE_MAINNET !== 'true') {
  fail("Deployment is locked. After reviewing the target, run: $env:DEPLOY_FORGE_MAINNET='true'; npm run contracts:deploy");
}
if (manifest.chainId !== chainId || !isAddress(manifest.address)) fail('Pinned PONS manifest is invalid.');

const childEnv = {
  ...process.env,
  DEPLOYER_PRIVATE_KEY: deployerPrivateKey,
  PONS_FORK_RPC: rpcUrl,
  NEXT_PUBLIC_CHAIN_ID: String(chainId),
  NEXT_PUBLIC_RPC_URL: rpcUrl,
  NEXT_PUBLIC_EXPLORER_URL: explorerUrl,
  NEXT_PUBLIC_PONS_LAUNCH_CONTRACT: manifest.address,
  NEXT_PUBLIC_ENABLE_MAINNET: 'false',
};

// Every irreversible deployment is preceded by the live PONS check and the full local/fork suite.
run(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/verify-pons.ts'], childEnv);
run(forge, ['test', '-vvv'], childEnv);
if (!npmCli) fail('npm executable path is unavailable. Run this through npm run contracts:deploy.');
run(process.execPath, [npmCli, 'run', 'typecheck'], childEnv);
run(process.execPath, [npmCli, 'run', 'lint'], childEnv);
run(process.execPath, [npmCli, 'run', 'build'], childEnv);
run(
  forge,
  ['script', 'script/Deploy.s.sol:Deploy', '--rpc-url', rpcUrl, '--broadcast', '-vvvv'],
  childEnv,
);

const broadcastPath = path.join('broadcast', 'Deploy.s.sol', String(chainId), 'run-latest.json');
const broadcast = JSON.parse(await readFile(broadcastPath, 'utf8'));
const transactions = broadcast.transactions || [];
const receipts = broadcast.receipts || [];
const creation = (name) => transactions.find((tx) => tx.transactionType === 'CREATE' && tx.contractName === name);
const factoryTx = creation('ForgeRouterFactory');
if (!factoryTx?.contractAddress || !isAddress(factoryTx.contractAddress)) fail('Factory deployment was not found in the Foundry broadcast.');

const receiptFor = (tx) => receipts.find((receipt) =>
  receipt.transactionHash?.toLowerCase() === tx.hash?.toLowerCase() ||
  receipt.contractAddress?.toLowerCase() === tx.contractAddress?.toLowerCase(),
);
const factoryReceipt = receiptFor(factoryTx);
if (!factoryReceipt?.transactionHash || factoryReceipt.blockNumber === undefined) fail('Factory receipt is missing from the Foundry broadcast.');

const adapterTx = creation('PonsMarketAdapter');
const vaultTx = creation('ForgeBuybackVault');
const rewardsTx = creation('ForgeHolderRewards');
const client = createPublicClient({ transport: http(rpcUrl) });
const factoryAbi = parseAbi([
  'function ponsFactory() view returns (address)',
  'function feeEscrow() view returns (address)',
  'function owner() view returns (address)',
  'function marketAdapter() view returns (address)',
  'function buybackVault() view returns (address)',
  'function holderRewards() view returns (address)',
]);
const factoryAddress = factoryTx.contractAddress;
const [rpcChainId, code, ponsFactory, feeEscrow, owner, marketAdapter, buybackVault, holderRewards] = await Promise.all([
  client.getChainId(),
  client.getCode({ address: factoryAddress }),
  client.readContract({ address: factoryAddress, abi: factoryAbi, functionName: 'ponsFactory' }),
  client.readContract({ address: factoryAddress, abi: factoryAbi, functionName: 'feeEscrow' }),
  client.readContract({ address: factoryAddress, abi: factoryAbi, functionName: 'owner' }),
  client.readContract({ address: factoryAddress, abi: factoryAbi, functionName: 'marketAdapter' }),
  client.readContract({ address: factoryAddress, abi: factoryAbi, functionName: 'buybackVault' }),
  client.readContract({ address: factoryAddress, abi: factoryAbi, functionName: 'holderRewards' }),
]);
if (rpcChainId !== chainId || !code || ponsFactory.toLowerCase() !== manifest.address.toLowerCase()) fail('Deployed factory verification failed.');
for (const [label, actual, tx] of [
  ['market adapter', marketAdapter, adapterTx],
  ['buyback vault', buybackVault, vaultTx],
  ['holder rewards', holderRewards, rewardsTx],
]) {
  if (!tx?.contractAddress || actual.toLowerCase() !== tx.contractAddress.toLowerCase()) fail(`Deployed ${label} wiring verification failed.`);
}

const deploymentBlock = number(factoryReceipt.blockNumber);
const result = {
  chainId,
  network: 'Robinhood Chain',
  forgeRouterFactory: factoryAddress,
  ponsLaunchFactory: ponsFactory,
  ponsFeeEscrow: feeEscrow,
  owner,
  marketAdapter,
  buybackVault,
  holderRewards,
  deploymentTx: factoryReceipt.transactionHash,
  deploymentBlock,
  explorer: `${explorerUrl}/tx/${factoryReceipt.transactionHash}`,
  deployedAt: new Date().toISOString(),
};
await mkdir('deployments', { recursive: true });
const deploymentTarget = path.join('deployments', 'robinhood-mainnet.json');
await writeFile(`${deploymentTarget}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
await rename(`${deploymentTarget}.tmp`, deploymentTarget);

let localEnv = existsSync('.env.local') ? await readFile('.env.local', 'utf8') : '';
for (const [key, value] of [
  ['NEXT_PUBLIC_CHAIN_ID', String(chainId)],
  ['NEXT_PUBLIC_RPC_URL', rpcUrl],
  ['NEXT_PUBLIC_EXPLORER_URL', explorerUrl],
  ['NEXT_PUBLIC_PONS_LAUNCH_CONTRACT', manifest.address],
  ['PONS_FEE_ESCROW', feeEscrow],
  ['NEXT_PUBLIC_FORGE_ROUTER_FACTORY', factoryAddress],
  ['NEXT_PUBLIC_FORGE_DEPLOYMENT_BLOCK', String(deploymentBlock)],
  // Launch writes remain locked until metadata and a wallet-driven final launch review pass.
  ['NEXT_PUBLIC_ENABLE_MAINNET', 'false'],
]) localEnv = setEnv(localEnv, key, value);
await writeFile('.env.local', localEnv);

console.log(JSON.stringify(result, null, 2));
console.log('Frontend addresses were written to .env.local. Mainnet launch writes remain disabled.');
