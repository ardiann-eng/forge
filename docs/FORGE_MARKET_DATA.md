# FORGE Market Data Architecture & Source Research

**Target Network:** Robinhood Chain (`chainId: 4663`)  
**RPC Endpoint:** `https://rpc.mainnet.chain.robinhood.com`  
**Block Explorer:** Blockscout (`https://robinhoodchain.blockscout.com`)  
**Canonical Factory:** `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`

---

## 1. Research Findings by Source

### A. PONS Authority (Pre-Graduation & Canonical Lifecycle)

PONS contracts on Robinhood Chain are the single source of truth for token lifecycle, bonding reserves, pricing, and launch metadata.

1. **Lifecycle Phases (`PonsV2LaunchFactory.getLaunchedToken(token).phase`):**
   - `0` = `BONDING`: Active constant-product curve trading.
   - `1` = `GRADUATED`: Threshold filled, reserves swept into factory.
   - `2` = `MIGRATED`: Uniswap V4 pool created & full-range position locked into `PonsV2LaunchLocker`.
   - `3` = `RESCUED`: Terminal state.

2. **Pricing & Market Cap Formula (Constant Product):**
   - Curve method: `PonsV2BondingCurve.getReserves() returns (uint256 quoteReserve, uint256 tokenReserve)`
   - `quoteReserve = phantomQuote + trackedQuote - quoteFeeBalance - creatorTaxBalance`
   - `tokenReserve = trackedTokens`
   - Spot price in ETH:
     $$\text{priceNative} = \frac{\text{quoteReserve}}{\text{tokenReserve}}$$
   - Spot price in USD:
     $$\text{priceUsd} = \text{priceNative} \times \text{ETH/USD}$$
   - Market Cap in ETH (matches PONS launch supply invariant):
     $$\text{marketCapNative} = \text{priceNative} \times \text{launchSupply} = \frac{\text{quoteReserve} \times \text{launchSupply}}{\text{tokenReserve}}$$
   - Market Cap in USD:
     $$\text{marketCapUsd} = \text{marketCapNative} \times \text{ETH/USD}$$

3. **Bonding & Graduation Progress:**
   - Methods: `PonsV2BondingCurve.realQuoteReserve()` and `PonsV2BondingCurve.graduationThreshold()`
   - Default graduation threshold: `4.2 ether` (in launch config 0).
   - Real progress percentage:
     $$\text{progress} = \min\left(100, \frac{\text{realQuoteReserve} \times 10000}{\text{graduationThreshold} \times 100}\right)$$
   - Remaining ETH to graduation:
     $$\text{remainingEth} = \text{graduationThreshold} - \text{realQuoteReserve}$$

4. **Trades & Volume (On-Chain Events):**
   - Buy Event:
     `event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)`
   - Sell Event:
     `event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)`
   - Each event provides exact block number, transaction hash, timestamp, native quote amount, and token output/input.
   - Cumulative volume is calculated by summing `quoteIn` + `quoteOut` over real trade events.

5. **Token Metadata & Lore:**
   - Implemented by `PonsV2LauncherToken`:
     - `name() view returns (string)`
     - `symbol() view returns (string)`
     - `description() view returns (string)` (token lore/about text)
     - `logo() view returns (string)` (image URL or IPFS URI)
     - `socials() view returns (string twitter, string telegram, string discord, string website, string farcaster)`
   - Initial creator is recorded on `PonsV2LaunchFactory.getLaunchedToken(token).deployer`.
   - Launch timestamp is available on `PonsV2BondingCurve.launchedAt()`.

---

### B. DEX Screener Integration (Market Snapshot)

DEX Screener indexes Robinhood Chain pairs under network identifier `robinhood` (`chainId: 4663`).

1. **Official Endpoints:**
   - Multi-token lookup: `GET https://api.dexscreener.com/latest/dex/tokens/{tokenAddresses}`
   - Specific pair lookup: `GET https://api.dexscreener.com/latest/dex/pairs/{chainId}/{pairAddresses}`
