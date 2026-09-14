# PONS Integration Research & Technical Verification

**Date:** 2026-09-14  
**Target Network:** Robinhood Chain (`chainId: 4663`)  
**RPC Endpoint:** `https://rpc.mainnet.chain.robinhood.com`  
**Explorer:** Blockscout (`https://robinhoodchain.blockscout.com`)  
**Source Commit:** `ponsdotdev/ponsfamily@f2e069c1bf26bde0760446ecce3cf2501cf50846`

---

## Verification verdict

| Target | Address | Status | Evidence |
|---|---|---|---|
| PONS V2 launch factory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` | **VERIFIED** | Blockscout verified ABI, pinned RPC runtime-code hash, live interface reads, successful real-contract fork launches, and known successful launch transaction `0xb98d5d5dcd9ac2ed47e0fc01f98e2893b3a4e1ae5007bca8b3b4e2811b00e0ea`. |
| PONS V2 fee escrow | `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` | **VERIFIED** | Returned by the live factory's `feeEscrow()` getter and exercised by the fork fee-collection test. |
| PONS V2 launch-and-buy forwarder | `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948` | **VERIFIED** | Pinned RPC runtime-code hash, `factory()` backlink, factory `launchForwarder()` getter, verified source snapshot, and successful atomic launch-and-buy fork test. |
| Robinhood mainnet public RPC | `https://rpc.mainnet.chain.robinhood.com` | **VERIFIED** | Official Robinhood Chain documentation and live `eth_chainId == 4663`. |
| Robinhood mainnet explorer | `https://robinhoodchain.blockscout.com` | **VERIFIED** | Official Robinhood Chain documentation and working contract ABI/transaction APIs. |
| PONS testnet launch target | — | **UNVERIFIED** | No official PONS testnet deployment was identified; FORGE must not substitute a guessed address. |

Verified launch entry points:

```solidity
function launchToken(Params calldata params, uint256 configId, address pairToken, address[] calldata exemptions)
    external payable returns (address token, address curve);

function launchAndBuy(Params calldata params, uint256 configId, address pairToken, uint256 buyAmount,
    uint256 minTokensOut, address recipient, address[] calldata exemptions)
    external payable returns (address token, address curve, uint256 tokensBought);
```

`Params.creatorFeeRecipient` is the dedicated `ForgeRouter`. FORGE never supplies or deploys a FORGE ecosystem token as part of this flow. The public PONS web application was region-blocked from the verification environment, so frontend transaction construction was not used as evidence; the same calls were instead verified against explorer ABI/source, live bytecode and full real-contract RPC fork execution.

## 1. Actual PONS Launch Contract(s)

- **Factory Contract:** `PonsV2LaunchFactory`
  - **Address:** `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`
  - **Verification:** Verified on Blockscout and RPC runtime code hash pinned in `src/lib/pons/manifest.json` (`0x89a27da6f703e0a7cdd4f233e7cb57604ff75b164530962d3ff7cf8483a67d84`).
- **Launch & Buy Forwarder:** `PonsV2LaunchAndBuy`
  - **Address:** `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948`
  - **Purpose:** Atomic token launch + optional initial dev buy in a single transaction.
- **Helper Contract:** `PonsV2LaunchDeployer`
  - Used internally by `PonsV2LaunchFactory` to deploy curves and tokens via `CREATE2` to keep factory bytecode within EIP-170 limits.

---

## 2. Actual Bonding / Trading Contract(s)

- **Contract:** `PonsV2BondingCurve`
  - Individual instance deployed per launch, stored in factory record:
    ```solidity
    PonsV2LaunchFactory.getLaunchedToken(address token).curve
    ```
