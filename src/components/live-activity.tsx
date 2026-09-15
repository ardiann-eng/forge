'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { LiveActivityItem, LiveTrade } from '@/lib/market/types';
import { explorer } from '@/lib/config';

function timeAgo(timestamp: number) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return seconds < 5 ? 'now' : `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function shortAddress(value?: string) {
  return value ? `${value.slice(0, 5)}…${value.slice(-4)}` : '—';
}

export function LiveActivity({ trades, activity, tokenSymbol, isLoading = false, isError = false }: { trades: LiveTrade[]; activity: LiveActivityItem[]; tokenSymbol?: string; isLoading?: boolean; isError?: boolean }) {
  const [tab, setTab] = useState<'ALL' | 'TRADES' | 'FORGE'>('ALL');
  const combined = [
    ...trades.map((item) => ({ id: item.id, category: 'TRADE' as const, type: item.type, timestamp: item.timestamp, txHash: item.txHash, nativeAmount: item.nativeAmount, tokenAmount: item.tokenAmount, wallet: item.buyer || item.seller || item.recipient })),
    ...activity.map((item) => ({ id: item.id, category: 'FORGE' as const, type: item.type, timestamp: item.timestamp, txHash: item.txHash, nativeAmount: item.nativeAmount, tokenAmount: item.tokenAmount, wallet: item.actor || item.recipient })),
  ].sort((a, b) => b.timestamp - a.timestamp);
  const items = tab === 'ALL' ? combined : combined.filter((item) => item.category === (tab === 'TRADES' ? 'TRADE' : 'FORGE'));

  return <div className="live-activity-terminal-card">
    <div className="activity-card-header"><div className="activity-title-group"><span className="live-indicator-dot" /><h3 className="activity-title">LIVE ACTIVITY</h3></div><div className="activity-tabs" role="tablist" aria-label="Activity filters">{(['ALL', 'TRADES', 'FORGE'] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={`activity-tab-btn ${tab === item ? 'is-active' : ''}`} onClick={() => setTab(item)}>{item}</button>)}</div></div>
    <div className="activity-table-wrap">
      {isLoading ? <div className="activity-skeleton" aria-busy="true">{[1,2,3,4,5].map((row) => <div className="activity-skeleton-row" key={row}><span className="skeleton skeleton-dot" /><span className="skeleton skeleton-action" /><span className="skeleton skeleton-amount" /><span className="skeleton skeleton-time" /></div>)}</div> : isError ? <div className="activity-empty-state"><strong>ACTIVITY TEMPORARILY UNAVAILABLE</strong><span>Confirmed events will return automatically.</span></div> : !items.length ? <div className="activity-empty-state"><strong>NO ACTIVITY YET</strong><span>Waiting for the first trade or FORGE event.</span></div> : <table className="activity-table font-mono"><thead><tr><th>ACTION</th><th>WALLET</th><th>ETH</th><th>{tokenSymbol || 'TOKEN'}</th><th>TIME</th><th><span className="sr-only">Transaction</span></th></tr></thead><tbody>{items.slice(0, 50).map((item) => <tr key={item.id} className={`activity-row is-${item.type.toLowerCase()}`}><td><span className={`activity-badge tag-${item.type.toLowerCase().replace('_reward', 's').replace('fee_routed', 'forge')}`}>{item.type==='LIQUIDITY'?'LEGACY LIQUIDITY':item.type.replaceAll('_', ' ')}</span></td><td className="wallet-cell">{shortAddress(item.wallet)}</td><td>{item.nativeAmount !== undefined ? (Number(item.nativeAmount) / 1e18).toFixed(4) : '—'}</td><td>{item.tokenAmount !== undefined ? (Number(item.tokenAmount) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</td><td className="muted">{timeAgo(item.timestamp)}</td><td><a href={explorer('tx', item.txHash)} target="_blank" rel="noopener noreferrer" className="tx-link" aria-label="View transaction"><ExternalLink size={13} /></a></td></tr>)}</tbody></table>}
    </div>
  </div>;
}
