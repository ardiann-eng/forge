import nextEnv from '@next/env';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
nextEnv.loadEnvConfig(process.cwd());
const broadcast = process.argv.includes('--broadcast');
if (broadcast && process.env.DEPLOY_FORGE_V2_MAINNET !== 'true')
  throw new Error(
    'Broadcast is locked. Review a successful simulation before enabling DEPLOY_FORGE_V2_MAINNET.',
  );
if (!process.env.FORGE_V2_DEPLOYER)
  throw new Error('Set FORGE_V2_DEPLOYER to your signer public address.');
if (!process.env.FORGE_AUTOMATION_KEEPER_ADDRESS)
  throw new Error('Set FORGE_AUTOMATION_KEEPER_ADDRESS to the shared gas-only keeper address.');
if (broadcast && !process.env.FORGE_V2_KEYSTORE_ACCOUNT)
  throw new Error('Select a secure local Foundry keystore account.');
const executable =
  process.platform === 'win32' && existsSync('.tools/forge.exe') ? '.tools/forge.exe' : 'forge';
const args = [
  'script',
  'script/DeployV2.s.sol:DeployV2',
  '--rpc-url',
  process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  '--sender',
  process.env.FORGE_V2_DEPLOYER,
  '--rpc-timeout',
  '20',
  '--non-interactive',
];
if (broadcast) args.push('--account', process.env.FORGE_V2_KEYSTORE_ACCOUNT, '--broadcast');
const childEnv = { ...process.env };
if (!broadcast) {
  delete childEnv.ETH_PASSWORD;
  delete childEnv.ETH_KEYSTORE;
  delete childEnv.ETH_KEYSTORE_ACCOUNT;
}
const result = spawnSync(executable, args, { stdio: 'inherit', env: childEnv });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