- **Verified On-Chain Instances:**
  - Active bonding token: `0x4B9fFc1C51C672F3f79aa8FAC3630297C5d51fd0`  
    Curve: `0xf9c30455c86FC007a7a038CCACB2aB7DFF2802E3` (Tx: `0xb98d5d5dcd9ac2ed47e0fc01f98e2893b3a4e1ae5007bca8b3b4e2811b00e0ea`)
  - Active bonding token: `0xdf7f547254dc7bbe2c00e407d5f388ff4d1cbf34`  
    Curve: `0xe0491f8c44a02e921f29868cea50dd3fb5eeda00` (Tx: `0xac9c33513ab23abe8fbfb290c84321e13d27b7030ab79db89409b7b246251b8d`)
  - Graduated token: `0x298bCf72f7040d02c6F8D4095bd500690a391c9e`  
    Curve: `0x3b5ce8DB2cBa725574EaCB7596766638193b3d35` (Graduation Tx: `0x87d3971ee2133f0aee001763b1011645cf3f70dde7a7fd8e3b563e19f2992308`)

---

## 3. Token Contracts Created by PONS

- **Contract:** `PonsV2LauncherToken`
  - Inherits: `ERC20`, `ERC20Burnable` (OpenZeppelin v5)
  - Decimals: `18`
  - Standard Supply: `1,000,000,000 * 10^18` (1 billion tokens)
  - Supply Mint: 100% of supply is minted directly to the bonding curve at deployment (`_mint(curve_, supply_)`).
  - Burn Functionality: Inherits `burn(uint256 value)` and `burnFrom(address account, uint256 value)` from `ERC20Burnable`. Anyone can burn their own tokens.
  - Metadata: Exposes `logo`, `description`, `socials()` tuple (`twitter`, `telegram`, `discord`, `website`, `farcaster`), and `getTokenInfo()`.

---

## 4. How Users Buy Before Graduation

- **Function:**
  ```solidity
  function buy(uint256 quoteIn, uint256 minTokensOut, address recipient)
      external
      payable
      returns (uint256 tokensOut);
  ```
- **Call Mechanism:**
  - For native ETH (`pairToken == address(0)`): `msg.value` must equal `quoteIn`.
  - Purchased tokens are immediately transferred to `recipient`:
    `IERC20(token).safeTransfer(recipient, tokensOut)`.
  - If a buy exceeds the remaining curve allocation (`sellableTokens()`), it is automatically clamped to fill only up to the graduation reserve, and unspent ETH is refunded to `msg.sender` via `CurveBuyRefunded`.
  - Pre-graduation programmatic buys from contracts are 100% supported and permissionless.

---

## 5. How Users Sell Before Graduation

- **Function:**
  ```solidity
  function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient)
      external
      returns (uint256 quoteOut);
  ```
- **Call Mechanism:**
  - Caller approves `tokensIn` to the curve.
  - Curve pulls tokens via `safeTransferFrom(msg.sender, address(this), tokensIn)`.
  - Curve transfers `quoteOut` (native ETH or ERC-20) to `recipient`.
  - Reverts with `CurveGraduated()` if `graduated || readyToGraduate()`.

---

## 6. What Asset Creator Fees Are Paid In

- Paid in the launch's quote asset:
  - Native ETH (`pairToken == address(0)`) for all standard PONS launches.
  - Custom ERC-20 if a non-zero `pairToken` was configured at launch.

---

## 7. How Creator Fees Are Delivered

- Trade fees (`feeBps` + `creatorTaxBps`) accrue in the curve contract during bonding trades.
- When `PonsV2BondingCurve.sweepFees(...)` or `PonsV2BondingCurve.graduate(...)` executes:
  - Creator fees are credited to `PonsV2FeeEscrow`:
    - Address: `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e`
    - Method: `IPonsV2FeeEscrow.credit{value: amount}(recipient)`
- To claim credited fees:
  - The recipient (or any caller on its behalf) calls `IPonsV2FeeEscrow.claim()`.
  - Native ETH is transferred to the recipient.
  - `ForgeRouter.collectFees()` already invokes `IPonsEscrow(feeEscrow).claim()`.

---

## 8. Creator-Fee Receiver Behavior

