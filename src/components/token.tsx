'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useConnection, useWalletClient } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatEther, type Address, zeroAddress } from 'viem';
import {
  ArrowLeft,
  LockKeyhole,
  Coins,
  TrendingUp,
  Sparkles,
  GitBranch,
  ShieldAlert,
  Flame,
} from 'lucide-react';
import { getToken, getBondingProgress, phaseLabel } from '@/lib/pons/reads';
import {
  getRouter,
  routerTransaction,
  executeBuybackTransaction,
  executeBurnTransaction,
  routerAbi,
} from '@/lib/forge/router';
import { factoryAbi, requireFactory } from '@/lib/forge/factory';
import { publicClient } from '@/lib/client';
import { chain, writesEnabled, forgeFactory } from '@/lib/config';
import { destinationOptions } from '@/lib/flow';
import {
  ForgeAddress,
  ForgeModal,
  ForgeStatus,
  ForgeTokenPreview,
  ForgeTransactionModal,
  type TransactionState,
} from './ui';
import { WalletButton } from './wallet';

function ipfsUrl(uri: string) {
  const match = /^ipfs:\/\/([a-zA-Z0-9]{20,120})$/.exec(uri);
  return match ? `https://gateway.pinata.cloud/ipfs/${match[1]}` : null;
}

const labels = {
  process: 'Process creator fees',
  claim: 'Claim your fees',
  collectFees: 'Collect revenue from PONS escrow',
  executeBuyback: 'Execute on-chain market buyback',
  executeBurn: 'Execute on-chain buy and burn',
};

