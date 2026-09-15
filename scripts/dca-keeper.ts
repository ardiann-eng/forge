import nextEnv from '@next/env';
import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { abi } from '../src/lib/forge/ForgeRouterV2.abi';
import { abi as factoryAbi } from '../src/lib/forge/ForgeRouterFactoryV2.abi';
import { abi as priceAbi } from '../src/lib/forge/PonsStrategyPrice.abi';
import { abi as automationAbi } from '../src/lib/forge/ForgeAutomationExecutor.abi';
import {
  prepareAutomatedFeeBatch,
  prepareDcaCheck,
  prepareGradBoost,
} from '../src/lib/forge/dca-keeper';

nextEnv.loadEnvConfig(process.cwd());
const executeRequested = process.argv.includes('--execute');
const execute = executeRequested && process.env.FORGE_DCA_KEEPER_EXECUTE === 'true';
if (executeRequested && !execute)
  console.log('MONITOR execution flag is disabled by FORGE_DCA_KEEPER_EXECUTE.');
const factory = process.env.NEXT_PUBLIC_FORGE_ROUTER_FACTORY_V2;
if (!factory || !isAddress(factory) || factory === zeroAddress)
  throw Error('Set the deployed V2 factory address.');
const automationExecutorValue = process.env.NEXT_PUBLIC_FORGE_AUTOMATION_EXECUTOR;
if (
  !automationExecutorValue ||
  !isAddress(automationExecutorValue) ||
  automationExecutorValue === zeroAddress
)
  throw Error('Set the deployed FORGE automation executor address.');
const automationExecutor = automationExecutorValue as Address;
const signer = process.env.FORGE_DCA_KEEPER_ADDRESS;
const privateKey = process.env.FORGE_DCA_KEEPER_PRIVATE_KEY as Hex | undefined;
if (
  execute &&
  (!signer ||
    !isAddress(signer) ||
    signer === zeroAddress ||
    !privateKey ||
    !/^0x[0-9a-fA-F]{64}$/.test(privateKey))
)
  throw Error('Execution requires a public signer address and a dedicated gas-only keeper key.');
const rpc =
  process.env.FORGE_DCA_KEEPER_RPC_URL ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  'https://rpc.mainnet.chain.robinhood.com';
const client = createPublicClient({ transport: http(rpc, { timeout: 15000 }) });
const [configuredFactory, configuredKeeper] = await Promise.all([
  client.readContract({ address: automationExecutor, abi: automationAbi, functionName: 'factory' }),
  client.readContract({ address: automationExecutor, abi: automationAbi, functionName: 'keeper' }),
]);
if (configuredFactory.toLowerCase() !== factory.toLowerCase())
  throw Error('Automation executor belongs to a different factory.');
if (signer && signer.toLowerCase() !== configuredKeeper.toLowerCase()) {
  if (execute)
    throw Error('FORGE_DCA_KEEPER_ADDRESS does not match the on-chain automation keeper.');
  console.log('MONITOR configured signer differs from the on-chain keeper; sends remain disabled.');
}
const account: Address = configuredKeeper;
const keeperAccount = privateKey ? privateKeyToAccount(privateKey) : null;
if (execute && keeperAccount?.address.toLowerCase() !== account.toLowerCase())
  throw Error('Keeper private key does not match FORGE_DCA_KEEPER_ADDRESS.');
const wallet = keeperAccount
  ? createWalletClient({ account: keeperAccount, transport: http(rpc, { timeout: 15000 }) })
  : null;
if ((await client.getChainId()) !== 4663) throw Error('Wrong network: expected chain 4663.');
const pons = await client.readContract({
  address: factory,
  abi: factoryAbi,
  functionName: 'ponsFactory',
});
if (pons.toLowerCase() !== '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e')
  throw Error('Unexpected PONS factory.');
