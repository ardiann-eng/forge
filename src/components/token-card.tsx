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
      {/* 1. TOP IDENTITY */}
      <div className="card-header-compact">
        <div className="card-artwork-box skeleton" />
        <div className="card-header-details">
          <div className="card-status-line">
            <div
              className="skeleton"
              style={{ width: '52px', height: '18px', borderRadius: '9999px' }}
            />
          </div>
          <div
            className="skeleton"
            style={{ width: '120px', height: '26px', borderRadius: '6px', marginBottom: '6px' }}
          />
          <div
            className="skeleton"
            style={{ width: '140px', height: '14px', borderRadius: '4px' }}
          />
        </div>
      </div>

      {/* 2. MARKET CAP & OPTIONAL METRICS */}
      <div className="card-metrics-block">
        <div className="card-mcap-group">
          <div
            className="skeleton"
            style={{ width: '68px', height: '10px', borderRadius: '3px' }}
          />
          <div
            className="skeleton"
            style={{ width: '110px', height: '28px', borderRadius: '6px' }}
          />
        </div>
        <div className="card-secondary-metrics">
          <div className="secondary-metric-item">
            <div
              className="skeleton"
              style={{ width: '52px', height: '14px', borderRadius: '4px' }}
            />
            <div
              className="skeleton"
              style={{ width: '64px', height: '9px', borderRadius: '3px' }}
            />
          </div>
          <div className="secondary-metric-item">
            <div
              className="skeleton"
              style={{ width: '52px', height: '14px', borderRadius: '4px' }}
            />
            <div
              className="skeleton"
              style={{ width: '64px', height: '9px', borderRadius: '3px' }}
            />
          </div>
        </div>
      </div>

      {/* 3. DESCRIPTION */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '22px' }}>
        <div
          className="skeleton"
          style={{ width: '100%', height: '13px', borderRadius: '4px' }}
        />
        <div
          className="skeleton"
          style={{ width: '70%', height: '13px', borderRadius: '4px' }}
        />
      </div>

      {/* 4. BONDING PROGRESS */}
      <div className="card-bonding-section">
        <div className="bonding-text-row">
          <div
            className="skeleton"
            style={{ width: '56px', height: '11px', borderRadius: '3px' }}
          />
          <div
            className="skeleton"
            style={{ width: '28px', height: '11px', borderRadius: '3px' }}
          />
        </div>
        <div
          className="skeleton"
          style={{ width: '100%', height: '7px', borderRadius: '9999px' }}
        />
        <div
          className="skeleton"
          style={{ width: '180px', height: '11px', borderRadius: '3px' }}
        />
      </div>

      {/* 5. CTA FOOTER */}
      <div className="card-terminal-cta">
        <div
          className="skeleton"
          style={{ width: '92px', height: '12px', borderRadius: '3px' }}
        />
        <div
          className="skeleton"
          style={{ width: '15px', height: '15px', borderRadius: '3px' }}
        />
      </div>
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

  const hasChange = typeof change24h === 'number' && !isNaN(change24h);
  const hasVolume = Boolean(volume24h);
  // In bonding phase, volume is shown in secondary metrics. In migrated phase, it moves to the lower info section.
  const hasSecondaryChange = hasChange;
  const hasSecondaryVolume = lifecycle === 'BONDING' && hasVolume;
  const hasSecondaryMetrics = hasSecondaryChange || hasSecondaryVolume;

  // Real reserve amounts if available
  let bondingReserveEth = '';
  let bondingTargetEth = '';
  if (snapshot?.bondingReserves) {
    try {
      bondingReserveEth = (Number(BigInt(snapshot.bondingReserves)) / 1e18).toFixed(2);
    } catch {
      // ignore
    }
  }
  if (snapshot?.bondingThreshold) {
    try {
      bondingTargetEth = (Number(BigInt(snapshot.bondingThreshold)) / 1e18).toFixed(2);
    } catch {
      // ignore
    }
  }

  const bondingSubText =
    bondingReserveEth && bondingTargetEth
      ? `${bondingReserveEth} ETH raised · ${bondingTargetEth} ETH target`
      : bondingReserveEth
        ? `${bondingReserveEth} ETH raised`
        : null;

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
                lifecycle === 'GRADUATED'
                  ? 'is-graduated'
                  : lifecycle === 'MIGRATED'
                    ? 'is-migrated'
                    : 'is-live'
              }`}
            >
              <span className="pill-dot" />
              <span>
                {lifecycle === 'GRADUATED'
                  ? 'GRADUATED'
                  : lifecycle === 'MIGRATED'
                    ? 'MIGRATED'
                    : 'LIVE'}
              </span>
            </span>
          </div>

          <h3 className="card-strong-ticker" title={`$${ticker}`}>
            ${ticker}
          </h3>

          <p className="card-sub-name" title={name}>
            {name}
          </p>
        </div>
      </div>

      {/* 2. PRIMARY MARKET CAP & OPTIONAL SECONDARY METRICS */}
      <div className="card-metrics-block">
        <div className="card-mcap-group">
          <span className="mcap-label font-mono">MARKET CAP</span>
          <strong className="mcap-value">{marketCap || '—'}</strong>
        </div>

        {hasSecondaryMetrics && (
          <div className="card-secondary-metrics">
            {hasSecondaryChange && (
              <div className="secondary-metric-item">
                <span
                  className={`secondary-metric-val font-mono ${
                    change24h > 0 ? 'is-positive' : change24h < 0 ? 'is-negative' : 'is-neutral'
                  }`}
                >
                  {change24h > 0 ? `+${change24h.toFixed(1)}%` : `${change24h.toFixed(1)}%`}
                </span>
                <span className="secondary-metric-label font-mono">24H CHANGE</span>
              </div>
            )}

            {hasSecondaryVolume && (
              <div className="secondary-metric-item">
                <span className="secondary-metric-val font-mono">{volume24h}</span>
                <span className="secondary-metric-label font-mono">24H VOLUME</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. DESCRIPTION / LORE (CLAMPED TO 2 LINES) */}
      {description && (
        <p className="card-token-lore" title={description}>
          {description}
        </p>
      )}

      {/* 4. BONDING PROGRESS OR GRADUATED/MIGRATED MARKET INFO */}
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
          {bondingSubText && (
            <span className="bonding-sub-stats font-mono">{bondingSubText}</span>
          )}
        </div>
      ) : (
        (liquidityUsd || volume24h) && (
          <div className="card-graduated-section font-mono">
            {liquidityUsd && (
              <div className="graduated-metric-col">
                <span className="grad-label">LIQUIDITY</span>
                <strong className="grad-val">{liquidityUsd}</strong>
              </div>
            )}
            {volume24h && (
              <div className="graduated-metric-col">
                <span className="grad-label">24H VOLUME</span>
                <strong className="grad-val">{volume24h}</strong>
              </div>
            )}
          </div>
        )
      )}

      {/* 5. COMPACT FOOTER CTA */}
      <div className="card-terminal-cta">
        <span className="cta-label font-mono">OPEN TERMINAL</span>
        <ArrowUpRight size={15} className="cta-arrow" />
      </div>
    </Link>
  );
}
