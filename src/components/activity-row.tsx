'use client';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { NormalizedActivity } from '@/lib/market/activity';
import { explorer } from '@/lib/config';

export function ActivityRow({ activity }: { activity: NormalizedActivity }) {
  const Icon = activity.icon;
  const isTokenLinkable = !!activity.tokenAddress;

  return (
    <article className={`modern-activity-row accent-${activity.accent}`}>
      {/* 1. Categorical Icon */}
      <div className="activity-icon-container">
        <Icon size={18} strokeWidth={2.2} />
      </div>

      {/* 2. Action & Token Primary Identity */}
      <div className="activity-entity-col">
        <div className="activity-headline-row">
          <strong className="activity-action-title">{activity.title}</strong>
          {activity.tokenSymbol && (
            <span className="activity-token-tag font-mono">
              {isTokenLinkable ? (
                <Link
                  href={`/token/${activity.tokenAddress}`}
                  className="activity-token-link"
                  onClick={(e) => e.stopPropagation()}
                >
                  ${activity.tokenSymbol}
                </Link>
              ) : (
                `$${activity.tokenSymbol}`
              )}
            </span>
          )}
        </div>
        {activity.tokenName && (
          <span className="activity-token-subname" title={activity.tokenName}>
            {activity.tokenName}
          </span>
        )}
      </div>

      {/* 3. Meaningful Result / Outcome */}
      <div className="activity-result-col">
        <p className="activity-result-desc" title={activity.description}>
          {activity.description}
        </p>
      </div>

      {/* 4. Relative Time with UTC Tooltip */}
      <div className="activity-time-col">
        <span
          className="activity-relative-time font-mono"
          title={`${activity.fullDate} · Block ${activity.blockNumber}`}
        >
          {activity.timeAgo}
        </span>
      </div>

      {/* 5. Clean Transaction Action */}
      <div className="activity-action-col">
        <a
          href={explorer('tx', activity.txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="activity-tx-btn font-mono"
          title={`View transaction on Blockscout: ${activity.txHash}`}
        >
          <span>VIEW TX</span>
          <ExternalLink size={12} className="tx-ext-arrow" />
        </a>
      </div>
    </article>
  );
}

export function ActivityRowSkeleton() {
  return (
    <div className="modern-activity-row activity-skeleton" aria-hidden="true">
      <div className="activity-icon-container skeleton" />
      <div className="activity-entity-col">
        <div className="skeleton" style={{ width: '120px', height: '16px', borderRadius: '4px' }} />
        <div className="skeleton" style={{ width: '80px', height: '12px', borderRadius: '4px', marginTop: '4px' }} />
      </div>
      <div className="activity-result-col">
        <div className="skeleton" style={{ width: '200px', height: '14px', borderRadius: '4px' }} />
      </div>
      <div className="activity-time-col">
        <div className="skeleton" style={{ width: '50px', height: '12px', borderRadius: '4px' }} />
      </div>
      <div className="activity-action-col">
        <div className="skeleton" style={{ width: '70px', height: '24px', borderRadius: '6px' }} />
      </div>
    </div>
  );
}