- **Initial Receiver:** Passed at launch as `params.creatorFeeRecipient`. For FORGE tokens, this is set to the dedicated `ForgeRouter` address.
- **Creator Reassignment:** The creator fee recipient can reassign future fees via:
  ```solidity
  PonsV2LaunchFactory.transferCreatorFeeRecipient(address token, address newRecipient)
  ```
- **Protocol Governance Override:** `PonsV2LaunchFactory.setCreatorFeeRecipient(token, newRecipient)` exists with a mandatory 3-day timelock (`CREATOR_FEE_RECIPIENT_TIMELOCK = 3 days`).

---

## 9. Graduation Threshold & State

- **Graduation Threshold:** `graduationThreshold = 4.2 ether` (4,200,000,000,000,000,000 wei) in default launch config 0.
- **Trigger:** When `PonsV2BondingCurve.sellableTokens() == 0` (equivalent to `realQuoteReserve() >= graduationThreshold`).
- **Phases:**
  ```solidity
  enum GraduationPhase {
      NotGraduated, // 0 - Trading on bonding curve
      Swept,        // 1 - Curve reserves drained into factory
      PoolCreated,  // 2 - Uniswap V4 pool initialized & locked
      Rescued       // 3 - Terminal rescue state
  }
  ```
- **Check Method:** `PonsV2LaunchFactory.getLaunchedToken(token).phase`.

---

## 10. Graduation Event(s)

- **Curve Events:**
  - `CurveCompleted(address recipient, uint256 quoteOut, uint256 tokenOut)`
- **Factory Events:**
  - `LaunchSwept(address indexed token, uint256 quoteOut, uint256 tokenOut)`
  - `PoolGraduated(address indexed token, uint256 indexed positionId, uint256 tokenAmount, uint256 pairTokenAmount)`
  - `GraduationTokensPermanentlyLocked(address indexed token, uint256 amount)`

---

## 11. Migration Mechanism

Two-phase permissionless execution:
1. **Phase 1 (`graduate`):**
   - Triggered automatically by threshold-crossing buy or explicitly via `PonsV2LaunchFactory.graduate(token)`.
   - Halts bonding curve trading, sweeps remaining quote and tokens into the factory, sets phase to `Swept` (1).
2. **Phase 2 (`createGraduatedPool`):**
   - Permissionlessly callable via `PonsV2LaunchFactory.createGraduatedPool(token)`.
   - Seeds Uniswap V4 pool, mints a full-range position to `PonsV2LaunchLocker`, sets phase to `PoolCreated` (2).

---

## 12. Migrated Market Type

- **DEX:** Uniswap V4
- **Core Manager:** `IPoolManager` singleton at `0x8366a39CC670B4001A1121B8F6A443A643e40951`
- **Meme Hook:** `PonsV2MemeHook` singleton at `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`
  - Permissions: `afterSwap: true`, `afterSwapReturnDelta: true`.

---

## 13. Migrated Pool Address Discovery

- Uniswap V4 pools do not have individual contract addresses. They are identified by `PoolId` (32-byte hash) derived from `PoolKey`:
  ```solidity
  PoolKey memory key = PoolKey({
      currency0: Currency.wrap(address(0)), // Native ETH sorted lower
      currency1: Currency.wrap(token),
      fee: 0,                               // launch.poolFee
      tickSpacing: 200,                     // launch.tickSpacing
      hooks: IHooks(0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044)
  });
  PoolId poolId = key.toId();
  ```
- Any contract can compute this deterministically on-chain or read `PonsV2MemeHook.launches(poolId)`.

---

## 14. DEX / Router Used After Migration

- **Protocol:** Uniswap V4 `PoolManager` (`0x8366a39CC670B4001A1121B8F6A443A643e40951`).
- Standard V4 interaction flow:
  1. Caller invokes `IPoolManager.unlock(bytes data)`.
  2. In `unlockCallback(bytes data)`: caller invokes `poolManager.swap(key, params, testSettings)`.
  3. Caller settles input currency (`poolManager.settle()`) and takes output currency (`poolManager.take()`).

