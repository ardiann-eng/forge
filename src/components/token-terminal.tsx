'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useConnection, useWalletClient } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatEther, type Address, zeroAddress } from 'viem';
import { ArrowLeft, ChevronDown, ExternalLink, Globe, Send } from 'lucide-react';
import { getToken, phaseLabel } from '@/lib/pons/reads';
import { getRouter, routerTransaction } from '@/lib/forge/router';
import { findTokenRouter } from '@/lib/forge/factory';
import { forgeFactory, forgeFactoryV2, explorer } from '@/lib/config';
import { ActiveStrategies } from './active-strategies';
import { destinationLabel } from '@/lib/flow';
import { CaBadge } from './ca-badge';
import { MarketChart } from './market-chart';
import { LiveActivity } from './live-activity';
import { CreatorFeePanel } from './creator-fee-panel';
import type { Candle, ChartTimeframe, ForgeChartEvent, LiveActivityItem, LiveTrade, TokenLifecycle, TokenMarketSnapshot, TokenMetadata } from '@/lib/market/types';

function resolveImage(uri?: string): string | null {
  if (!uri) return null;
  if (uri.startsWith('ipfs://')) return `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}`;
  return /^https?:\/\//.test(uri) ? uri : null;
}

function formatUsd(value?: number, compact = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (compact && value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (compact && value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  if (value === 0) return '$0';
  if (value < 0.0001) return `$${value.toFixed(8)}`;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: value < 1 ? 6 : 2 })}`;
}

function Metric({ label, value, detail, loading }: { label: string; value: string; detail?: string; loading?: boolean }) {
  return <div className="market-rail-cell"><span className="market-rail-label">{label}</span>{loading ? <span className="skeleton skeleton-number" /> : <strong className="market-rail-value font-mono">{value}</strong>}{detail && !loading ? <span className="market-rail-detail">{detail}</span> : null}</div>;
}

function HeaderSkeleton() {
  return <section className="terminal-identity-banner terminal-header-skeleton" aria-label="Loading token metadata" aria-busy="true"><span className="skeleton skeleton-token-art" /><div className="header-skeleton-copy"><span className="skeleton skeleton-title" /><span className="skeleton skeleton-ticker" /><span className="skeleton skeleton-lore" /><span className="skeleton skeleton-lore is-short" /><div className="header-skeleton-actions"><span className="skeleton skeleton-ca" /><span className="skeleton skeleton-social" /><span className="skeleton skeleton-social" /></div></div></section>;
}

function TokenArtwork({ src, ticker, name }: { src: string | null; ticker: string; name: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  return <div className="terminal-token-artwork-box">{src && failedSrc !== src ? <>{loadedSrc !== src && <span className="skeleton token-image-loading" />}<img src={src} alt={`${name} token artwork`} className={`terminal-token-img ${loadedSrc === src ? 'is-loaded' : ''}`} onLoad={() => setLoadedSrc(src)} onError={() => setFailedSrc(src)} /></> : <div className="terminal-token-fallback font-mono" aria-label={`${ticker} artwork fallback`}>{ticker.slice(0, 2).toUpperCase()}</div>}</div>;
}

export function TokenTerminal({ address: tokenAddress }: { address: Address }) {
  const { address } = useConnection();
  const { data: wallet } = useWalletClient();
  const queryClient = useQueryClient();
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('5M');
  const [metric, setMetric] = useState<'PRICE' | 'MC'>('PRICE');
  const [loreExpanded, setLoreExpanded] = useState(false);
  const [procTxPending, setProcTxPending] = useState(false);

  const tokenQuery = useQuery({ queryKey: ['token-onchain', tokenAddress], queryFn: () => getToken(tokenAddress), refetchInterval: 10_000 });
  const routerQuery = useQuery({
    queryKey: ['token-router', tokenAddress, address], enabled: !!(forgeFactory || forgeFactoryV2),
    queryFn: async () => {
      const routerAddress = await findTokenRouter(tokenAddress);
      return !routerAddress || routerAddress === zeroAddress ? null : getRouter(routerAddress, address);
    }, refetchInterval: 10_000,
  });
  const marketQuery = useQuery({
    queryKey: ['token-market', tokenAddress],
    queryFn: async () => { const res = await fetch(`/api/market/tokens?tokens=${tokenAddress}`); if (!res.ok) throw new Error('Failed to load market snapshot'); return res.json() as Promise<{ snapshots: Record<string, TokenMarketSnapshot>; metadata: Record<string, TokenMetadata> }>; },
    refetchInterval: 10_000, staleTime: 30_000,
  });
  const candlesQuery = useQuery({
    queryKey: ['token-candles', tokenAddress, timeframe, metric],
    queryFn: async () => { const res = await fetch(`/api/market/candles?token=${tokenAddress}&timeframe=${timeframe}&metric=${metric}`); if (!res.ok) throw new Error('Failed to load candles'); return res.json() as Promise<{ candles: Candle[]; events: ForgeChartEvent[]; activity: LiveActivityItem[]; trades: LiveTrade[]; spotQuote?: { priceUsd: number | null; launchedAt: number } | null; source: string; updatedAt: number }>; },
    refetchInterval: 10_000,
  });

  const tokenData = tokenQuery.data;
  const routerData = routerQuery.data;
  const key = tokenAddress.toLowerCase();
  const snapshot = marketQuery.data?.snapshots?.[key];
  const metadata = marketQuery.data?.metadata?.[key];
  const identityLoading = (tokenQuery.isPending && !tokenData) || (marketQuery.isPending && !metadata);
  const marketLoading = marketQuery.isPending && !snapshot;
  const marketError = marketQuery.isError;
  const isStale = !!snapshot && marketQuery.isStale && !marketQuery.isFetching;
  const name = metadata?.name || tokenData?.name || `${tokenAddress.slice(0, 6)}…${tokenAddress.slice(-4)}`;
  const ticker = metadata?.symbol || tokenData?.symbol || 'TOKEN';
  const description = metadata?.description;
  const lifecycle: TokenLifecycle = snapshot?.lifecycle || (tokenData ? (phaseLabel(tokenData.phase) as TokenLifecycle) : 'UNKNOWN');
  const reserveWei = snapshot?.bondingReserves ? BigInt(snapshot.bondingReserves) : undefined;
  const thresholdWei = snapshot?.bondingThreshold ? BigInt(snapshot.bondingThreshold) : tokenData?.graduationThreshold;
  const reserveEth = reserveWei !== undefined ? formatEther(reserveWei) : undefined;
  const thresholdEth = thresholdWei !== undefined ? formatEther(thresholdWei) : undefined;
  const toGraduation = reserveWei !== undefined && thresholdWei !== undefined ? formatEther(thresholdWei > reserveWei ? thresholdWei - reserveWei : 0n) : undefined;
  const routerBalanceEth = routerData ? Number(formatEther(routerData.balance)) : 0;

  async function processPendingFees() {
    if (!wallet || !address || !routerData) return;
    setProcTxPending(true);
    try { await routerTransaction(wallet, address, routerData.address, 'process', () => {}); await queryClient.invalidateQueries({ queryKey: ['token-router', tokenAddress] }); }
    finally { setProcTxPending(false); }
  }

  const marketMetrics = lifecycle === 'BONDING' ? [
    { label: 'MARKET CAP', value: formatUsd(snapshot?.marketCapUsd, true) },
    { label: 'PRICE', value: formatUsd(snapshot?.priceUsd) },
    { label: '24H VOLUME', value: formatUsd(snapshot?.volume24h, true), detail: snapshot ? `${snapshot.buys24h ?? 0} buys · ${snapshot.sells24h ?? 0} sells` : undefined },
    { label: 'BONDING RESERVES', value: reserveEth !== undefined ? `${Number(reserveEth).toFixed(3)} ETH` : '—' },
    { label: 'BONDING', value: snapshot?.bondingProgress !== undefined ? `${snapshot.bondingProgress.toFixed(1)}%` : '—' },
    { label: 'CREATOR FEES', value: routerData ? `${Number(formatEther(routerData.received)).toFixed(4)} ETH` : '—' },
  ] : [
    { label: 'MARKET CAP', value: formatUsd(snapshot?.marketCapUsd, true) },
    { label: 'PRICE', value: formatUsd(snapshot?.priceUsd) },
    { label: '24H VOLUME', value: formatUsd(snapshot?.volume24h, true) },
    { label: 'LIQUIDITY', value: formatUsd(snapshot?.liquidityUsd, true) },
    { label: '24H CHANGE', value: typeof snapshot?.change24h === 'number' ? `${snapshot.change24h > 0 ? '+' : ''}${snapshot.change24h.toFixed(2)}%` : '—' },
    { label: 'CREATOR FEES', value: routerData ? `${Number(formatEther(routerData.received)).toFixed(4)} ETH` : '—' },
  ];

  return <div className="terminal-page-layout">
    <div className="terminal-top-nav"><Link className="back-to-market-link" href="/#live"><ArrowLeft size={16} /><span>LIVE LAUNCHPAD</span></Link><div className="terminal-chain-pill"><span className="live-pulse-dot" /><span>ROBINHOOD CHAIN</span></div></div>
    {identityLoading ? <HeaderSkeleton /> : <section className="terminal-identity-banner">
      <TokenArtwork src={resolveImage(metadata?.logo)} ticker={ticker} name={name} />
      <div className="identity-text-block"><div className="identity-title-row"><h1 className="terminal-token-title">{name}</h1><span className="terminal-token-ticker">${ticker}</span><span className={`status-badge lifecycle-${lifecycle.toLowerCase()}`}><span className="pulse-dot" />{lifecycle}</span></div>
        {description ? <div className="terminal-lore-wrap"><p className={`terminal-token-lore ${loreExpanded ? 'is-expanded' : ''}`}>{description}</p>{description.length > 150 ? <button type="button" className="lore-more-btn" onClick={() => setLoreExpanded((value) => !value)}>{loreExpanded ? 'SHOW LESS' : 'READ MORE'}</button> : null}</div> : null}
        <div className="identity-meta-row"><CaBadge address={tokenAddress} /><div className="identity-social-links" aria-label="Token links">{metadata?.socials?.website ? <a href={metadata.socials.website} target="_blank" rel="noopener noreferrer" className="social-btn"><Globe size={14} /><span>Website</span></a> : null}{metadata?.socials?.twitter ? <a href={metadata.socials.twitter} target="_blank" rel="noopener noreferrer" className="social-btn"><span className="social-x-mark">X</span><span>X</span></a> : null}{metadata?.socials?.telegram ? <a href={metadata.socials.telegram} target="_blank" rel="noopener noreferrer" className="social-btn"><Send size={14} /><span>Telegram</span></a> : null}</div></div>
      </div>
      <div className="identity-market-summary"><span className="identity-market-label">{lifecycle === 'BONDING' ? 'BONDING PROGRESS' : 'MARKET STATUS'}</span><strong className="font-mono">{lifecycle === 'BONDING' && snapshot?.bondingProgress !== undefined ? `${snapshot.bondingProgress.toFixed(1)}%` : lifecycle}</strong>{lifecycle === 'BONDING' ? <div className="identity-progress-track"><span style={{ width: `${snapshot?.bondingProgress ?? 0}%` }} /></div> : null}</div>
    </section>}
    <section className={`terminal-market-strip ${marketError ? 'has-error' : ''}`} aria-label="Token market snapshot" aria-busy={marketLoading}>{marketError ? <div className="market-inline-error">Market data temporarily unavailable. Token and wallet actions remain available.</div> : marketMetrics.map((item) => <Metric key={item.label} {...item} loading={marketLoading || (item.label === 'CREATOR FEES' && routerQuery.isPending)} />)}</section>
    {isStale ? <p className="terminal-stale-note">Data delayed · showing the last confirmed update</p> : null}
    <section className="terminal-chart-workspace"><MarketChart candles={candlesQuery.data?.candles || []} events={candlesQuery.data?.events || []} spotQuote={candlesQuery.data?.spotQuote} timeframe={timeframe} onTimeframeChange={setTimeframe} metric={metric} onMetricChange={setMetric} tokenSymbol={ticker} currentPriceUsd={snapshot?.priceUsd} currentMarketCapUsd={snapshot?.marketCapUsd} priceChange24h={snapshot?.change24h} isLive={!isStale} isLoading={candlesQuery.isPending} isError={candlesQuery.isError} canShowMarketCap={typeof snapshot?.marketCapUsd === 'number'} /><LiveActivity trades={candlesQuery.data?.trades || []} activity={candlesQuery.data?.activity || []} tokenSymbol={ticker} isLoading={candlesQuery.isPending} isError={candlesQuery.isError} /></section>
    <section className="terminal-flow-section"><div className="flow-section-header"><div><h2 className="flow-heading">THE FLOW</h2><p className="flow-sub">The current route for every creator fee.</p></div>{routerBalanceEth > 0 ? <button type="button" className="button button-lime" disabled={procTxPending} onClick={processPendingFees}>{procTxPending ? 'PROCESSING…' : `PROCESS ${routerBalanceEth.toFixed(4)} ETH`}</button> : null}</div>
      {routerQuery.isPending ? <div className="compact-flow-skeleton"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div> : routerData ? <><div className="compact-flow-route"><div className="compact-flow-source"><span>CREATOR FEES</span><strong className="font-mono">{Number(formatEther(routerData.received)).toFixed(4)} ETH</strong></div><span className="flow-arrow" aria-hidden="true">→</span><span className="compact-flow-forge">FORGE</span><span className="flow-arrow" aria-hidden="true">→</span><div className="compact-flow-destinations">{routerData.flow.map((d, i) => <div className="compact-flow-destination" key={`${d.recipient}-${i}`}><strong className="font-mono">{d.bps / 100}%</strong><span>{({label: destinationLabel(d.kind)})?.label || 'CREATOR'}</span></div>)}</div></div><div className="compact-flow-bar" aria-label="Fee allocation">{routerData.flow.map((d, i) => <span key={i} style={{ width: `${d.bps / 100}%` }} />)}</div><div className="flow-aggregates-strip"><span>TOTAL FEES <strong className="font-mono">{formatEther(routerData.received)} ETH</strong></span><span>TOTAL PROCESSED <strong className="font-mono">{formatEther(routerData.processed)} ETH</strong></span><span>ROUTER BALANCE <strong className="font-mono">{formatEther(routerData.balance)} ETH</strong></span></div></> : <p className="flow-empty-copy">No FORGE fee route is registered for this token.</p>}
    </section>
    <ActiveStrategies token={tokenAddress} />
    <CreatorFeePanel routerAddress={routerData?.address} creatorAddress={tokenData?.deployer} tokenAddress={tokenAddress} claimable={routerData?.claimable ?? null} totalReceived={routerData?.received ?? 0n} totalProcessed={routerData?.processed ?? 0n} destinations={routerData?.flow} isLoading={routerQuery.isPending} />
    {lifecycle === 'BONDING' ? <section className="bonding-market-card"><div className="bonding-header-row"><div><span className="market-rail-label">LIFECYCLE</span><h3 className="bonding-heading">BONDING</h3></div><strong className="progress-pct-val font-mono">{snapshot?.bondingProgress !== undefined ? `${snapshot.bondingProgress.toFixed(1)}%` : '—'}</strong></div><div className="bonding-bar-track"><div className="bonding-bar-fill" style={{ width: `${snapshot?.bondingProgress ?? 0}%` }} /></div><div className="bonding-stats-footer font-mono"><span>{reserveEth !== undefined && thresholdEth !== undefined ? `${Number(reserveEth).toFixed(3)} ETH / ${Number(thresholdEth).toFixed(2)} ETH` : 'RESERVES UNAVAILABLE'}</span><span>{toGraduation !== undefined ? `${Number(toGraduation).toFixed(3)} ETH TO GRADUATION` : '—'}</span></div></section> : null}
    <details className="terminal-advanced-section"><summary className="advanced-toggle-btn"><span>ADVANCED ON-CHAIN DETAILS</span><ChevronDown size={16} /></summary><div className="advanced-specs-box"><dl className="advanced-spec-dl">{([['TOKEN CONTRACT', tokenAddress], ['FORGE ROUTER', routerData?.address], ['PONS MARKET', snapshot?.marketAddress || tokenData?.curve], ['MIGRATED POOL', lifecycle === 'MIGRATED' ? snapshot?.pairAddress : undefined], ['CREATOR', tokenData?.deployer]] as const).map(([label, value]) => <div className="spec-item" key={label}><dt>{label}</dt><dd>{value ? <a href={explorer('address', value)} target="_blank" rel="noopener noreferrer">{value.slice(0, 8)}…{value.slice(-6)} <ExternalLink size={11} /></a> : 'Not available'}</dd></div>)}<div className="spec-item"><dt>DATA SOURCES</dt><dd>{snapshot?.sources?.join(' · ') || 'Not available'}</dd></div></dl></div></details>
  </div>;
}
