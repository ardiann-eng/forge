'use client';
import Link from 'next/link';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ArrowRight, Plus, GitBranch, ShieldCheck } from 'lucide-react';
import { formatEther, type Address } from 'viem';
import { useForgeState } from './data';
import { ForgeSearch } from './ui';
import {
  HeroFlowPipeline,
  FeaturedFlowPipeline,
  DestinationsPipelineShowcase,
} from './flow-visuals';
import { TokenCard, TokenCardSkeleton } from './token-card';
import { ActivityRow, ActivityRowSkeleton } from './activity-row';
import { normalizeForgeActivity } from '@/lib/market/activity';
import type { TokenMarketSnapshot, TokenMetadata } from '@/lib/market/types';
import type { DestinationItem } from './fee-flow-bar';

type FilterMode = 'ALL' | 'NEW' | 'TRENDING' | 'MARKET_CAP' | 'ROUTED' | 'GRADUATED';

function formatEthMetric(weiStr?: string): string {
  if (!weiStr) return '0';
  try {
    const val = Number(formatEther(BigInt(weiStr)));
    if (val === 0) return '0';
    if (val >= 1000) {
      return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    if (val >= 1) {
      return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }
    if (val >= 0.0001) {
      return val.toLocaleString('en-US', { maximumFractionDigits: 4 });
    }
    return '<0.0001';
  } catch {
    return '0';
  }
}

export function Home() {
  const { data, isLoading, isError } = useForgeState();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('ALL');

  // Query unified real-time market data from our server market resolver
  const marketTokensQuery = useQuery({
    queryKey: ['market-tokens-list'],
    queryFn: async () => {
      const res = await fetch('/api/market/tokens');
      if (!res.ok) throw new Error('Failed to load market tokens');
      return res.json() as Promise<{
        snapshots: Record<string, TokenMarketSnapshot>;
        metadata: Record<string, TokenMetadata>;
        flows: Record<
          string,
          { router: Address; destinations: DestinationItem[]; received: string; processed: string }
        >;
        tokens: Address[];
        updatedAt: number;
      }>;
    },
    refetchInterval: 10000,
  });

  const marketData = marketTokensQuery.data;
  const hasIndexedSnapshot =
    data?.state === 'ready' || data?.state === 'syncing' || data?.state === 'stale' || (marketData && marketData.tokens.length > 0);

  // Process, filter, and sort tokens according to transparent real metrics
  const processedTokens = useMemo(() => {
    const rawList =
      data?.tokens && data.tokens.length > 0
        ? data.tokens
        : (marketData?.tokens || []).map((addr) => ({
            token: addr,
            router: marketData?.flows?.[addr.toLowerCase()]?.router || ('' as Address),
            creator: ('' as Address),
          }));
    const query = search.trim().toLowerCase();

    // 1. Search filter: matches address, name, symbol, or lore
    const filtered = rawList.filter((t) => {
      const key = t.token.toLowerCase();
      const meta = marketData?.metadata?.[key];
      const matchSearch =
        !query ||
        t.token.toLowerCase().includes(query) ||
        (meta?.name && meta.name.toLowerCase().includes(query)) ||
        (meta?.symbol && meta.symbol.toLowerCase().includes(query)) ||
        (meta?.description && meta.description.toLowerCase().includes(query)) ||
        (t.name && t.name.toLowerCase().includes(query)) ||
        (t.symbol && t.symbol.toLowerCase().includes(query));

      if (!matchSearch) return false;

      const snap = marketData?.snapshots?.[key];
      const lifecycle = snap?.lifecycle || 'BONDING';

      if (filter === 'GRADUATED') return lifecycle === 'GRADUATED' || lifecycle === 'MIGRATED';

      return true;
    });

    // 2. Real sorting logic (Rule 45)
    return [...filtered].sort((a, b) => {
      const keyA = a.token.toLowerCase();
      const keyB = b.token.toLowerCase();
      const snapA = marketData?.snapshots?.[keyA];
      const snapB = marketData?.snapshots?.[keyB];
      const flowA = marketData?.flows?.[keyA];
      const flowB = marketData?.flows?.[keyB];

      if (filter === 'NEW') {
        // Most recent launch first
        return 0; // Natural reverse order from snapshot events
      }

      if (filter === 'ROUTED') {
        // FORGE total processed fees descending
        const procA = flowA ? BigInt(flowA.processed) : 0n;
        const procB = flowB ? BigInt(flowB.processed) : 0n;
        return Number(procB - procA);
      }

      if (filter === 'MARKET_CAP') {
        // Real market cap descending
        const mcA = snapA?.marketCapUsd || 0;
        const mcB = snapB?.marketCapUsd || 0;
        return mcB - mcA;
      }

      if (filter === 'TRENDING') {
        // Real transparent trending formula: 24h volume + trade activity + fees routed
        const scoreA =
          (snapA?.volume24h || 0) * 1.5 +
          ((snapA?.buys24h || 0) + (snapA?.sells24h || 0)) * 50 +
          (flowA ? Number(BigInt(flowA.processed)) / 1e18 : 0);
        const scoreB =
          (snapB?.volume24h || 0) * 1.5 +
          ((snapB?.buys24h || 0) + (snapB?.sells24h || 0)) * 50 +
          (flowB ? Number(BigInt(flowB.processed)) / 1e18 : 0);
        return scoreB - scoreA;
      }

      return 0;
    });
  }, [data?.tokens, marketData, search, filter]);

  return (
    <div className="home-container">
      {/* 08 & 09 - HOME HERO */}
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-eyebrow">
            <span className="eyebrow-mark" />
            <span>A NEW DIRECTION FOR CREATOR FEES</span>
          </div>

          <h1 className="hero-title">
            YOUR FEES.
            <br />
            YOUR RULES.
          </h1>

          <p className="hero-editorial">forge the flow.</p>

          <p className="hero-description">
            Launch your token and decide what its creator fees should do.
            <br className="hero-desc-br" />
            Buy back. Burn. Accelerate graduation. Buy dips. Distribute. Reward holders. Fund
            treasury. Pay the creator.
          </p>

          <div className="hero-actions">
            <Link className="button button-hero-primary" href="/launch">
              <span>LAUNCH TOKEN</span>
              <ArrowUpRight size={18} />
            </Link>
            <Link className="text-link-hero" href="#live">
              <span>EXPLORE LIVE</span>
              <ArrowRight size={17} />
            </Link>
          </div>
        </div>

        {/* 09 - MODERN GSAP ANIMATED FORGE FLOW PIPELINE */}
        <HeroFlowPipeline />
      </section>

      {/* 11 - HOME METRICS STRIP */}
      <section className="metrics-strip" aria-label="FORGE protocol metrics">
        <div className="metric-card metric-lime">
          <span className="metric-label">TOKENS LAUNCHED</span>
          <strong className="metric-value">
            {hasIndexedSnapshot ? String(data?.tokens?.length ?? marketData?.tokens?.length ?? 0) : '—'}
          </strong>
          <span className="metric-sub">Active fee routers</span>
        </div>

        <div className="metric-card metric-white">
          <span className="metric-label">FEES ROUTED</span>
          <strong className="metric-value">
            {data?.stats ? formatEthMetric(data.stats.received) : '—'}
            <small className="metric-unit">ETH</small>
          </strong>
          <span className="metric-sub">Total creator fees arrived</span>
        </div>

        <div className="metric-card metric-white">
          <span className="metric-label">FEES PROCESSED</span>
          <strong className="metric-value">
            {data?.stats ? formatEthMetric(data.stats.processed) : '—'}
            <small className="metric-unit">ETH</small>
          </strong>
          <span className="metric-sub">Dispatched to recipients</span>
        </div>

        <div className="metric-card metric-dark">
          <span className="metric-label">VERIFIABLE ROUTING</span>
          <strong className="metric-value metric-value-text">100%</strong>
          <span className="metric-sub metric-sub-dark">
            <GitBranch size={14} /> Immutable contracts on-chain
          </span>
        </div>
      </section>

      {/* 12 - LIVE TOKENS SECTION */}
      <section id="live" className="live-tokens-section">
        <div className="section-header-block">
          <div className="section-title-wrap">
            <div className="section-eyebrow">
              <span className="lime-dot" />
              <span>LIVE RELEASES</span>
            </div>
            <h2>LIVE ON FORGE</h2>
            <p>Tokens launched with autonomous creator-fee routing rules.</p>
          </div>

          <div className="section-controls">
            <div className="filter-pills" role="tablist" aria-label="Token filters">
              {(
                [
                  { id: 'ALL', label: 'ALL' },
                  { id: 'NEW', label: 'NEW' },
                  { id: 'TRENDING', label: 'TRENDING' },
                  { id: 'MARKET_CAP', label: 'MARKET CAP' },
                  { id: 'ROUTED', label: 'MOST ROUTED' },
                  { id: 'GRADUATED', label: 'GRADUATED' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === mode.id}
                  className={`filter-btn ${filter === mode.id ? 'active' : ''}`}
                  onClick={() => setFilter(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <ForgeSearch value={search} onChange={setSearch} label="Search name, ticker, or 0x…" />
          </div>
        </div>

        {isLoading || marketTokensQuery.isLoading ? (
          <div
            className="modern-market-cards-grid token-list-loading"
            role="status"
            aria-label="Loading live tokens"
            aria-busy="true"
          >
            {[1, 2, 3].map((item) => (
              <TokenCardSkeleton key={item} />
            ))}
            <div className="spinner-wrap">
              <span className="loading-dot" />
            </div>
            <p>Resolving live Robinhood Chain market data…</p>
          </div>
        ) : isError || marketTokensQuery.isError ? (
          <div className="empty-state-card error-tone">
            <h3>DATA UNAVAILABLE</h3>
            <p>Could not reach the indexer service. Please refresh or check connection.</p>
          </div>
        ) : processedTokens.length > 0 ? (
          <div className="modern-market-cards-grid">
            {processedTokens.map((t, index) => {
              const key = t.token.toLowerCase();
              const snap = marketData?.snapshots?.[key];
              const meta = marketData?.metadata?.[key];
              const flow = marketData?.flows?.[key];
              const isFeatured = index === 0 && (filter === 'TRENDING' || filter === 'ALL');

              return (
                <TokenCard
                  key={t.token}
                  tokenAddress={t.token}
                  snapshot={snap}
                  metadata={meta}
                  destinations={flow?.destinations}
                  totalFees={flow?.received}
                  isFeatured={isFeatured}
                />
              );
            })}
          </div>
        ) : (
          <div className="empty-state-card">
            <div className="empty-state-icon">
              <Plus size={32} strokeWidth={1.75} />
            </div>
            <h3>
              {search
                ? 'NO MATCHING TOKENS.'
                : data?.state === 'ready'
                  ? 'NO TOKENS YET.'
                  : 'WAITING FOR THE FIRST FLOW.'}
            </h3>
            <p>
              {search
                ? 'No tokens found matching your query. Try a different name, symbol, or address.'
                : data?.state === 'ready'
                  ? 'Forge the very first token on Robinhood Chain and route its fees.'
                  : 'Live listings will populate once tokens are launched through FORGE.'}
            </p>
            <div className="empty-actions">
              {search ? (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setSearch('')}
                >
                  Clear search
                </button>
              ) : (
                <Link className="button button-hero-primary" href="/launch">
                  <span>LAUNCH TOKEN</span>
                  <ArrowUpRight size={18} />
                </Link>
              )}
            </div>
          </div>
        )}
      </section>

      {/* 15 - FEATURED FLOW SECTION */}
      <section className="featured-flow-section">
        <div className="featured-flow-content">
          <div className="featured-flow-header">
            <span className="badge-tag">ALLOCATION ARCHITECTURE</span>
            <h2>
              ONE FEE STREAM.
              <br />
              ANY DIRECTION.
            </h2>
            <p className="featured-flow-lead">
              Fees come in. You choose the flow.
              <br />
              Eliminate manual transfers. Every percentage executes automatically according to your
              on-chain rules.
            </p>
            <div className="featured-flow-highlights">
              <div className="highlight-item">
                <ShieldCheck size={20} />
                <span>Zero creator tax on buyers · Native curve fees</span>
              </div>
              <div className="highlight-item">
                <GitBranch size={20} />
                <span>Autonomous distribution · Independent claims</span>
              </div>
            </div>
            <Link className="button button-dark" href="/flows">
              <span>EXPLORE ALL FLOWS</span>
              <ArrowUpRight size={17} />
            </Link>
          </div>

          <div className="featured-flow-visual">
            <FeaturedFlowPipeline />
          </div>
        </div>
      </section>

      {/* 16 - HOW IT WORKS */}
      <section id="how-it-works" className="how-it-works-section">
        <div className="section-eyebrow">
          <span className="lime-dot" />
          <span>FOUR SIMPLE STEPS</span>
        </div>
        <h2 className="section-title-large">HOW FORGE WORKS</h2>

        <div className="steps-grid">
          <div className="step-card card-white">
            <span className="step-num">01</span>
            <h3>CREATE</h3>
            <p>Add your token details, name, ticker, and project branding.</p>
          </div>

          <div className="step-card card-lime">
            <span className="step-num">02</span>
            <h3>PROGRAM</h3>
            <p>Choose where creator fees should go with intuitive sliders.</p>
          </div>

          <div className="step-card card-white">
            <span className="step-num">03</span>
            <h3>LAUNCH</h3>
            <p>Sign the real launch transaction on Robinhood Chain.</p>
          </div>

          <div className="step-card card-dark">
            <span className="step-num">04</span>
            <h3>FLOW</h3>
            <p>Creator fees automatically follow your permanent configuration.</p>
          </div>
        </div>
      </section>

      {/* 17 - WHERE FEES CAN GO */}
      <section className="destinations-section">
        <div className="section-header-block">
          <div className="section-title-wrap">
            <div className="section-eyebrow">
              <span className="lime-dot" />
              <span>FEE TARGETS</span>
            </div>
            <h2>WHERE FEES CAN GO</h2>
            <p>Direct creator fee splits into high-impact protocol destinations.</p>
          </div>
        </div>

        <DestinationsPipelineShowcase />
      </section>

      {/* 18 - ACTIVITY SECTION */}
      <section className="activity-section">
        <div className="section-header-block">
          <div className="section-title-wrap">
            <div className="section-eyebrow">
              <span className="lime-dot" />
              <span>FEED</span>
            </div>
            <h2>RECENT FLOW ACTIVITY</h2>
            <p>Live launches, fee routing, buybacks, burns and claims on Robinhood Chain.</p>
          </div>
          <Link href="/activity" className="text-link-view-all font-mono">
            <span>VIEW ALL ACTIVITY</span>
            <ArrowRight size={15} />
          </Link>
        </div>

        {isLoading ? (
          <div className="modern-activity-feed-list">
            <ActivityRowSkeleton />
            <ActivityRowSkeleton />
            <ActivityRowSkeleton />
          </div>
        ) : data?.events && data.events.length > 0 ? (
          <div className="modern-activity-feed-list">
            {data.events.slice(0, 6).map((e) => {
              const norm = normalizeForgeActivity(e, {
                tokens: data?.tokens,
                metadata: marketData?.metadata,
                allEvents: data?.events,
              });
              return <ActivityRow key={e.id} activity={norm} />;
            })}
          </div>
        ) : (
          <div className="empty-state-card compact">
            <strong className="font-mono">NO ACTIVITY YET</strong>
            <p className="muted">
              FORGE activity will appear here after the first launch or routed fee.
            </p>
          </div>
        )}
      </section>

      {/* 19 - FINAL HOME CTA */}
      <section className="final-cta-section">
        <div className="final-cta-inner">
          <div className="final-cta-copy">
            <h2>
              PUT YOUR FEES
              <br />
              TO WORK.
            </h2>
            <p>Launch your token. Forge the flow.</p>
          </div>
          <div className="final-cta-action">
            <Link className="button button-final-launch" href="/launch">
              <span>LAUNCH TOKEN</span>
              <ArrowUpRight size={20} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