---

## 15. Liquidity Position Ownership

- **Owner:** `PonsV2LaunchLocker` (`0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952`).
- The position NFT minted by `PositionManager` (`0x58daec3116aae6D93017bAAea7749052E8a04fA7`) is held by `PonsV2LaunchLocker`.

---

## 16. Whether Liquidity Is Already Locked

- **YES.** `PonsV2LaunchLocker` holds the V4 position permanently. It exposes no administrative withdrawal or transfer function.

---

## 17. Whether Additional Liquidity Can Safely Be Added

- **During Bonding (Phase 0):** NO. Bonding curve is not an AMM with LP shares. External liquidity cannot be injected into the curve contract. All liquidity fee allocations during bonding MUST accumulate in a dedicated token liquidity reserve (`pendingLiquidity[token]`).
- **Post-Graduation (Phase 2):** In Uniswap V4, liquidity addition requires dual-sided asset supply (`Currency0` + `Currency1`). Because creator fees arrive exclusively as ETH, adding post-graduation liquidity would require auto-swapping 50% of fees into memecoins (subject to price impact and fees) and managing custom V4 position ticks.
- **Architectural Decision:** Maintain `pendingLiquidity[token]` safely in the router/vault as `LIQUIDITY RESERVE`.

---

## 18. Whether Pre-Graduation Programmatic Buys Are Possible

- **YES.** `PonsV2BondingCurve.buy{value: quoteIn}(quoteIn, minTokensOut, recipient)` is open, permissionless, and directly callable by smart contracts.

---

## 19. Whether Buy Functions Have Slippage / Min-Out Protection

- **YES.** `minTokensOut` is strictly enforced. The curve verifies `spent * minTokensOut <= received * tokensOut` and reverts with `SlippageExceeded(actual, minimum)`.
- Quotes are calculable on-chain via `PonsV2BondingCurveMath.getAmountOut(...)` and curve reserve getters (`getReserves()`).

---

## 20. Whether Tokens Expose burn()

- **YES.** `PonsV2LauncherToken` inherits OpenZeppelin `ERC20Burnable`.
- Functions: `burn(uint256 value)` and `burnFrom(address account, uint256 value)`.
- Real burns remove tokens from circulation and decrement `totalSupply()`.

---

## 21. Token Transfer Behavior

- Standard OpenZeppelin `ERC20` implementation. No transfer tax, no blacklist, no rebasing mechanics in `PonsV2LauncherToken`.

---

## 22. Useful APIs / Subgraphs / Indexers for Holder Discovery

- No native PONS subgraph is deployed on Robinhood Chain.
- Canonical balance tracking is obtained via indexed `Transfer` events from the token contract.
- Standard claim-based Merkle distribution architecture (`ForgeHolderRewards`) is the correct, scalable, and safe pattern for holder fee distributions.

---

## Verified Contract Registry Summary

| Role | Contract Name | Address on Robinhood Chain (`4663`) |
|---|---|---|
| Launch Factory | `PonsV2LaunchFactory` | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| Launch Forwarder | `PonsV2LaunchAndBuy` | `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948` |
| Fee Escrow | `PonsV2FeeEscrow` | `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` |
| Uniswap V4 PoolManager | `PoolManager` | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| Uniswap V4 MemeHook | `PonsV2MemeHook` | `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` |
| Uniswap V4 PositionManager | `PositionManager` | `0x58daec3116aae6D93017bAAea7749052E8a04fA7` |
| Launch Locker | `PonsV2LaunchLocker` | `0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952` |
| Buyback Vault | `PonsV2BuybackVault` | `0x42df2a798f82289E177311362e8f5ccC45c1219c` |
| FORGE Factory | `ForgeRouterFactory` | Configured in `.env` / `src/lib/config.ts` |
