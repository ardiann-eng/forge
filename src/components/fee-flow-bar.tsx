'use client';
import { type Address } from 'viem';

export interface DestinationItem {
  recipient: Address;
  bps: number;
  kind: number;
}

const KIND_INFO: Record<
  number,
  { label: string; color: string; textColor: string }
> = {
  0: { label: 'CREATOR', color: '#10b981', textColor: '#ffffff' },
  1: { label: 'TREASURY', color: '#64748b', textColor: '#ffffff' },
  2: { label: 'CUSTOM - LEGACY', color: '#475569', textColor: '#ffffff' },
  3: { label: 'BUYBACK', color: '#a3e635', textColor: '#000000' },
  4: { label: 'BURN', color: '#f97316', textColor: '#ffffff' },
  5: { label: 'LIQUIDITY - LEGACY', color: '#06b6d4', textColor: '#ffffff' },
  7: {label:'GRAD BOOST',color:'#0891b2',textColor:'#ffffff'},
  8: {label:'DCA BUYBACK',color:'#e879a6',textColor:'#000000'},
  6: { label: 'HOLDERS', color: '#a855f7', textColor: '#ffffff' },
};

export function FeeFlowBar({
  destinations,
  className = '',
}: {
  destinations?: DestinationItem[];
  className?: string;
}) {
  const items =
    destinations && destinations.length > 0
      ? destinations
      : [{ recipient: '0x0000000000000000000000000000000000000000' as Address, bps: 10000, kind: 0 }];

  return (
    <div className={`fee-flow-bar-block ${className}`}>
      <div className="fee-flow-label-row">
        <span className="fee-flow-title">FEE FLOW</span>
        <span className="fee-flow-summary-text">
          {items
            .map((item) => {
              const info = KIND_INFO[item.kind] || KIND_INFO[2];
              return `${item.bps / 100}% ${info.label}`;
            })
            .join(' · ')}
        </span>
      </div>

      <div className="fee-segmented-track" role="progressbar" aria-label="Fee allocation strategy">
        {items.map((item, idx) => {
          const info = KIND_INFO[item.kind] || KIND_INFO[2];
          const pct = item.bps / 100;
          return (
            <div
              key={idx}
              className="fee-segment"
              style={{
                width: `${pct}%`,
                backgroundColor: info.color,
              }}
              title={`${pct}% ${info.label}`}
            />
          );
        })}
      </div>
    </div>
  );
}
