'use client';
import { useState } from 'react';
import Link from 'next/link';
import { type Address } from 'viem';
import { ArrowUpRight } from 'lucide-react';
import type { DestinationItem } from './fee-flow-bar';
import type { TokenMarketSnapshot, TokenMetadata } from '@/lib/market/types';

function formatUsdValue(val?: number): string {
  if (typeof val !== 'number' || isNaN(val) || val <= 0) return '';
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  if (val >= 1) return `$${val.toFixed(2)}`;
  if (val >= 0.0001) return `$${val.toFixed(4)}`;
  return `$${val.toFixed(6)}`;
}

function resolveImageSrc(uri?: string): string | null {
  if (!uri) return null;
  if (uri.startsWith('ipfs://')) {
    return `https://gateway.pinata.cloud/ipfs/${uri.replace('ipfs://', '')}`;
  }
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }
  return null;
}

export function TokenCardSkeleton() {
  return (
    <div className="token-market-card token-card-skeleton" aria-hidden="true">
      <div className="card-header-compact">
        <div className="card-artwork-box skeleton" />
        <div className="card-header-details">
          <div className="skeleton" style={{ width: '56px', height: '16px', borderRadius: '9999px' }} />
          <div className="skeleton" style={{ width: '110px', height: '22px', borderRadius: '4px', marginTop: '4px' }} />
          <div className="skeleton" style={{ width: '140px', height: '12px', borderRadius: '4px', marginTop: '4px' }} />
          <div className="skeleton" style={{ width: '90px', height: '18px', borderRadius: '4px', marginTop: '6px' }} />
        </div>
      </div>
      <div className="skeleton" style={{ width: '100%', height: '28px', borderRadius: '4px' }} />
      <div className="skeleton" style={{ width: '100%', height: '6px', borderRadius: '3px' }} />
      <div className="skeleton" style={{ width: '100%', height: '14px', borderRadius: '4px' }} />
    </div>
  );
}

export function TokenCard({
  tokenAddress,
  snapshot,
  metadata,
  isFeatured = false,
}: {
  tokenAddress: Address;
  snapshot?: TokenMarketSnapshot;
  metadata?: TokenMetadata;
  destinations?: DestinationItem[];
  totalFees?: string;
  isFeatured?: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const name = metadata?.name || `${tokenAddress.slice(0, 6)}…${tokenAddress.slice(-4)}`;
  const ticker = metadata?.symbol || 'TOKEN';
  const description = metadata?.description;
  const imageSrc = resolveImageSrc(metadata?.logo);
  const lifecycle = snapshot?.lifecycle || 'BONDING';

  const marketCap = formatUsdValue(snapshot?.marketCapUsd);
  const volume24h = formatUsdValue(snapshot?.volume24h);
  const liquidityUsd = formatUsdValue(snapshot?.liquidityUsd);
  const change24h = snapshot?.change24h;
  const bondingProgress = snapshot?.bondingProgress ?? 0;

  // Real reserve amounts if available
  let bondingReserveEth = '';
  let bondingTargetEth = '';
  if (snapshot?.bondingReserves && snapshot?.bondingThreshold) {
    try {
      bondingReserveEth = (Number(BigInt(snapshot.bondingReserves)) / 1e18).toFixed(2);
      bondingTargetEth = (Number(BigInt(snapshot.bondingThreshold)) / 1e18).toFixed(2);
    } catch {
      // ignore
    }
  }

  return (
    <Link
      href={`/token/${tokenAddress}`}
      className={`token-market-card ${isFeatured ? 'is-featured' : ''}`}
      aria-label={`View token ${name} ($${ticker})`}
    >
      {/* 1. TOP HEADER: ARTWORK + COMPACT IDENTITY */}
      <div className="card-header-compact">
        <div className="card-artwork-box">
          {imageSrc && !imgError ? (
            <img
              src={imageSrc}
              alt={name}
              className="card-token-img"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="card-token-placeholder font-mono">
              <span>{ticker.slice(0, 2).toUpperCase()}</span>
            </div>
          )}
        </div>

        <div className="card-header-details">
          <div className="card-status-line">
            <span
              className={`card-lifecycle-pill ${
                lifecycle === 'GRADUATED' || lifecycle === 'MIGRATED' ? 'is-graduated' : 'is-live'
              }`}
            >
              <span className="pill-dot" />
              <span>{lifecycle === 'GRADUATED' ? 'GRADUATED' : lifecycle === 'MIGRATED' ? 'MIGRATED' : 'LIVE'}</span>
            </span>

            {typeof change24h === 'number' && (
              <span
                className={`card-change-badge font-mono ${
                  change24h > 0 ? 'is-positive' : change24h < 0 ? 'is-negative' : 'is-neutral'
                }`}
              >
                {change24h > 0 ? `+${change24h.toFixed(1)}%` : `${change24h.toFixed(1)}%`}
              </span>
            )}
          </div>

          <h3 className="card-strong-ticker font-mono" title={`$${ticker}`}>
            ${ticker}
          </h3>

          <p className="card-sub-name" title={name}>
            {name}
          </p>

          <div className="card-mcap-row font-mono">
            <span className="mcap-label">MCAP</span>
            <strong className="mcap-value">{marketCap || '—'}</strong>
            {volume24h && <span className="mcap-vol-tag text-xs muted">· Vol {volume24h}</span>}
          </div>
        </div>
      </div>

      {/* 2. DESCRIPTION / LORE (CLAMPED TO 2 LINES) */}
      {description && (
        <p className="card-token-lore" title={description}>
          {description}
        </p>
      )}

      {/* 3. BONDING PROGRESS OR GRADUATED LIQUIDITY */}
      {lifecycle === 'BONDING' ? (
        <div className="card-bonding-section">
          <div className="bonding-text-row">
            <span className="bonding-kicker font-mono">BONDING</span>
            <span className="bonding-pct font-mono">{bondingProgress.toFixed(0)}%</span>
          </div>
          <div className="bonding-track-bar">
            <div
              className="bonding-fill-bar"
              style={{ width: `${Math.min(100, Math.max(0, bondingProgress))}%` }}
            />
          </div>
          {bondingReserveEth && bondingTargetEth && (
            <span className="bonding-sub-stats font-mono">
              {bondingReserveEth} / {bondingTargetEth} ETH
            </span>
          )}
        </div>
      ) : (
        liquidityUsd && (
          <div className="card-graduated-info font-mono">
            <span className="grad-label">LIQUIDITY</span>
            <strong className="grad-val">{liquidityUsd}</strong>
          </div>
        )
      )}

      {/* 4. COMPACT FOOTER CTA */}
      <div className="card-terminal-cta">
        <span className="cta-label font-mono">OPEN TERMINAL</span>
        <ArrowUpRight size={13} className="cta-arrow" />
      </div>
    </Link>
  );
}
