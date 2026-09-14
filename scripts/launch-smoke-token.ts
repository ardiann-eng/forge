import nextEnv from '@next/env';
import {
  createWalletClient,
  formatEther,
  http,
  keccak256,
  parseEventLogs,
  toHex,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

nextEnv.loadEnvConfig(process.cwd());

const [{ publicClient }, { chain, forgeFactory }, { abi: factoryAbi }, { ponsAbi }, ponsConfig] =
  await Promise.all([
    import('../src/lib/client'),
    import('../src/lib/config'),
    import('../src/lib/forge/ForgeRouterFactory.abi'),
    import('../src/lib/pons/abi'),
    import('../src/lib/pons/config'),
  ]);

const rawKey = process.env.FORGE_SMOKE_PRIVATE_KEY;
if (!rawKey) throw new Error('FORGE_SMOKE_PRIVATE_KEY is required.');
const privateKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex;
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('Invalid private key format.');
if (!forgeFactory) throw new Error('FORGE factory is not configured.');
if (!ponsConfig.ponsAddress) throw new Error('PONS factory is not configured.');

const account = privateKeyToAccount(privateKey);
const wallet = createWalletClient({ account, chain, transport: http(chain.rpcUrls.default.http[0]) });
const runId = new Date().toISOString().replace(/\D/g, '').slice(4, 14);
const name = `FORGE Test ${runId}`;
const symbol = `FT${runId.slice(-6)}`;
const metadata = {
  name,
  symbol,
  image: '',
  description: 'FORGE mainnet integration smoke-test token. No official value or utility.',
};
const metadataURI = `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`;
if (metadataURI.length > 256) throw new Error('Smoke metadata URI exceeds router limit.');

const balanceBefore = await publicClient.getBalance({ address: account.address });
console.log(`Account: ${account.address}`);
console.log(`Balance before: ${formatEther(balanceBefore)} ETH`);
console.log(`Token: ${name} (${symbol})`);

const routerSimulation = await publicClient.simulateContract({
  address: forgeFactory,
  abi: factoryAbi,
  functionName: 'createRouter',
  args: [[{ recipient: account.address, bps: 10_000, kind: 0 }], metadataURI],
  account,
});
const routerHash = await wallet.writeContract(routerSimulation.request);
console.log(`Router tx: ${routerHash}`);
const routerReceipt = await publicClient.waitForTransactionReceipt({ hash: routerHash, confirmations: 2 });
if (routerReceipt.status !== 'success') throw new Error('Router deployment reverted.');
const routerEvent = parseEventLogs({
  abi: factoryAbi,
  eventName: 'RouterCreated',
  logs: routerReceipt.logs.filter((log) => log.address.toLowerCase() === forgeFactory.toLowerCase()),
  strict: true,
}).find((log) => log.args.creator.toLowerCase() === account.address.toLowerCase());
if (!routerEvent) throw new Error('RouterCreated event not found.');
const router = routerEvent.args.router;
console.log(`Router: ${router}`);

const [fee, expectedEconomics] = await Promise.all([
  publicClient.readContract({
    address: ponsConfig.ponsAddress,
    abi: ponsAbi,
    functionName: 'launchFee',
  }),
  publicClient.readContract({
    address: ponsConfig.ponsAddress,
    abi: ponsAbi,
    functionName: 'previewLaunchEconomics',
    args: [0n, '0x0000000000000000000000000000000000000000'],
  }),
]);
const params = {
  name,
  symbol,
  logo: '',
  description: metadata.description,
  socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' },
  creatorFeeRecipient: router,
  creatorTaxBps: 0,
  buybackEnabled: false,
  expectedEconomics,
  salt: keccak256(toHex(`forge-smoke:${runId}:${account.address}`)),
};
const launchSimulation = await publicClient.simulateContract({
  address: ponsConfig.ponsAddress,
  abi: ponsAbi,
  functionName: 'launchToken',
  args: [params, 0n, '0x0000000000000000000000000000000000000000', []],
  account,
  value: fee,
});
const launchHash = await wallet.writeContract(launchSimulation.request);
console.log(`Launch tx: ${launchHash}`);
const launchReceipt = await publicClient.waitForTransactionReceipt({ hash: launchHash, confirmations: 2 });
if (launchReceipt.status !== 'success') throw new Error('Token launch reverted.');
const launchEvent = parseEventLogs({
  abi: ponsAbi,
  eventName: 'TokenLaunched',
  logs: launchReceipt.logs.filter(
    (log) => log.address.toLowerCase() === ponsConfig.ponsAddress!.toLowerCase(),
  ),
  strict: true,
}).find((log) => log.args.deployer.toLowerCase() === account.address.toLowerCase());
if (!launchEvent) throw new Error('TokenLaunched event not found.');
const token = launchEvent.args.token;
console.log(`Token: ${token}`);

const bindSimulation = await publicClient.simulateContract({
  address: forgeFactory,
  abi: factoryAbi,
  functionName: 'bindToken',
  args: [router, token],
  account,
});
const bindHash = await wallet.writeContract(bindSimulation.request);
console.log(`Bind tx: ${bindHash}`);
const bindReceipt = await publicClient.waitForTransactionReceipt({ hash: bindHash, confirmations: 2 });
if (bindReceipt.status !== 'success') throw new Error('Token binding reverted.');

const [registeredRouter, registeredToken, balanceAfter] = await Promise.all([
  publicClient.readContract({
    address: forgeFactory,
    abi: factoryAbi,
    functionName: 'tokenToRouter',
    args: [token],
  }),
  publicClient.readContract({
    address: forgeFactory,
    abi: factoryAbi,
    functionName: 'routerToToken',
    args: [router],
  }),
  publicClient.getBalance({ address: account.address }),
]);
if (
  registeredRouter.toLowerCase() !== router.toLowerCase() ||
  registeredToken.toLowerCase() !== token.toLowerCase()
) {
  throw new Error('Final FORGE binding verification failed.');
}

console.log(`Bind tx: ${bindHash}`);
console.log(`Balance after: ${formatEther(balanceAfter)} ETH`);
console.log(`Total spent: ${formatEther(balanceBefore - balanceAfter)} ETH`);
