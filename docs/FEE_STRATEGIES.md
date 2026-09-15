# FORGE fee strategies (V2)

FORGE routes PONS creator-fee revenue. PONS remains responsible for token creation,
bonding, graduation and the migrated market. No replacement token factory, curve,
pool or graduation mechanism is introduced.

## Routes and custody

| Route            | ID  | Reserve / custody                                           | Execution                                                                                                                  |
| ---------------- | --- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Creator          | 0   | `claimable[creator]`                                        | Creator calls `claim()`                                                                                                    |
| Treasury         | 1   | `claimable[treasury]`                                       | Treasury calls `claim()`                                                                                                   |
| Buyback          | 3   | `buybackReserve`                                            | Every five minutes the keeper buys with the complete accumulated batch into the fixed buyback vault                        |
| Buy + burn       | 4   | `burnReserve`                                               | Every five minutes the keeper buys with the complete accumulated batch and burns it; dead-address transfer is the fallback |
| Holders          | 6   | `holderRewardReserve`                                       | Creator funds a Merkle epoch through `fundHolderRewards`                                                                   |
| Grad Boost       | 7   | `gradBoostBalance`                                          | Shared keeper executes an eligible bounded bonding buy into the buyback vault                                               |
| DCA Buyback      | 8   | `dcaBuybackBalance`                                         | Every five minutes it checks the confirmed price; a matched dip buys with the complete accumulated batch into the vault    |

Primary allocations total exactly 10,000 BPS. `process()` / `processFees()` only
allocate unreserved native revenue. Market execution is separate. Failed swaps
revert their own accounting without blocking other destinations or fee claims.
V2 launches are native-quote PONS tokens only; `processToken` rejects ERC20 fees
instead of mixing ERC20 units into native reserves. There is no arbitrary withdrawal
of protocol reserves or purchased tokens held in the buyback vault.

## Configuration and limits

Rules are immutable per router and readable on-chain.
`setPaused(bool)` is creator-only and pauses market execution; revenue processing
and recipient claims remain available. Grad Boost has positive minimum/maximum
execution limits. Every market purchase uses 1–1,000 BPS configured slippage protection.
Buyback, Buy + Burn and DCA use an exact 300-second interval.

Grad Boost uses `triggerProgressBps` (default 8,000). Zero is manual eligibility
at any bonding progress; higher values require that progress before execution.
Progress is `realQuoteReserve / graduationThreshold`, read from the canonical
PONS curve, capped at 10,000 BPS. It is never a frontend estimate. After bonding
ends, Grad Boost execution stops and any remaining reserve stays dedicated and
locked; it is not reassigned to Treasury. Allocation continues according to the
immutable flow, so creators should understand that later fees may remain locked.

All strategy buys enforce a nonzero minimum output at least the on-chain quote
minus configured slippage, native limits, reserve sufficiency and a deadline no
more than five minutes ahead. Off-chain transaction preparation uses an on-chain
quote, then simulates the full transaction. The contract repeats the guard.
Actual ERC20 receipts and native spend are measured; partial-fill refunds return
to the originating reserve and are not counted as new creator revenue.
Buyback and burn use the configured base slippage bound. Their two-argument methods
require the amount to equal the entire current reserve and enforce a five-minute
cross-call interval, including the first execution after router creation.

## Real PONS execution and exact limitations