const resolver = await client.readContract({
  address: factory,
  abi: factoryAbi,
  functionName: 'priceResolver',
});
const dataDir = path.resolve(process.env.INDEXER_DATA_DIR || 'data');
await mkdir(dataDir, { recursive: true });
const lock = path.join(dataDir, 'dca-keeper.lock');
const handle = await open(lock, 'wx').catch(() => {
  throw Error('Keeper lock exists. Check for a running process before removing a stale lock.');
});
let running = true;
process.on('SIGINT', () => {
  running = false;
});
process.on('SIGTERM', () => {
  running = false;
});
async function send(
  to: Address,
  contractAbi: typeof abi | typeof priceAbi | typeof automationAbi,
  functionName: string,
  args: readonly unknown[] = [],
) {
  console.log(`${execute ? 'SEND' : 'MONITOR'} ${to} ${functionName}`);
  if (!execute) return;
  if (!wallet) throw Error('Keeper wallet is unavailable.');
  const hash = await wallet.writeContract({
    address: to,
    abi: contractAbi,
    functionName,
    args,
  } as never);
  await client.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
}
async function sendAutomation(functionName: string, args: readonly unknown[]) {
  return send(automationExecutor, automationAbi, functionName, args);
}
async function canAutomate(functionName: string, args: readonly unknown[]) {
  return client
    .simulateContract({
      address: automationExecutor,
      abi: automationAbi,
      functionName,
      args,
      account,
    } as never)
    .then(() => true)
    .catch(() => false);
}
try {
  do {
    const count = await client.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: 'routerCount',
    });
    console.log(
      `${execute ? 'EXECUTE' : 'MONITOR'} registry-v2 ready chain=4663 factory=${factory} executor=${automationExecutor} keeper=${configuredKeeper} routers=${count}`,
    );
    for (let i = 0n; i < count && running; i++) {
      const router = await client.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'allRouters',
        args: [i],
      });
      const [token, flow, cancelled, paused, routerResolver, gasBalance, gasPaused] = await Promise.all([
        client.readContract({ address: router, abi, functionName: 'token' }),
        client.readContract({ address: router, abi, functionName: 'getDestinations' }),
        client.readContract({ address: router, abi, functionName: 'dcaCancelled' }),
        client.readContract({ address: router, abi, functionName: 'paused' }),
        client.readContract({ address: router, abi, functionName: 'priceResolver' }),
        client.readContract({
          address: automationExecutor,
          abi: automationAbi,
          functionName: 'automationBalance',
          args: [router],
        }),
        client.readContract({
          address: automationExecutor,
          abi: automationAbi,
          functionName: 'automationPaused',
          args: [router],
        }),
      ]);
      const hasBuyback = flow.some((d) => d.kind === 3);
      const hasBurn = flow.some((d) => d.kind === 4);
      const hasGrad = flow.some((d) => d.kind === 7);
      const hasDca = flow.some((d) => d.kind === 8) && !cancelled;
      if (
        token === zeroAddress ||
        paused ||
        gasPaused ||
        gasBalance === 0n ||
        (!hasBuyback && !hasBurn && !hasGrad && !hasDca)
      )
        continue;
      if (hasDca && routerResolver.toLowerCase() !== resolver.toLowerCase())
        throw Error('Unexpected router price resolver.');
      // Claim only when the canonical escrow simulation actually returns revenue.
      const collection = await client
        .simulateContract({
          address: router,
          abi,
          functionName: 'collectFees',
          account: automationExecutor,
        })
        .catch(() => null);
      if (
        collection &&
        collection.result > 0n &&
        (await canAutomate('executeCollect', [router]))
      )
        await sendAutomation('executeCollect', [router]);
      const processing = await client
        .simulateContract({
          address: router,
          abi,
          functionName: 'processFees',
          account: automationExecutor,
        })
        .catch(() => null);
      if (processing && (await canAutomate('executeProcess', [router])))
        await sendAutomation('executeProcess', [router]);
      for (const action of [
        hasBuyback ? 'executeBuyback' : null,
        hasBurn ? 'executeBurn' : null,
      ].filter((value): value is 'executeBuyback' | 'executeBurn' => value !== null)) {
        const prepared = await prepareAutomatedFeeBatch(client, router, automationExecutor, action).catch(
          () => null,
        );
        const executorAction = action === 'executeBuyback' ? 'executeBuyback' : 'executeBurn';
        const args = prepared ? [router, prepared.amount, prepared.minOut] : [];
        if (prepared && (await canAutomate(executorAction, args)))
          await sendAutomation(executorAction, args);
      }
      if (hasGrad) {
        const prepared = await prepareGradBoost(client, router, automationExecutor).catch(
          () => null,
        );
        const args = prepared
          ? [router, prepared.amount, prepared.minOut, prepared.deadline]
          : [];
        if (prepared && (await canAutomate('executeGradBoost', args)))
          await sendAutomation('executeGradBoost', args);
      }
      if (!hasDca) continue;
      // Check before observing: execution never consumes a same-block observation.
      const prepared = await prepareDcaCheck(client, router, automationExecutor).catch(() => {
        console.log(`${router}: check unavailable (price warmup, quote or RPC).`);
        return null;
      });
      const dcaArgs = prepared ? [router, prepared.minOut, prepared.deadline] : [];
      if (prepared && (await canAutomate('executeDca', dcaArgs)))
        await sendAutomation('executeDca', dcaArgs);
      const [last, block] = await Promise.all([
        client.readContract({
          address: resolver,
          abi: priceAbi,
          functionName: 'lastObservation',
          args: [token],
        }),
        client.getBlock(),
      ]);
      if (block.timestamp >= last + 60n) {
        if (await canAutomate('executeObservation', [router]))
          await sendAutomation('executeObservation', [router]);
      }
    }
    if (running && !process.argv.includes('--once')) await new Promise((r) => setTimeout(r, 10000));
  } while (running && !process.argv.includes('--once'));
} finally {
  await handle.close();
  await unlink(lock);
}
