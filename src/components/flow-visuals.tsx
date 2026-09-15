'use client';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import {
  Coins,
  Flame,
  GitBranch,
  ShieldCheck,
  Building2,
  UserCheck,
  Activity,
  Cpu,
  ArrowUpRight,
  Sparkles,
  Zap,
} from 'lucide-react';

/* ==================================================
   HERO FLOW PIPELINE (GSAP Animated Circuit)
   ================================================== */
export function HeroFlowPipeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeBranch, setActiveBranch] = useState<number | null>(null);

  const branches = [
    { label: 'BUYBACK', pct: 40, tag: 'Market Buy', color: 'dark', icon: Coins },
    { label: 'GRAD BOOST', pct: 25, tag: 'Graduation', color: 'lime', icon: GitBranch },
    { label: 'HOLDERS', pct: 20, tag: 'Merkle Claims', color: 'white', icon: ShieldCheck },
    { label: 'TREASURY', pct: 10, tag: 'Project Reserve', color: 'soft', icon: Building2 },
    { label: 'CREATOR', pct: 5, tag: 'Direct Share', color: 'soft', icon: UserCheck },
  ];

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Flow line pulses
      gsap.to('.hero-pipe-in-pulse', {
        strokeDashoffset: -40,
        duration: 1.2,
        repeat: -1,
        ease: 'linear',
      });

      // Branch lines pulses
      gsap.to('.hero-pipe-branch-pulse', {
        strokeDashoffset: -60,
        duration: 1.8,
        repeat: -1,
        ease: 'linear',
        stagger: 0.15,
      });

      // Hub breathing effect
      gsap.to('.hero-hub-reactor', {
        boxShadow: '0 0 25px rgba(183, 255, 0, 0.45)',
        duration: 1.5,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });

      // Floating energy particles
      gsap.to('.hero-energy-dot', {
        scale: 1.3,
        opacity: 0.9,
        duration: 0.8,
        repeat: -1,
        yoyo: true,
        stagger: 0.2,
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div
      ref={containerRef}
      className="hero-pipeline-card"
      aria-label="Interactive on-chain creator-fee routing pipeline illustration"
    >
      <div className="pipeline-card-top-bar">
        <div className="pipeline-status-badge">
          <span className="pipeline-live-led" />
          <span>ROUTING PIPELINE</span>
        </div>
        <span className="pipeline-ratio-chip">100% PROGRAMMED</span>
      </div>

      <div className="hero-pipeline-body">
        {/* Source: Creator Inflow */}
        <div className="pipeline-source-node">
          <div className="source-stream-capsule">
            <span className="source-label">CREATOR FEES</span>
            <strong className="source-val font-mono">
              100<small>%</small>
            </strong>
          </div>
          <span className="source-sub-tag">INBOUND ETH</span>
        </div>

        {/* Central Router Core */}
        <div className="pipeline-hub-container">
          <div className="hero-hub-reactor">
            <span className="hub-forge-logo">F</span>
            <strong className="hub-name">FORGE</strong>
            <span className="hub-type">ROUTER</span>
          </div>
        </div>

        {/* Dynamic Branch Conduits (SVG) */}
        <svg className="hero-pipeline-svg" viewBox="0 0 160 300" preserveAspectRatio="none">
          <defs>
            <linearGradient id="pipeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0b0b0b" />
              <stop offset="100%" stopColor="#b7ff00" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Left Inflow Pipe */}
          <line x1="0" y1="150" x2="60" y2="150" stroke="#e1e1da" strokeWidth="4" />
          <line
            x1="0"
            y1="150"
            x2="60"
            y2="150"
            className="hero-pipe-in-pulse"
            stroke="#b7ff00"
            strokeWidth="3"
            strokeDasharray="8 6"
          />

          {/* 5 Branches from Hub to Cards (Y coordinates: 25, 85, 145, 205, 265) */}
          {[25, 85, 145, 205, 265].map((y, idx) => (
            <g key={idx}>
              <path
                d={`M 80 150 C 110 150, 120 ${y}, 160 ${y}`}
                fill="none"
                stroke={activeBranch === idx ? '#b7ff00' : '#e1e1da'}
                strokeWidth={activeBranch === idx ? '3.5' : '2'}
                className="transition-colors"
              />
              <path
                d={`M 80 150 C 110 150, 120 ${y}, 160 ${y}`}
                fill="none"
                stroke="#b7ff00"
                strokeWidth="2.5"
                strokeDasharray="6 8"
                className="hero-pipe-branch-pulse"
              />
            </g>
          ))}
        </svg>

        {/* 5 Destination Branch Nodes */}
        <div className="pipeline-destination-stack">
          {branches.map((b, idx) => {
            const Icon = b.icon;
            const isHovered = activeBranch === idx;
            return (
              <div
                key={b.label}
                className={`pipeline-branch-row branch-theme-${b.color} ${isHovered ? 'is-hovered' : ''}`}
                onMouseEnter={() => setActiveBranch(idx)}
                onMouseLeave={() => setActiveBranch(null)}
              >
                <div className="branch-left-wrap">
                  <div className="branch-icon-capsule">
                    <Icon size={14} />
                  </div>
                  <div className="branch-text-block">
                    <strong className="branch-title">{b.label}</strong>
                    <span className="branch-detail">{b.tag}</span>
                  </div>
                </div>
                <div className="branch-right-wrap">
                  <strong className="branch-percentage font-mono">
                    {b.pct}
                    <small>%</small>
                  </strong>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pipeline-card-bottom-bar">
        <span className="pipeline-motto">ONE FEE STREAM. ANY DIRECTION.</span>
        <span className="pipeline-audit-tag">
          <Activity size={12} className="inline-icon" />
          IMMUTABLE LOGIC
        </span>
      </div>
    </div>
  );
}

/* ==================================================
   FEATURED FLOW PIPELINE ("FOR EVERY 1.00 ETH")
   Interactive GSAP Animated Pipeline with Amount Multiplier
   ================================================== */
export function FeaturedFlowPipeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [baseAmount, setBaseAmount] = useState<number>(1.0);
  const amountDisplayRef = useRef<HTMLSpanElement>(null);

  const allocations = [
    {
      label: 'BUYBACK',
      bps: 4000,
      icon: Coins,
      desc: 'Real market buy into BuybackVault',
      tone: 'lime',
    },
    {
      label: 'GRAD BOOST',
      bps: 3000,
      icon: GitBranch,
      desc: 'Accumulates for PONS bonding buys',
      tone: 'white',
    },
    {
      label: 'HOLDERS',
      bps: 2000,
      icon: ShieldCheck,
      desc: 'Merkle holder rewards pool',
      tone: 'white',
    },
    {
      label: 'CREATOR',
      bps: 1000,
      icon: UserCheck,
      desc: 'Immediate pull claim in wallet',
      tone: 'dark',
    },
  ];

  // GSAP animations for flowing energy down the pipeline
  useEffect(() => {
    const ctx = gsap.context(() => {
      // Main central beam pulse
      gsap.to('.vertical-pipe-pulse', {
        strokeDashoffset: -80,
        duration: 1.4,
        repeat: -1,
        ease: 'linear',
      });

      // Branch conduits pulse
      gsap.to('.branch-curve-pulse', {
        strokeDashoffset: -60,
        duration: 1.6,
        repeat: -1,
        ease: 'linear',
        stagger: 0.12,
      });

      // Hub pulse
      gsap.to('.featured-core-hub', {
        boxShadow: '0 0 30px rgba(183, 255, 0, 0.4)',
        scale: 1.03,
        duration: 1.2,
        repeat: -1,
        yoyo: true,
        ease: 'power1.inOut',
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  // Tween calculation values when baseAmount changes
  const handleAmountChange = (newAmt: number) => {
    setBaseAmount(newAmt);
    if (amountDisplayRef.current) {
      gsap.fromTo(
        amountDisplayRef.current,
        { scale: 1.2, color: '#b7ff00' },
        { scale: 1.0, color: '#0b0b0b', duration: 0.35, ease: 'back.out(2)' },
      );
    }
  };

  return (
    <div ref={containerRef} className="featured-pipeline-glass-card">
      {/* Top Controls: Interactive Multiplier */}
      <div className="pipeline-top-station">
        <div className="station-header-row">
          <span className="station-sub-lbl">ALLOCATION SIMULATION</span>
          <div className="station-amount-selectors">
            {[1.0, 5.0, 10.0].map((amt) => (
              <button
                key={amt}
                type="button"
                className={`station-amt-btn ${baseAmount === amt ? 'is-selected' : ''}`}
                onClick={() => handleAmountChange(amt)}
              >
                {amt} ETH
              </button>
            ))}
          </div>
        </div>

        <div className="inflow-display-block">
          <span className="inflow-context-title">FOR EVERY</span>
          <strong className="inflow-giant-amount font-mono">
            <span ref={amountDisplayRef}>{baseAmount.toFixed(2)}</span> <small>ETH</small>
          </strong>
          <span className="inflow-caption-badge">CREATOR REVENUE INFLOW</span>
        </div>
      </div>

      {/* Central Interactive Pipeline Conduit & Core Router */}
      <div className="pipeline-conduit-section">
        <svg className="pipeline-vertical-svg" viewBox="0 0 400 120" preserveAspectRatio="none">
          {/* Central feed line into core */}
          <line x1="200" y1="0" x2="200" y2="40" stroke="#e1e1da" strokeWidth="4" />
          <line
            x1="200"
            y1="0"
            x2="200"
            y2="40"
            className="vertical-pipe-pulse"
            stroke="#b7ff00"
            strokeWidth="3.5"
            strokeDasharray="8 6"
          />

          {/* Core bus output line */}
          <line x1="200" y1="75" x2="200" y2="95" stroke="#e1e1da" strokeWidth="4" />

          {/* Curves fanning out into 4 columns */}
          {[50, 150, 250, 350].map((targetX, i) => (
            <g key={i}>
              <path
                d={`M 200 95 C 200 110, ${targetX} 105, ${targetX} 120`}
                fill="none"
                stroke="#e1e1da"
                strokeWidth="3"
              />
              <path
                d={`M 200 95 C 200 110, ${targetX} 105, ${targetX} 120`}
                fill="none"
                stroke="#b7ff00"
                strokeWidth="2.5"
                strokeDasharray="6 6"
                className="branch-curve-pulse"
              />
            </g>
          ))}
        </svg>

        {/* Core Hub Badge */}
        <div className="featured-core-hub">
          <Cpu size={16} className="core-hub-icon" />
          <span className="core-hub-title">FORGE ROUTER CORE</span>
          <span className="core-hub-state">STATE-AWARE DISPATCH</span>
        </div>
      </div>

      {/* 4 Connected Destination Pipeline Modules */}
      <div className="pipeline-modules-grid">
        {allocations.map((alloc) => {
          const Icon = alloc.icon;
          const shareETH = (baseAmount * alloc.bps) / 10000;
          const pct = alloc.bps / 100;

          return (
            <div key={alloc.label} className={`pipeline-module-card module-theme-${alloc.tone}`}>
              <div className="module-top-row">
                <div className="module-icon-pill">
                  <Icon size={16} />
                </div>
                <span className="module-pct-badge font-mono">{pct}%</span>
              </div>

              <div className="module-val-block">
                <strong className="module-eth-val font-mono">
                  {shareETH.toFixed(2)}
                  <small> ETH</small>
                </strong>
                <span className="module-title-lbl">{alloc.label}</span>
              </div>

              <p className="module-desc-txt">{alloc.desc}</p>

              <div className="module-meter-wrap">
                <div className="module-meter-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="pipeline-footer-banner">
        <div className="footer-status-pill">
          <span className="status-live-light" />
          <span>AUTONOMOUS ON-CHAIN PIPELINE</span>
        </div>
        <span className="footer-verifiable-note">Verifiable against Robinhood Chain</span>
      </div>
    </div>
  );
}

/* ==================================================
   WHERE FEES CAN GO - DESTINATIONS PIPELINE SHOWCASE
   Ultra-modern GSAP-powered interactive console
   ================================================== */
export function DestinationsPipelineShowcase() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const detailCardRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const destinations = [
    {
      id: '01',
      title: 'BUYBACK',
      tag: 'MARKET SUPPORT',
      status: 'Active',
      tone: 'success',
      icon: Coins,
      headline: 'Automated Real Market Buyback',
      desc: 'Every five minutes, the keeper uses the complete accumulated fee batch for an on-chain token buy. V2 migrated buys wait for verified protected quotes. Purchased tokens are permanently secured in the dedicated ForgeBuybackVault.',
      targetContract: 'ForgeBuybackVault',
      execution: 'PonsMarketAdapter.buy()',
      access: 'Permissionless Keeper / Anyone',
      isolation: 'Protected by Slippage Bounds',
    },
    {
      id: '02',
      title: 'BUY + BURN',
      tag: 'SUPPLY REDUCTION',
      status: 'Active',
      tone: 'success',
      icon: Flame,
      headline: 'Market Buy & Permanent Supply Burn',
      desc: 'Every five minutes, the keeper uses the complete accumulated fee batch to buy tokens and immediately burn them, permanently reducing supply.',
      targetContract: '0x000... (Circulation Burn)',
      execution: 'PonsLauncherToken.burn()',
      access: 'Permissionless Execution',
      isolation: 'Fallback to 0xdead on failure',
    },
    {
      id: '03',
      title: 'GRAD BOOST',
      tag: 'ACCELERATE GRADUATION',
      status: 'Bonding only',
      tone: 'success',
      icon: GitBranch,
      headline: 'Graduation Booster Reserve',
      desc: 'Creator fees accumulate until the configured bonding threshold is met. Bounded buys execute through the real PONS bonding market with minimum output protection.',
      targetContract: 'ForgeRouterV2',
      execution: 'Bounded bonding purchases',
      access: 'Permissionless execution',
      isolation: 'Dedicated reserve and cooldown',
    },
    {
      id: '04',
      title: 'HOLDERS',
      tag: 'COMMUNITY REWARDS',
      status: 'Rewards Active',
      tone: 'success',
      icon: ShieldCheck,
      headline: 'Merkle-Verified Holder Distributions',
      desc: 'Funds claim-based reward epochs based on historical snapshot blocks. Token holders claim their proportional share independently using cryptographic Merkle proofs with zero gas waste for non-claimers.',
      targetContract: 'ForgeHolderRewards',
      execution: 'MerkleProof.verify()',
      access: 'Any Token Holder with Proof',
      isolation: 'Double-Claim Prevention',
    },
    {
      id: '05',
      title: 'TREASURY',
      tag: 'PROJECT RESERVE',
      status: 'Active',
      tone: 'success',
      icon: Building2,
      headline: 'Autonomous DAO & Project Funding',
      desc: 'Directs a programmed share of every fee arrival straight to your project multisig, DAO treasury, or foundation vault to sustain ongoing protocol development and operational runway.',
      targetContract: 'Designated Safe / Multisig',
      execution: 'Independent Pull-Payment Claim',
      access: 'Treasury Signers',
      isolation: 'Segregated Recipient Balance',
    },
    {
      id: '06',
      title: 'CREATOR',
      tag: 'BUILDER REVENUE',
      status: 'Active',
      tone: 'success',
      icon: UserCheck,
      headline: 'Instant Non-Custodial Creator Share',
      desc: 'Ensures the token founder receives an immediate, transparent revenue stream claimable anytime directly to their connected wallet with zero intermediary fees or lockup periods.',
      targetContract: 'Connected Creator Wallet',
      execution: 'ForgeRouter.claim()',
      access: 'Deployer Wallet Only',
      isolation: 'Zero Third-Party Dependency',
    },
    {
      id: '07',
      title: 'DCA BUYBACK',
      tag: 'BUY THE DIP',
      status: 'Reserve only',
      tone: 'success',
      icon: GitBranch,
      headline: 'Deterministic Dip Levels',
      desc: 'Every five minutes, the keeper checks confirmed price movement. When a configured dip level matches, the complete accumulated DCA fee batch buys the token.',
      targetContract: 'ForgeRouterV2',
      execution: 'Waiting for verified price resolver',
      access: 'Transparent strategy rules',
      isolation: 'Fixed epoch budgets',
    },
  ];

  const current = destinations[selectedIdx];

  // GSAP animation when selected destination changes
  useEffect(() => {
    if (detailCardRef.current) {
      gsap.fromTo(detailCardRef.current, { y: 6 }, { y: 0, duration: 0.25, ease: 'power2.out' });
    }
  }, [selectedIdx]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.to('.dest-beam-laser', {
        strokeDashoffset: -48,
        duration: 1.1,
        repeat: -1,
        ease: 'linear',
      });
      gsap.to('.pipeline-core-chip', {
        boxShadow: '0 0 18px rgba(183, 255, 0, 0.65)',
        scale: 1.04,
        duration: 1.1,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    }, containerRef);
    return () => ctx.revert();
  }, [selectedIdx]);

  const CurrentIcon = current.icon;

  return (
    <div ref={containerRef} className="destinations-showcase-console">
      {/* LEFT RAIL: 7 Interactive Destination Rows */}
      <div className="dest-navigation-rail" role="tablist" aria-label="Fee destination list">
        {destinations.map((d, idx) => {
          const Icon = d.icon;
          const isSelected = idx === selectedIdx;
          return (
            <button
              key={d.title}
              type="button"
              role="tab"
              aria-selected={isSelected}
              className={`dest-rail-item ${isSelected ? 'is-selected' : ''}`}
              onClick={() => setSelectedIdx(idx)}
              onMouseEnter={() => setSelectedIdx(idx)}
            >
              <span className="dest-rail-index font-mono">{d.id}</span>
              <div className="dest-rail-icon-wrap">
                <Icon size={16} />
              </div>
              <div className="dest-rail-title-wrap">
                <strong className="dest-rail-title">{d.title}</strong>
                <span className="dest-rail-tag">{d.tag}</span>
              </div>
              <span className={`dest-rail-status-pill status-${d.tone}`}>{d.status}</span>
            </button>
          );
        })}
      </div>

      {/* RIGHT STAGE: Rich Interactive Detail Console with GSAP Animation */}
      <div ref={detailCardRef} className="dest-stage-console">
        <div className="dest-stage-header">
          <div className="dest-stage-icon-capsule">
            <CurrentIcon size={24} />
          </div>
          <div className="dest-stage-title-block">
            <span className="dest-stage-kicker font-mono">
              {current.tag} · DESTINATION {current.id}
            </span>
            <h3 className="dest-stage-main-title">{current.headline}</h3>
          </div>
          <span className="dest-stage-badge">
            <span className="stage-badge-dot" />
            {current.status.toUpperCase()}
          </span>
        </div>

        <p className="dest-stage-desc">{current.desc}</p>

        {/* High-Tech 3-Stage Animated Pipeline Conduit */}
        <div className="dest-pipeline-conduit-bar">
          {/* Stage 1: Inflow Origin */}
          <div className="pipe-stage-block stage-inbound">
            <div className="pipe-stage-header">
              <span className="pipe-pulse-dot" />
              <span className="pipe-stage-kicker font-mono">01 · INBOUND</span>
            </div>
            <strong className="pipe-stage-val font-mono">100% REVENUE</strong>
            <span className="pipe-stage-caption">PONS Creator Fees</span>
          </div>

          {/* Interconnecting Beam 1 */}
          <div className="pipe-laser-bridge">
            <svg className="pipe-laser-svg" viewBox="0 0 80 18" preserveAspectRatio="none">
              <line x1="0" y1="9" x2="80" y2="9" stroke="#e1e1da" strokeWidth="3" />
              <line
                x1="0"
                y1="9"
                x2="80"
                y2="9"
                stroke="#b7ff00"
                strokeWidth="3.5"
                strokeDasharray="6 6"
                className="dest-beam-laser"
              />
            </svg>
          </div>

          {/* Stage 2: Central Router Core Engine */}
          <div className="pipeline-core-chip">
            <div className="core-chip-inner">
              <Cpu size={14} className="core-chip-icon" />
              <span className="core-chip-name font-mono">FORGE ROUTER</span>
              <span className="core-chip-mode">DISPATCH</span>
            </div>
          </div>

          {/* Interconnecting Beam 2 */}
          <div className="pipe-laser-bridge">
            <svg className="pipe-laser-svg" viewBox="0 0 80 18" preserveAspectRatio="none">
              <line x1="0" y1="9" x2="80" y2="9" stroke="#e1e1da" strokeWidth="3" />
              <line
                x1="0"
                y1="9"
                x2="80"
                y2="9"
                stroke="#b7ff00"
                strokeWidth="3.5"
                strokeDasharray="6 6"
                className="dest-beam-laser"
              />
            </svg>
          </div>

          {/* Stage 3: Target Destination Action */}
          <div className="pipe-stage-block stage-target">
            <div className="pipe-stage-header">
              <Zap size={11} className="target-zap-icon" />
              <span className="pipe-stage-kicker font-mono">02 · EXECUTION</span>
            </div>
            <strong className="pipe-stage-val font-mono">{current.title}</strong>
            <span className="pipe-stage-caption">{current.tag}</span>
          </div>
        </div>

        {/* 4 Technical Architecture Specifications */}
        <div className="dest-specs-quad">
          <div className="dest-spec-box">
            <span className="spec-box-lbl">ON-CHAIN MECHANISM</span>
            <strong className="spec-box-val font-mono">{current.execution}</strong>
          </div>
          <div className="dest-spec-box">
            <span className="spec-box-lbl">TARGET CONTRACT</span>
            <strong className="spec-box-val font-mono">{current.targetContract}</strong>
          </div>
          <div className="dest-spec-box">
            <span className="spec-box-lbl">ACCESS POLICY</span>
            <strong className="spec-box-val font-mono">{current.access}</strong>
          </div>
          <div className="dest-spec-box">
            <span className="spec-box-lbl">FAILURE ISOLATION</span>
            <strong className="spec-box-val font-mono">{current.isolation}</strong>
          </div>
        </div>

        {/* Stage Footer CTA */}
        <div className="dest-stage-footer">
          <div className="stage-footer-note">
            <Sparkles size={14} className="sparkle-icon" />
            <span>Configurable in 1–16 destination flow allocations</span>
          </div>
          <a href="/launch" className="dest-launch-btn">
            <span>PROGRAM THIS FLOW</span>
            <ArrowUpRight size={15} />
          </a>
        </div>
      </div>
    </div>
  );
}