Evidence: pinned upstream source at
[PonsV2BondingCurve.sol](https://github.com/ponsdotdev/ponsfamily/blob/f2e069c1bf26bde0760446ecce3cf2501cf50846/contractsV2/src/v2/PonsV2BondingCurve.sol),
the existing verified manifest, and `ForgeStrategiesFork.t.sol` against the real
Robinhood PONS contracts on a local RPC fork. Tests never broadcast transactions.
The verified call is `buy(uint256 quoteIn,uint256 minTokensOut,address recipient)`.

`PonsMarketAdapterV2` resolves the curve from the canonical launch record and only
accepts native-quote tokens. It verifies the configured pool manager and hook
against the PONS factory. Bonding quotes use the actual token recipient for the
anti-sniping tax, cap that tax exactly as PONS does, and round the three fee legs
independently. This corrects the legacy adapter's quote during the opening tax
window. The buy, quote and lifecycle adapter is shared across strategies.

After migration, the adapter quotes by simulating the exact Uniswap V4 swap and
reverting the simulated state with the resulting output, following the V4 quoter
pattern. The router then executes against the same canonical pool key and repeats
its configured slippage floor. This adds gas to a migrated execution because the
swap path runs once for its protected quote and once for settlement. No synthetic
market or frontend-only estimate is used. `WAITING FOR SUPPORTED PONS EXECUTION`
means the canonical quote or lifecycle is unavailable, not that funds were spent.

## DCA: compare with the previous check every five minutes

The revised behavior follows the creator request: compare against the PREVIOUS
CHECK, not a fixed launch anchor. `anchorPrice` is retained as a public getter but
now stores the previous check's conservative reference. `lastDcaCheck` controls
the fixed 300-second interval. `checkDca(minOut,deadline)` is
permissionless and performs one decision per interval:

1. The first check captures a baseline without buying.
2. On subsequent due checks, compare confirmed current upper price with the
   previous check's lower price. Flat/rising prices do not buy.
3. Select only the deepest matching configured dip tier. A match spends the
   complete CURRENT reserve accumulated for DCA since its preceding execution.
4. Update the reference, check time and round counter whether buying or skipping.
   A further decline in the next interval can trigger the same tier again.
5. If more than two intervals were missed, establish a fresh baseline without
   catch-up spending. Failed swaps revert the reference update and all accounting.

One to five increasing dip thresholds are retained. Legacy sizing shares remain
readable in the configuration, but execution flushes the complete five-minute fee
batch after any tier matches. `dcaEpoch` identifies each completed check;
`levelExecuted[round][tier]` records the tier used in that round. Cooldown prevents
repeat decisions inside the interval. `dcaPlanReserve` and `dcaPlanSpent` describe
the latest check. Refunds and rounding stay reserved. Zero `minOut` is allowed only
for a check that performs NO swap; eligible buys always enforce positive output.

Example with a configured 10% dip tier: confirmed reference 100,
next check 90 -> buy the complete accumulated DCA reserve; next check 81 -> buy the next accumulated batch;
next check 81 or 85 -> no buy. Each interval becomes the reference for the next.

### Canonical price observations and limitations

The deployment script deploys `PonsStrategyPrice`, then Factory V2 pins that resolver
as an immutable constructor argument. It resolves the canonical PONS launch record.
During bonding it verifies the token/native curve and reads `getReserves()`; after
migration it derives the same pool key and reads Uniswap V4 `slot0` through the
canonical PoolManager's `extsload`. Both venues report native-per-token scaled by
1e18. Swept, rescued, unknown and ready-to-graduate markets fail closed.

`observe(token)` stores three permissionless on-chain samples, at least 60 seconds
apart and from different blocks. A gap above 90 seconds restarts the warmup.
Execution requires all samples to be from earlier blocks, a window of at least
120 seconds and a latest sample at most 120 seconds old. A lifecycle change clears
the prior window, so migration requires three fresh V4 samples and never mixes a
bonding observation with a pool observation. Current spot is included in the bounds.
The current maximum is compared with the previous minimum, so a single depressed
observation does not establish a dip and a recovered current price prevents spending
against stale low samples.

This is **sampled multi-block confirmation, not TWAP**, and does not prove that
price stayed below a threshold between observations. Sustained or repeated
manipulation across samples remains a risk in thin markets. Immutable amount caps,
slippage, fresh quotes and deadlines constrain each buy; they do not eliminate MEV
or guarantee market performance. Migrated quotes execute the V4 path on-chain and
therefore cost more gas than bonding arithmetic. This implementation has not received
an independent security audit.

### Reserve recovery

Creator-only `cancelDca()` permanently cancels DCA for that router. Remaining
DCA native reserve is credited to `claimable[creator]`; future ID8 allocations
also become creator claims. The creator then calls `claim()`. This is disclosed
in configuration, review and active strategy UI. It cannot redirect funds to an
arbitrary wallet, take other strategy reserves, or withdraw purchased vault tokens.
Cancellation works while paused or when prices/markets are unavailable. It
cannot be undone. Other fee routes and historical records remain intact.

### Automation / keeper operations

Contracts cannot wake themselves. `npm run keeper:dca` runs the shared automation
worker for fee collection/processing, Buyback, Buy + Burn, Grad Boost, DCA
and DCA price observations;
`npm run keeper:dca -- --once` runs one read-only pass. Monitoring never creates
observations or sends transactions, so an uninitialized resolver remains warming up.

`ForgeAutomationExecutor` keeps a separate native gas balance for every V2 router.
During launch, a creator signs a normal `fund(router)` transaction. The shared keeper
still pays the network first, then the executor reimburses the measured gas only after
the router action succeeds. A failed or reverted action receives nothing. Reimbursement
uses the lower of the transaction gas price and the immutable 100 gwei ceiling, and is
also capped at 0.01 ETH per action. Every action type has an independent five-minute
reimbursement interval for each router. This prevents another token from consuming a
creator's balance and limits repeated calls by a compromised keeper.

The creator can call `setPaused(router,bool)` on the executor without changing fee
allocations, and can withdraw unused gas with `withdraw(router,amount,recipient)`.
Funding is open so another wallet may sponsor a router, but only the router creator can
pause or withdraw it. The launch screen requires a positive balance for flows containing
IDs 3, 4, 7 or 8. The token strategy panel shows the live balance and exposes top-up,
pause/resume and creator-only withdrawal controls.

After deploying V2, configure a reliable RPC and one shared gas-only service wallet.
Do not give the keeper token allowances or creator ownership. Set these variables:

- `NEXT_PUBLIC_FORGE_ROUTER_FACTORY_V2`: confirmed factory deployment.
- `NEXT_PUBLIC_FORGE_AUTOMATION_EXECUTOR`: executor deployed for that exact factory.
- `FORGE_DCA_KEEPER_RPC_URL`: reliable server RPC, expected chain 4663.
- `FORGE_DCA_KEEPER_ADDRESS`: dedicated gas-only service wallet public address.
- `FORGE_DCA_KEEPER_PRIVATE_KEY`: server-only secret for that gas-only wallet. It must
  never be a creator, user, deployer, or treasury wallet.
- `FORGE_DCA_KEEPER_EXECUTE=true`: explicit sending opt-in.

Operator activation command: `npm run keeper:dca -- --execute`. This command has
NOT been run by the implementation agent. Both the flag and env opt-in are required.
Run under a supervised service; monitor gas balance, process logs and observation
freshness. Polling is every 10 seconds; buys still obey the on-chain 5-minute
interval, plus transaction/confirmation latency. No exact wall-clock guarantee.

The worker verifies that the executor points to the configured factory and that its
on-chain keeper equals the configured signer. It enumerates the V2 registry and skips
cancelled, paused, unfunded or unbound automated routers.
It collects only simulated positive escrow claims and separately processes any
unallocated fees, then prepares/simulates a due check before adding the next price
observation. PONS must first credit revenue to its escrow through its actual fee
lifecycle; the keeper cannot bypass PONS sweep permissions. It never substitutes
frontend prices or lets a caller choose the bought token/recipient/pool.

A local exclusive lock prevents duplicate processes. Transaction failures stop
the daemon: reconcile pending transactions/nonces before restarting. RPC startup
or registry errors also stop it for supervisor review. Scale workers/RPC capacity
before a registry scan exceeds sample spacing; delays fail closed and restart
warmup. Stopping the keeper stops automation without spending queued catch-up buys.

## API, events and persistence

`GET /api/token/:address/strategies` reads all strategy state at the indexer's
confirmed block, returns decimal strings for large integers, and includes
reserves, limits, levels, executed amounts and
confirmed execution records. Loading, empty, error and stale states are explicit.
Wallet submission re-reads and simulates current state; indexer eligibility alone
never authorizes a transaction.

Events: `StrategyReserveAdded`, `GradBoostExecuted`, `DcaChecked`, `DcaCancelled`,
`DcaBuybackExecuted`,
`StrategyPaused`. Existing receive/process/claim and
buyback/burn/reward events remain readable. The indexer retains all named event
arguments as strings in optional `details`, preserving tx hash, log index, block
hash and confirmed timestamp. Activity uses product labels and chart markers use
the emitting transaction's block timestamp.

The Windows build and dev scripts explicitly select supported Webpack; Turbopack stalled in this workspace. Wallet connectors use their public per-connector exports to avoid pulling unused optional Coinbase/Solana packages into the build.

Persistence remains the existing atomic JSON snapshot store. `factoryV2` and
event `details` are additive optional fields. Enabling V2 triggers deterministic
replay from the earliest configured deployment block, indexing both registries;
legacy history is retained. Back up the existing snapshot before rollout.

## Legacy compatibility

`ForgeRouter.sol`, `ForgeRouterFactory.sol` and their deployed state are unchanged.
IDs 2 (Custom) and 5 (Liquidity) are never reused. V2 rejects both, while historical
views label them LEGACY and preserve their true BPS. No new UI, preset or V2
creation payload offers those routes. The single router in the checked persisted registry (`0x6dD379990c17E6C50c6773BC8Bbb108AF4A454d8`) was read on-chain: 10,000 BPS to creator, with no removed routes. Compatibility paths still cover other historical routers and snapshots. Old router ABIs remain available for reads
and claims. The existing factory **cannot create V2 routers** and cannot be upgraded
in place. Old vaults/reward contracts only recognize their own factory, so V2 gets
new instances. Legacy draft storage is not overwritten; new drafts use a V2 key.

## Deployment (manual, versioned)

Required new contracts: `ForgeRouterFactoryV2`, `PonsMarketAdapterV2`,
`PonsStrategyPrice`, `ForgeAutomationExecutor`, a new `ForgeBuybackVault` and
`ForgeHolderRewards`. Each new token gets `ForgeRouterV2`.
No old address, `.env.local` or `deployments/robinhood-mainnet.json` is overwritten.

Run before any deployment:

```powershell
$env:PONS_FORK_RPC='https://rpc.mainnet.chain.robinhood.com'
npm run contracts:test
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
node scripts/export-abis.mjs
```

Simulation uses only public configuration:

```powershell
$env:NEXT_PUBLIC_PONS_LAUNCH_CONTRACT='0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e'
$env:FORGE_V2_DEPLOYER='<your public signer address>'
$env:FORGE_AUTOMATION_KEEPER_ADDRESS='<shared keeper public address>'
node scripts/deploy-forge-v2.mjs
```

Only after reviewing the simulation, use an existing secure local Foundry keystore
or adapt the script to the team's hardware signer. Never place secrets in chat.
The wrapper requires explicit `DEPLOY_FORGE_V2_MAINNET=true` and
`FORGE_V2_KEYSTORE_ACCOUNT` to run with `--broadcast`. This implementation does not
run that command. Record confirmed receipts separately as
`deployments/robinhood-mainnet-v2.json`, verify factory/PONS/escrow/adapter/vault/rewards/price-resolver
links, then set `NEXT_PUBLIC_FORGE_ROUTER_FACTORY_V2`,
`NEXT_PUBLIC_FORGE_AUTOMATION_EXECUTOR` and
`NEXT_PUBLIC_FORGE_DEPLOYMENT_BLOCK_V2`. Preserve the legacy factory and deployment
block variables, restart the indexer, and rebuild the frontend. Existing RPC,
IPFS, upload authentication, WalletConnect and mainnet-write settings still apply.

Execution involves market, MEV, slippage and immutable-custody risks; no price
performance is guaranteed. This is tested implementation code, not an independent
security audit. Verify deployed bytecode and review custody/disabled capabilities
before accepting real creator revenue into a new router.

## Verification

The revised implementation passed 80 local Solidity tests, including complete-batch
Buyback, Buy + Burn and DCA accounting. When `PONS_FORK_RPC` is configured, the
real PONS fork suites create tokens and execute DCA after sustained price drops on both the
bonding curve and the migrated Uniswap V4 pool. Each path builds three spaced
canonical observations before buying. The suite includes 256-run accounting fuzz
tests. It also passed 43 TypeScript backend, validation and keeper preparation tests,
11 browser tests including responsive and accessibility coverage, TypeScript checking,
ESLint and the optimized Next.js production build.

Current runtime sizes are Router V2 15,874 bytes and Factory V2 24,448 bytes,
PonsStrategyPrice 3,983 bytes and Adapter V2 6,404 bytes. All are below the EIP-170
24,576-byte limit. The factory has only 128 bytes of headroom, so recheck its size
after any source/compiler change.

The versioned deployment script completed a read-only Robinhood Chain simulation
without broadcast. At that block it estimated 11,351,922 gas and approximately
0.00164022 ETH; actual deployment cost varies with fees. The simulation deployed
the price resolver separately, pinned it in Factory V2, connected the adapter,
vault and rewards, and returned a factory address inside the local fork only.
No mainnet transaction was sent.

Public RPC requests from the web runtime intermittently returned HTTP 403/429 during
verification; production hosting and the keeper need reliable RPC access.