export function Token({ address: tokenAddress }: { address: Address }) {
  const { address, chainId } = useConnection();
  const { data: wallet } = useWalletClient();
  const queryClient = useQueryClient();
  const [tx, setTx] = useState<TransactionState>({ status: 'idle' });
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<
    'process' | 'claim' | 'collectFees' | 'executeBuyback' | 'executeBurn' | null
  >(null);
  const [gas, setGas] = useState<bigint>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const token = useQuery({
    queryKey: ['token', tokenAddress],
    queryFn: () => getToken(tokenAddress),
    refetchInterval: 30000,
  });

  const router = useQuery({
    queryKey: ['token-router', tokenAddress, address],
    enabled: !!forgeFactory,
    queryFn: async () => {
      const routerAddress = await publicClient.readContract({
        address: requireFactory(),
        abi: factoryAbi,
        functionName: 'tokenToRouter',
        args: [tokenAddress],
      });
      if (routerAddress === zeroAddress) return null;
      return getRouter(routerAddress, address);
    },
    refetchInterval: 30000,
  });

  const progress = useQuery({
    queryKey: ['bonding-progress', tokenAddress],
    enabled: token.data?.phase === 0,
    queryFn: () => getBondingProgress(tokenAddress),
    refetchInterval: 30000,
  });

  const metadata = useQuery({
    queryKey: ['token-metadata', router.data?.metadataURI],
    enabled: !!router.data?.metadataURI,
    queryFn: async () => {
      const url = ipfsUrl(router.data!.metadataURI);
      if (!url) return null;
      const r = await fetch(url);
      if (!r.ok) return null;
      return r.json() as Promise<{ image?: string }>;
    },
  });

  const imageURI = metadata.data?.image ? ipfsUrl(metadata.data.image) : null;

  async function review(
    kind: 'process' | 'claim' | 'collectFees' | 'executeBuyback' | 'executeBurn',
  ) {
    if (!address || !router.data) return;
    setBusy(true);
    setError('');
    try {
      if (kind === 'executeBuyback') {
        const amount = router.data.buybackReserve;
        const req = {
          address: router.data.address,
          abi: routerAbi,
          functionName: 'executeBuyback' as const,
          args: [amount, 1n] as const,
          account: address,
        };
        await publicClient.simulateContract(req);
        setGas(await publicClient.estimateContractGas(req));
      } else if (kind === 'executeBurn') {
        const amount = router.data.burnReserve;
        const req = {
          address: router.data.address,
          abi: routerAbi,
          functionName: 'executeBurn' as const,
          args: [amount, 1n] as const,
          account: address,
        };
        await publicClient.simulateContract(req);
        setGas(await publicClient.estimateContractGas(req));
      } else {
        const req = {
          address: router.data.address,
          abi: routerAbi,
          functionName: kind,
          account: address,
        };
        await publicClient.simulateContract(req);
        setGas(await publicClient.estimateContractGas(req));
      }
      setAction(kind);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!wallet || !address || !router.data || !action) return;
    const selected = action;
    setAction(null);
    setBusy(true);
    setOpen(true);
    setTx({ status: 'awaiting signature', title: labels[selected] });
    try {
      if (selected === 'executeBuyback') {
        await executeBuybackTransaction(
          wallet,
          address,
          router.data.address,
          router.data.buybackReserve,
          1n,
          (hash) => setTx({ status: 'confirming', title: labels[selected], hash }),
        );
      } else if (selected === 'executeBurn') {
        await executeBurnTransaction(
          wallet,
          address,
          router.data.address,
          router.data.burnReserve,
          1n,
          (hash) => setTx({ status: 'confirming', title: labels[selected], hash }),
        );
      } else {
        await routerTransaction(wallet, address, router.data.address, selected, (hash) =>
          setTx({ status: 'confirming', title: labels[selected], hash }),
        );
      }
      setTx((t) => ({ ...t, status: 'confirmed' }));
      await queryClient.invalidateQueries({ queryKey: ['token-router', tokenAddress] });
    } catch (e) {
      setTx((t) => ({ ...t, status: 'failed', error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  const enabled = !!wallet && chainId === chain.id && writesEnabled && !busy;

  return (
    <div className="token-detail-container">
      <div className="token-top-nav">
        <Link className="back-link" href="/#live">
          <ArrowLeft size={16} />
          <span>Live on FORGE</span>
        </Link>
      </div>

      {token.isLoading ? (
        <div className="loading-state-card">
          <div className="spinner-wrap">
            <span className="loading-dot" />
          </div>
          <p>Reading token data from Robinhood Chain…</p>
        </div>
      ) : token.error ? (
        <div className="empty-state-card error-tone">
          <h3>TOKEN UNAVAILABLE</h3>
          <p>The configured PONS factory could not confirm this token on Robinhood Chain.</p>
          <div className="mt-4">
            <ForgeAddress value={tokenAddress} />
          </div>
        </div>
      ) : (
        token.data && (
          <>
            {/* 40 — TOKEN IDENTITY BLOCK */}
            <section className="token-identity-block">
              <div className="token-identity-left">
                <ForgeTokenPreview
                  name={token.data.name}
                  ticker={token.data.symbol}
                  image={imageURI || undefined}
                />
                <div className="token-addresses-group font-mono text-xs">
                  <div className="address-item">
                    <span className="muted">TOKEN</span>
                    <ForgeAddress value={tokenAddress} short />
                  </div>
                  <div className="address-item">
                    <span className="muted">CREATOR</span>
                    <ForgeAddress value={token.data.deployer} short />
                  </div>
                </div>
              </div>

              <div className="token-identity-right">
                <div className="token-status-row">
                  <ForgeStatus tone="success">{phaseLabel(token.data.phase)}</ForgeStatus>
                  <span className="chain-badge">{chain.name}</span>
                </div>

                <div className="token-quick-actions">
                  <button
                    type="button"
                    className="button button-lime"
                    disabled={!enabled}
                    onClick={() => review('process')}
                  >
                    <Coins size={16} />
                    <span>PROCESS FEES</span>
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={!enabled || !router.data?.claimable}
                    onClick={() => review('claim')}
                  >
                    <span>CLAIM MY SHARE</span>
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={!enabled}
                    onClick={() => review('collectFees')}
                  >
                    <span>COLLECT PONS ESCROW</span>
                  </button>
                  {router.data && router.data.buybackReserve > 0n && (
                    <button
                      type="button"
                      className="button button-lime"
                      disabled={!enabled}
                      onClick={() => review('executeBuyback')}
                    >
                      <Coins size={16} />
                      <span>BUYBACK ({formatEther(router.data.buybackReserve)} ETH)</span>
                    </button>
                  )}
                  {router.data && router.data.burnReserve > 0n && (
                    <button
                      type="button"
                      className="button button-dark"
                      disabled={!enabled}
                      onClick={() => review('executeBurn')}
                    >
                      <Flame size={16} />
                      <span>BURN ({formatEther(router.data.burnReserve)} ETH)</span>
                    </button>
                  )}
                </div>

                {!address && (
                  <div className="token-connect-prompt">
                    <WalletButton />
                  </div>
                )}
              </div>
            </section>

            {/* 41 — TOKEN METRICS WITH INTENTIONAL RHYTHM */}
            <section className="token-metrics-strip" aria-label="Token financial metrics">
              <div className="metric-card metric-lime">
                <span className="metric-label">FEES RECEIVED</span>
                <strong className="metric-value">
                  {typeof router.data?.received === 'bigint'
                    ? formatEther(router.data.received)
                    : '—'}
                  <small className="metric-unit">ETH</small>
                </strong>
                <span className="metric-sub">Total inbound creator revenue</span>
              </div>

              <div className="metric-card metric-white">
                <span className="metric-label">FEES PROCESSED</span>
                <strong className="metric-value">
                  {typeof router.data?.processed === 'bigint'
                    ? formatEther(router.data.processed)
                    : '—'}
                  <small className="metric-unit">ETH</small>
                </strong>
                <span className="metric-sub">Distributed across destinations</span>
              </div>

              <div className="metric-card metric-white">
                <span className="metric-label">BUYBACKS & BURNS</span>
                <strong className="metric-value">
                  {typeof router.data?.totalETHUsedForBuyback === 'bigint' &&
                  typeof router.data?.totalETHUsedForBurn === 'bigint'
                    ? formatEther(router.data.totalETHUsedForBuyback + router.data.totalETHUsedForBurn)
                    : '—'}
                  <small className="metric-unit">ETH</small>
                </strong>
                <span className="metric-sub">
                  Reserves: {formatEther((router.data?.buybackReserve ?? 0n) + (router.data?.burnReserve ?? 0n))} ETH
                </span>
              </div>

              <div className="metric-card metric-dark">
                <span className="metric-label">YOUR CLAIMABLE FEES</span>
                <strong className="metric-value">
                  {typeof router.data?.claimable === 'bigint'
                    ? formatEther(router.data.claimable)
                    : '—'}
                  <small className="metric-unit">ETH</small>
                </strong>
                <span className="metric-sub metric-sub-dark">
                  {address ? 'Connected wallet balance' : 'Connect wallet to view'}
                </span>
              </div>
            </section>

            {/* 42 — TOKEN FLOW VISUAL: HUGE "THE FLOW" SECTION */}
            <section className="token-the-flow-section">
              <div className="flow-section-header">
                <div>
                  <span className="badge-tag">IMMUTABLE ALLOCATION</span>
                  <h2>THE FLOW</h2>
                  <p>
                    Programmed routing logic for ${token.data.symbol}. Every creator fee dollar
                    follows these exact rules.
                  </p>
                </div>
                {router.data?.address && (
                  <div className="router-address-badge">
                    <span className="muted text-xs">DEDICATED ROUTER:</span>
                    <ForgeAddress value={router.data.address} short />
                  </div>
                )}
              </div>

              {router.data ? (
                <div className="flow-visual-architecture">
                  <div className="flow-origin-box">
                    <span className="flow-node-tag">INCOMING</span>
                    <strong className="flow-node-title">CREATOR FEES</strong>
                    <span className="flow-node-desc">100% PONS Trading Fees</span>
                  </div>

                  <div className="flow-connector-pillar">
                    <span className="connector-line" />
                    <div className="flow-center-hub">
                      <div className="hub-tag">FORGE</div>
                      <span className="hub-sub">ROUTER</span>
                    </div>
                    <span className="connector-line" />
                  </div>

                  <div className="flow-destinations-grid">
                    {router.data.flow.map((d, index) => {
                      const opt = destinationOptions[d.kind];
                      const isAction = d.kind >= 3;
                      return (
                        <div key={index} className="destination-node-card">
                          <div className="node-pct-badge">{d.bps / 100}%</div>
                          <div className="node-content">
                            <strong className="node-title">
                              {opt?.label || 'Custom Recipient'}
                            </strong>
                            <p className="node-desc">{opt?.description || 'Allocated wallet'}</p>
                            <div className="node-wallet">
                              {isAction ? (
                                <span className="action-dest-tag font-mono text-xs">
                                  {d.kind === 3 && 'ForgeBuybackVault'}
                                  {d.kind === 4 && 'Native Token Burn'}
                                  {d.kind === 5 && `Reserve: ${formatEther(router.data?.liquidityReserve ?? 0n)} ETH`}
                                  {d.kind === 6 && 'Merkle Holder Rewards'}
                                </span>
                              ) : (
                                <ForgeAddress value={d.recipient} short />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flow-footnote-row">
                    <LockKeyhole size={18} />
                    <p>
                      Allocations are immutable. Rounding remainder is delivered to the final
                      recipient. Each destination claims funds or executes independently.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="empty-state-card compact">
                  <p className="muted">
                    {router.isLoading
                      ? 'Reading router registry…'
                      : router.error
                        ? 'Router data is unavailable.'
                        : 'This token has no bound FORGE router in the configured registry.'}
                  </p>
                </div>
              )}
            </section>

            {/* 43 — BONDING & LIFECYCLE GRID */}
            <section className="token-lifecycle-grid">
              <div className="lifecycle-card">
                <div className="lifecycle-header">
                  <TrendingUp size={20} />
                  <h3>BONDING CURVE STATUS</h3>
                </div>

                {progress.data !== null && progress.data !== undefined ? (
                  <div className="bonding-progress-block">
                    <div className="bonding-metric-row">
                      <span className="bonding-label">BONDING TO GRADUATION</span>
                      <strong className="bonding-pct-value">{progress.data}%</strong>
                    </div>
                    <div className="bonding-track">
                      <div
                        className="bonding-fill"
                        style={{ width: `${Math.min(100, Math.max(0, progress.data))}%` }}
                      />
                    </div>
                    <span className="bonding-sub">
                      {token.data.phase === 2
                        ? 'Curve completed. Migrated to Uniswap V4 pool.'
                        : 'Accumulating bonding liquidity toward Uniswap V4 pool migration.'}
                    </span>
                  </div>
                ) : (
                  <div className="bonding-progress-block">
                    <div className="bonding-metric-row">
                      <span className="bonding-label">PHASE</span>
                      <strong className="bonding-pct-value">{phaseLabel(token.data.phase)}</strong>
                    </div>
                    <p className="muted text-sm mt-2">
                      {token.data.phase === 2
                        ? 'Graduated to decentralized exchange liquidity pool.'
                        : 'Bonding curve active.'}
                    </p>
                  </div>
                )}
              </div>

              <div className="lifecycle-card">
                <div className="lifecycle-header">
                  <GitBranch size={20} />
                  <h3>PROTOCOL & MARKET ADAPTER</h3>
                </div>
                <dl className="spec-compact-dl">
                  <div className="spec-row">
                    <dt>Upstream Fee Recipient</dt>
                    <dd><ForgeAddress value={token.data.creatorFeeRecipient} short /></dd>
                  </div>
                  <div className="spec-row">
                    <dt>Market Type</dt>
                    <dd className="font-semibold">
                      {token.data.phase === 2 ? 'Uniswap V4 (PoolManager)' : 'PONS Bonding Curve'}
                    </dd>
                  </div>
                  <div className="spec-row">
                    <dt>Bonding Curve Contract</dt>
                    <dd><ForgeAddress value={token.data.curve} short /></dd>
                  </div>
                  <div className="spec-row">
                    <dt>Forge Router</dt>
                    <dd><ForgeAddress value={router.data?.address} short /></dd>
                  </div>
                </dl>
              </div>
            </section>

            {/* 44 — MARKET DATA / CHART EMPTY STATE */}
            <section className="market-chart-section">
              <div className="chart-empty-state">
                <Sparkles size={28} className="chart-empty-icon" />
                <h3>MARKET DATA NOT AVAILABLE YET</h3>
                <p>
                  Real-time candlestick charts and swap analytics will appear once trading activity
                  is indexed on Robinhood Chain.
                </p>
              </div>
            </section>

            {router.data &&
              token.data.creatorFeeRecipient.toLowerCase() !==
                router.data.address.toLowerCase() && (
                <div className="warning-callout" role="alert">
                  <ShieldAlert size={20} />
                  <p>
                    Notice: The upstream creator-fee recipient in PONS differs from this router. New
                    fees may not reach this flow.
                  </p>
                </div>
              )}

            {error && (
              <div role="alert" className="error-box mt-4">
                {error}
              </div>
            )}
          </>
        )
      )}

      <ForgeTransactionModal state={tx} open={open} onClose={() => setOpen(false)} />

      <ForgeModal
        title={action ? labels[action] : 'Review Transaction'}
        open={!!action}
        onOpenChange={(v) => {
          if (!v) setAction(null);
        }}
      >
        <p className="modal-lead">
          Sign the transaction in your wallet to execute this router operation.
        </p>
        <dl className="review-spec-dl">
          <div className="spec-row">
            <dt>Network</dt>
            <dd>{chain.name} ({chain.id})</dd>
          </div>
          <div className="spec-row">
            <dt>Router Destination</dt>
            <dd><ForgeAddress value={router.data?.address} short /></dd>
          </div>
          <div className="spec-row">
            <dt>Action</dt>
            <dd>{action ? labels[action] : ''}</dd>
          </div>
          <div className="spec-row">
            <dt>Estimated Gas</dt>
            <dd>{gas?.toString()} gas units</dd>
          </div>
        </dl>
        <button
          type="button"
          className="button button-lime full"
          disabled={!enabled}
          onClick={execute}
        >
          Confirm in wallet
        </button>
      </ForgeModal>
    </div>
  );
}
