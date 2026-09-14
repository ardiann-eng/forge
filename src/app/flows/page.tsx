import Link from 'next/link';
import {
  ArrowUpRight,
  LockKeyhole,
  Coins,
  Flame,
  GitBranch,
  ShieldCheck,
  Building2,
  UserCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { destinationOptions } from '@/lib/flow';
import { ForgeStatus } from '@/components/ui';

export default function Flows() {
  const iconMap: Record<string, LucideIcon> = {
    '0': UserCheck,
    '1': Building2,
    '2': Wallet,
    '3': Coins,
    '4': Flame,
    '5': GitBranch,
    '6': ShieldCheck,
  };

  return (
    <div className="content-page-container">
      <div className="page-heading-block">
        <div className="section-eyebrow">
          <span className="lime-dot" />
          <span>ALLOCATION DIRECTORY</span>
        </div>
        <h1 className="page-title-large">
          ONE FEE STREAM.
          <br />
          EVERY DESTINATION.
        </h1>
        <p className="page-subtitle-lead">
          Creator fees arrive continuously in your token’s dedicated router.
          <br />
          Your immutable allocation rules determine how every dollar is distributed.
        </p>
      </div>

      <div className="flows-list-container">
        {destinationOptions.map((d, i) => {
          const Icon = iconMap[d.value] || GitBranch;
          return (
            <div key={d.value} className="destination-row-item">
              <span className="dest-index font-mono">0{i + 1}</span>
              <div className="dest-icon-box">
                <Icon size={22} />
              </div>
              <div className="dest-text-content">
                <h2 className="dest-title">{d.label}</h2>
                <p className="dest-explanation">{d.description}</p>
              </div>
              <div className="dest-status-col">
                <ForgeStatus tone="success">
                  {d.value === '5' ? 'Accumulating' : d.value === '6' ? 'Rewards Active' : 'Active'}
                </ForgeStatus>
              </div>
            </div>
          );
        })}
      </div>

      <div className="immutable-notice-block">
        <LockKeyhole size={22} />
        <div>
          <strong>Immutable On-Chain Execution</strong>
          <p>
            Allocations cannot be altered once the dedicated router contract is deployed.
            Recipients claim independently and securely. One destination failure cannot block
            another.
          </p>
        </div>
      </div>

      <div className="flows-cta-block">
        <Link href="/launch" className="button button-lime">
          <span>PROGRAM YOUR FLOW</span>
          <ArrowUpRight size={18} />
        </Link>
      </div>
    </div>
  );
}