2. **Response Attributes:**
   - `pairAddress`, `dexId` (e.g. `uniswap`), `labels` (`["v4"]`)
   - `priceNative`, `priceUsd`
   - `txns` (`m5`, `h1`, `h6`, `h24` buy & sell counts)
   - `volume` (`m5`, `h1`, `h6`, `h24` in USD)
   - `priceChange` (`m5`, `h1`, `h6`, `h24` percentage)
   - `liquidity` (`usd`, `base`, `quote`)
   - `fdv`, `marketCap`
   - `pairCreatedAt`
   - `info` (`imageUrl`, `socials`, `websites`)
3. **Usage Rules:**
   - Primary role: Market snapshot for migrated/graduated tokens.
   - Secondary role: Profile asset enrichment.
   - Constraint: DEX Screener never overrides canonical PONS lifecycle state.

---

### C. CoinGecko / GeckoTerminal (OHLCV Provider)

GeckoTerminal supports Robinhood Chain under `network = "robinhood"`.

1. **Endpoints:**
   - Pool detail: `GET https://api.geckoterminal.com/api/v2/networks/robinhood/pools/{poolAddress}`
   - Candlestick history: `GET https://api.geckoterminal.com/api/v2/networks/robinhood/pools/{poolAddress}/ohlcv/{timeframe}?aggregate={step}&limit={limit}`
   - Supported timeframes: `minute`, `hour`, `day`.
2. **Rate Limits & Caching:**
   - Public tier is rate-limited to 30 requests/minute (HTTP 429).
   - In-memory cache with 30s–60s TTL must be maintained to prevent client rendering thrashes.
3. **Usage Rules:**
   - Used for candlestick history on migrated Uniswap V4 pools when pool is supported.
   - If GeckoTerminal is rate-limited or unavailable, gracefully fall back to snapshot data.

---

### D. Centralized ETH/USD Price Source

Bonding curve calculations require converting ETH reserves and prices to USD. Hardcoded ETH prices are strictly prohibited.

1. **Provider Priority:**
   - Primary: DeFiLlama (`https://coins.llama.fi/prices/current/coingecko:ethereum`)
   - Fallback 1: Binance Public API (`https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT`)
   - Fallback 2: Coinbase Spot API (`https://api.coinbase.com/v2/prices/ETH-USD/spot`)
2. **Cache Policy:**
   - In-memory cache with 30-second TTL.
   - Background deduplication for parallel calls.

---

### E. Bonding Curve Candle Builder (`BondingCandleBuilder`)

Pre-graduation tokens trade exclusively on the PONS bonding curve and have no Uniswap V4 pool yet.

1. **Trade Ingestion:**
   - Read `CurveBuy` and `CurveSell` logs from the token's `curve` address.
   - Extract `timestamp`, `quoteIn` / `quoteOut`, and compute spot price after each trade from reserves.
2. **Bucket Aggregation:**
   - Bucket timeframes: `1M` (60s), `5M` (300s), `15M` (900s), `1H` (3600s), `4H` (14400s), `1D` (86400s).
   - Calculate `open`, `high`, `low`, `close`, `volume` (in USD or ETH) per bucket.
   - If no trade occurs in a bucket, the previous candle's `close` is carried forward and `volume` is set to 0. No synthetic trades or fabricated candles.

---

### F. FORGE On-Chain Event Markers

Unique value proposition of FORGE: charting market price alongside fee actions executed by FORGE.

1. **Event Types & Sources:**
   - `BUYBACK`: `ForgeRouter.BuybackExecuted`
   - `BURN`: `ForgeRouter.TokensBurned`
   - `LIQUIDITY`: `ForgeRouter.LiquidityReserved`
   - `HOLDER_REWARD`: `ForgeRouter.HolderRewardsDistributed`
   - `FEE_ROUTED`: `ForgeRouter.FeesProcessed`
   - `GRADUATION`: `PonsV2LaunchFactory.PoolGraduated` or `LaunchSwept`
   - `MIGRATION`: `PonsV2LaunchFactory.createGraduatedPool`
2. **Chart Overlay Alignment:**
   - Each event carries `timestamp` (UTC epoch seconds).
   - Mapped to nearest chart candle timestamp without timezone skew.
   - On hover/click: displays exact transaction hash, block number, native ETH amount, token amount, and destination.
