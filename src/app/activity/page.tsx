'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useConnection } from 'wagmi';
import { ArrowLeft, ArrowRight, Activity as ActivityIcon, RefreshCw } from 'lucide-react';
import { useForgeState } from '@/components/data';
import { ForgeStatus } from '@/components/ui';
import { ActivityRow, ActivityRowSkeleton } from '@/components/activity-row';
import { normalizeForgeActivity } from '@/lib/market/activity';
import type { TokenMarketSnapshot, TokenMetadata } from '@/lib/market/types';
import type { DestinationItem } from '@/components/fee-flow-bar';
import type { Address } from 'viem';

type ActivityFilter = 'ALL' | 'LAUNCHES' | 'FEES' | 'BUYBACKS' | 'BURNS' | 'CLAIMS';

export default function Activity() {
  const { address } = useConnection();
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<ActivityFilter>('ALL');

  const { data, isLoading, error } = useForgeState(page);

  // Fetch token metadata for rich token context
  const marketTokensQuery = useQuery({
    queryKey: ['market-tokens-list'],
    queryFn: async () => {
      const res = await fetch('/api/market/tokens');
      if (!res.ok) throw new Error('Failed to load market tokens');
      return res.json() as Promise<{
        snapshots: Record<string, TokenMarketSnapshot>;
        metadata: Record<string, TokenMetadata>;
        flows: Record<string, { router: Address; destinations: DestinationItem[]; received: string; processed: string }>;
        tokens: Address[];
        updatedAt: number;
      }>;
    },
    refetchInterval: 15000,
  });

  const rawEvents = data?.events;
  const rawTokens = data?.tokens;
  const metadata = marketTokensQuery.data?.metadata;

  // Normalize all events
  const normalizedEvents = useMemo(() => {
    if (!rawEvents) return [];
    return rawEvents.map((e) =>
      normalizeForgeActivity(e, {
        tokens: rawTokens,
        metadata,
        allEvents: rawEvents,
        connectedWallet: address,
      }),
    );
  }, [rawEvents, rawTokens, metadata, address]);

  // Filter events
  const filteredEvents = useMemo(() => {
    if (filter === 'ALL') return normalizedEvents;
    if (filter === 'LAUNCHES') return normalizedEvents.filter((e) => e.type === 'LAUNCH');
    if (filter === 'FEES')
      return normalizedEvents.filter(
        (e) =>
          e.type === 'FEES_ROUTED' ||
          e.type === 'FEES_RECEIVED' ||
          e.type === 'FLOW_CREATED' ||
          e.type === 'TOKEN_BOUND' ||
          e.type === 'FLOW_CONFIGURED',
      );
    if (filter === 'BUYBACKS') return normalizedEvents.filter((e) => e.type === 'BUYBACK');
    if (filter === 'BURNS') return normalizedEvents.filter((e) => e.type === 'BUY_BURN');
    if (filter === 'CLAIMS') return normalizedEvents.filter((e) => e.type === 'CLAIM');
    return normalizedEvents;
  }, [normalizedEvents, filter]);

  return (
    <div className="content-page-container">
      <div className="page-heading-block">
        <div className="section-eyebrow">
          <span className="lime-dot" />
          <span>ON-CHAIN FEED</span>
        </div>
        <h1 className="page-title-large">
          FLOW ACTIVITY.
          <br />
          ON THE RECORD.
        </h1>
        <p className="page-subtitle-lead">
          Live launches, fee routing, buybacks, burns and claims on Robinhood Chain.
        </p>
      </div>

      <div className="activity-status-header">
        <div className="activity-filters-group">
          {(
            [
              { id: 'ALL', label: 'ALL' },
              { id: 'LAUNCHES', label: 'LAUNCHES' },
              { id: 'FEES', label: 'FEES' },
              { id: 'BUYBACKS', label: 'BUYBACKS' },
              { id: 'BURNS', label: 'BURNS' },
              { id: 'CLAIMS', label: 'CLAIMS' },
            ] as const
          ).map((pill) => (
            <button
              key={pill.id}
              type="button"
              className={`activity-filter-btn font-mono ${filter === pill.id ? 'is-active' : ''}`}
              onClick={() => setFilter(pill.id)}
            >
              {pill.label}
            </button>
          ))}
        </div>

        <ForgeStatus tone="neutral">
          {data?.block ? `INDEXED THROUGH BLOCK ${data.block}` : 'INDEXER CONNECTED'}
        </ForgeStatus>
      </div>

      {isLoading ? (
        <div className="modern-activity-feed-list">
          <ActivityRowSkeleton />
          <ActivityRowSkeleton />
          <ActivityRowSkeleton />
          <ActivityRowSkeleton />
          <ActivityRowSkeleton />
        </div>
      ) : error ? (
        <div className="empty-state-card error-tone">
          <h3>ACTIVITY TEMPORARILY UNAVAILABLE</h3>
          <p>The indexer service is temporarily unreachable. Please retry shortly.</p>
          <button
            type="button"
            className="button button-secondary text-xs mt-3"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : filteredEvents.length > 0 ? (
        <div className="activity-feed-wrapper">
          <div className="modern-activity-feed-list">
            {filteredEvents.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </div>

          <div className="activity-pagination-bar">
            <button
              type="button"
              className="button button-secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ArrowLeft size={15} />
              <span>Previous</span>
            </button>
            <span className="pagination-page-label font-mono">PAGE {page + 1}</span>
            <button
              type="button"
              className="button button-secondary"
              disabled={(page + 1) * 50 >= (data?.eventCount || 0)}
              onClick={() => setPage((p) => p + 1)}
            >
              <span>Next</span>
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      ) : (
        <div className="empty-state-card">
          <div className="empty-state-icon">
            <ActivityIcon size={30} strokeWidth={1.5} />
          </div>
          <h3>NO ACTIVITY YET</h3>
          <p>FORGE activity will appear here after the first launch or routed fee.</p>
        </div>
      )}
    </div>
  );
}
