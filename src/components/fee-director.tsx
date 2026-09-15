'use client';
import { useState, useId, useMemo, useEffect, useRef, useCallback } from 'react';
import { isAddress, type Address } from 'viem';
import * as Slider from '@radix-ui/react-slider';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  Coins,
  Flame,
  GitBranch,
  ShieldCheck,
  Building2,
  UserCheck,
  Sparkles,
  Check,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  type LucideIcon,
} from 'lucide-react';
import { validateFlow, type Flow } from '@/lib/flow';
import { defaultStrategies, validateStrategies, type Strategies } from '@/lib/strategies';
import { StrategyEditor } from './strategy-editor';

/* ==================================================
   TYPES & CONSTANTS
   ================================================== */
export type DestinationKey =
  'buyback' | 'buyBurn' | 'gradBoost' | 'dca' | 'holders' | 'creator' | 'treasury';

export type DestinationConfig = {
  key: DestinationKey;
  kind: number;
  label: string;
  shortName: string;
  tag: string;
  description: string;
  icon: LucideIcon;
  color: string;
  needsWallet: boolean;
  walletLabel?: string;
  walletPlaceholder?: string;
};

export const DESTINATIONS: DestinationConfig[] = [
  {
    key: 'buyback',
    kind: 3,
    label: 'BUYBACK',
    shortName: 'Buyback',
    tag: 'Market Support',
    description: 'Autonomous market buy into ForgeBuybackVault.',
    icon: Coins,
    color: '#a3e635',
    needsWallet: false,
  },
  {
    key: 'buyBurn',
    kind: 4,
    label: 'BUY + BURN',
    shortName: 'Buy + Burn',
    tag: 'Supply Reduction',
    description: 'Market buy followed by permanent native token burn.',
    icon: Flame,
    color: '#ea580c',
    needsWallet: false,
  },
  {
    key: 'gradBoost',
    kind: 7,
    label: 'GRAD BOOST',
    shortName: 'Grad',
    tag: 'Accelerate Graduation',
    description: 'Reserve for real PONS bonding buys.',
    icon: GitBranch,
    color: '#0891b2',
    needsWallet: false,
  },
  {
    key: 'holders',
    kind: 6,
    label: 'HOLDERS',
    shortName: 'Holders',
    tag: 'Community Rewards',
    description: 'Funds claim-based Merkle holder rewards distribution.',
    icon: ShieldCheck,
    color: '#8b5cf6',
    needsWallet: false,
  },
  {
    key: 'creator',
    kind: 0,
    label: 'CREATOR',
    shortName: 'Creator',
    tag: 'Builder Share',
    description: 'Instant pull claim in your connected creator wallet.',
    icon: UserCheck,
    color: '#10b981',
    needsWallet: false,
  },
  {
    key: 'treasury',
    kind: 1,
    label: 'TREASURY',
    shortName: 'Treasury',
    tag: 'Project Reserve',
    description: 'Routes allocated fees to a project multisig or DAO safe.',
    icon: Building2,
    color: '#0284c7',
    needsWallet: true,
    walletLabel: 'Treasury Recipient',
    walletPlaceholder: '0x... (Multisig or DAO safe)',
  },
];

DESTINATIONS.push({
  key: 'dca',
  kind: 8,
  label: 'DCA BUYBACK',
  shortName: 'DCA',
  tag: 'Buy the Dip Automatically',
  description: 'Deterministic dip levels; execution awaits a verified price resolver.',
  icon: Coins,
  color: '#e879a6',
  needsWallet: false,
});

DESTINATIONS.sort(
  (a, b) => [3, 4, 6, 1, 0, 7, 8].indexOf(a.kind) - [3, 4, 6, 1, 0, 7, 8].indexOf(b.kind),
);

export type AllocationsState = Record<DestinationKey, number>;

export const PRESETS: {
  id: string;
  name: string;
  allocations: AllocationsState;
}[] = [
  {
    id: 'BALANCED',
    name: 'Balanced',
    allocations: {
      buyback: 4000,
      buyBurn: 0,
      gradBoost: 3000,
      holders: 2000,
      creator: 1000,
      treasury: 0,
      dca: 0,
    },
  },
  {
    id: 'BUYBACK',
    name: 'Buyback Focus',
    allocations: {
      buyback: 7000,
      buyBurn: 0,
      gradBoost: 2000,
      holders: 0,
      creator: 1000,
      treasury: 0,
      dca: 0,
    },
  },
  {
    id: 'BURN',
    name: 'Burn Focus',
    allocations: {
      buyback: 0,
      buyBurn: 7000,
      gradBoost: 2000,
      holders: 0,
      creator: 1000,
      treasury: 0,
      dca: 0,
    },
  },
  {
    id: 'COMMUNITY',
    name: 'Community',
    allocations: {
      buyback: 2000,
      buyBurn: 0,
      gradBoost: 2000,
      holders: 5000,
      creator: 1000,
      treasury: 0,
      dca: 0,
    },
  },
  {
    id: 'CREATOR_FIRST',
    name: 'Creator First',
    allocations: {
      buyback: 0,
      buyBurn: 0,
      gradBoost: 0,
      holders: 0,
      creator: 10000,
      treasury: 0,
      dca: 0,
    },
  },
];

PRESETS.push(
  {
    id: 'GRADUATION_PUSH',
    name: 'Graduation Push',
    allocations: {
      buyback: 2000,
      buyBurn: 0,
      holders: 1000,
      creator: 1000,
      treasury: 0,
      gradBoost: 6000,
      dca: 0,
    },
  },
  {
    id: 'DCA_DEFENSE',
    name: 'DCA Defense',
    allocations: {
      buyback: 2000,
      buyBurn: 0,
      holders: 1000,
      creator: 1000,
      treasury: 0,
      gradBoost: 0,
      dca: 6000,
    },
  },
);

/* ==================================================
   1. DISTRIBUTION OVERVIEW (Segmented Bar + Smart Remaining)
   ================================================== */
export function DistributionOverview({
  totalBps,
  allocations,
  selectedKey,
  onSelectKey,
  onAdjustAdjacent,
  onAssignRemaining,
}: {
  totalBps: number;
  allocations: AllocationsState;
  selectedKey: DestinationKey;
  onSelectKey: (key: DestinationKey) => void;
  onAdjustAdjacent?: (keyLeft: DestinationKey, keyRight: DestinationKey, deltaBps: number) => void;
  onAssignRemaining?: () => void;
}) {
  const isComplete = totalBps === 10000;
  const isOver = totalBps > 10000;
  const remainingBps = Math.max(0, 10000 - totalBps);

  const activeSegments = useMemo(() => {
    return DESTINATIONS.filter((d) => (allocations[d.key] || 0) > 0).map((d) => ({
      ...d,
      bps: allocations[d.key],
      pct: (allocations[d.key] / 100).toFixed(allocations[d.key] % 100 === 0 ? 0 : 1),
      widthPct: (allocations[d.key] / 10000) * 100,
    }));
  }, [allocations]);

  // Segment boundary drag
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    idx: number;
    startX: number;
    startBpsLeft: number;
    startBpsRight: number;
    keyLeft: DestinationKey;
    keyRight: DestinationKey;
  } | null>(null);

  const handlePointerDown = (e: React.PointerEvent, idx: number) => {
    if (!onAdjustAdjacent || idx >= activeSegments.length - 1) return;
    const segLeft = activeSegments[idx];
    const segRight = activeSegments[idx + 1];
    if (!segLeft || !segRight) return;

    dragRef.current = {
      idx,
      startX: e.clientX,
      startBpsLeft: segLeft.bps,
      startBpsRight: segRight.bps,
      keyLeft: segLeft.key,
      keyRight: segRight.key,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !barRef.current || !onAdjustAdjacent) return;
    const barWidth = barRef.current.clientWidth;
    if (barWidth <= 0) return;

    const deltaX = e.clientX - dragRef.current.startX;
    const deltaPct = (deltaX / barWidth) * 100;
    const deltaBps = Math.round((deltaPct * 100) / 100) * 100;

    const maxShiftLeft = -dragRef.current.startBpsLeft;
    const maxShiftRight = dragRef.current.startBpsRight;
    const clampedDelta = Math.max(maxShiftLeft, Math.min(maxShiftRight, deltaBps));

    onAdjustAdjacent(dragRef.current.keyLeft, dragRef.current.keyRight, clampedDelta);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      dragRef.current = null;
    }
  };

  return (
    <div className="unified-distribution-overview">
      <div className="overview-title-row">
        <div className="overview-meta-left">
          <span className="overview-kicker font-mono">DISTRIBUTION OVERVIEW</span>
          <div className="overview-headline">
            <strong className="overview-pct font-mono">
              {(totalBps / 100).toFixed(totalBps % 100 === 0 ? 0 : 1)}%
            </strong>
            <span className="overview-target font-mono">/ 100% TARGET</span>
          </div>
        </div>

        <div className="overview-status-pill">
          {isComplete ? (
            <span className="status-badge-ready font-mono">
              <Check size={13} strokeWidth={3} /> 100% ALLOCATED · READY
            </span>
          ) : isOver ? (
            <span className="status-badge-over font-mono">
              <AlertCircle size={13} strokeWidth={2.5} /> OVER ALLOCATED ·{' '}
              {((totalBps - 10000) / 100).toFixed(1)}%
            </span>
          ) : (
            <div className="remaining-action-group">
              <span className="status-badge-remaining font-mono">
                {(remainingBps / 100).toFixed(remainingBps % 100 === 0 ? 0 : 1)}% REMAINING
              </span>
              {onAssignRemaining && (
                <button
                  type="button"
                  className="assign-remaining-btn font-mono"
                  onClick={onAssignRemaining}
                  title="Assign remaining balance to selected destination"
                >
                  <span>ASSIGN REMAINING</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Multi-Segment Allocation Bar */}
      <Tooltip.Provider delayDuration={100}>
        <div className="allocation-segmented-bar-wrap" ref={barRef}>
          <div
            className="allocation-segmented-bar"
            role="progressbar"
            aria-label="Fee distribution bar"
            aria-valuenow={totalBps / 100}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {activeSegments.map((seg, i) => (
              <div
                key={seg.key}
                className={`allocation-segment segment-${seg.key} ${selectedKey === seg.key ? 'is-selected' : ''}`}
                style={{
                  width: `${seg.widthPct}%`,
                  backgroundColor: seg.color,
                }}
                onClick={() => onSelectKey(seg.key)}
              >
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <div className="segment-label-content">
                      {seg.widthPct >= 10 && (
                        <span className="segment-text font-mono">
                          {seg.shortName} {seg.pct}%
                        </span>
                      )}
                    </div>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content className="tooltip segment-tooltip" sideOffset={6}>
                      <strong>{seg.label}</strong>: {seg.pct}% ({(seg.bps / 10000).toFixed(4)} ETH /
                      1 ETH)
                      <Tooltip.Arrow />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>

                {i < activeSegments.length - 1 && onAdjustAdjacent && (
                  <div
                    className="segment-drag-handle"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      handlePointerDown(e, i);
                    }}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    title="Drag to balance adjacent allocations"
                    aria-label={`Adjust boundary between ${seg.shortName} and ${activeSegments[i + 1]?.shortName}`}
                  />
                )}
              </div>
            ))}

            {activeSegments.length === 0 && (
              <div className="allocation-bar-empty font-mono">
                <span>0% Allocated · Select a destination below or pick a preset</span>
              </div>
            )}
          </div>
        </div>
      </Tooltip.Provider>
    </div>
  );
}

/* ==================================================
   2. DESTINATION CARD (Equal Heights, Clear Typography, No Crowding)
   ================================================== */
export function DestinationCard({
  config,
  bps,
  isSelected,
  onSelect,
  creatorConnected,
}: {
  config: DestinationConfig;
  bps: number;
  isSelected: boolean;
  onSelect: () => void;
  creatorConnected?: boolean;
}) {
  const Icon = config.icon;
  const currentPct = (bps / 100).toFixed(bps % 100 === 0 ? 0 : 1);
  const isActive = bps > 0;
  const isCreatorWarning = config.key === 'creator' && bps > 0 && !creatorConnected;

  return (
    <button
      type="button"
      className={`destination-card-item ${isSelected ? 'is-selected' : ''} ${isActive ? 'is-active' : 'is-zero'}`}
      onClick={onSelect}
      aria-pressed={isSelected}
      aria-label={`Select ${config.label} allocation (${currentPct}%)`}
    >
      <div className="card-item-left">
        <div
          className="dest-icon-badge"
          style={{
            backgroundColor: isActive ? config.color : undefined,
            color:
              isActive && config.color === '#a3e635' ? '#09090b' : isActive ? '#ffffff' : '#64748b',
          }}
        >
          <Icon size={18} strokeWidth={2.2} />
        </div>

        <div className="dest-text-column">
          <div className="dest-title-row">
            <strong className="dest-title-text">{config.label}</strong>
            {isCreatorWarning && (
              <span
                className="dest-warning-badge font-mono"
                title="Connect wallet to claim creator fees"
              >
                <AlertCircle size={11} /> Wallet required
              </span>
            )}
          </div>
          <span className="dest-descriptor-text">{config.tag}</span>
        </div>
      </div>

      <div className="card-item-right font-mono">
        <strong className={`dest-pct-value ${isActive ? 'is-highlighted' : 'is-muted'}`}>
          {currentPct}%
        </strong>
      </div>
    </button>
  );
}

/* ==================================================
   3. SEPARATE CONTEXTUAL RECIPIENT INPUTS (Below Grid)
   ================================================== */
export function ContextualRecipientInputs({
  allocations,
  treasuryWallet,
  onTreasuryChange,
}: {
  allocations: AllocationsState;
  treasuryWallet: string;
  onTreasuryChange: (value: string) => void;
}) {
  const id = useId();
  if (!allocations.treasury) return null;
  return (
    <div className="contextual-recipients-container">
      <label htmlFor={id}>Treasury Wallet Address</label>
      <input
        id={id}
        className="recipient-input"
        value={treasuryWallet}
        onChange={(e) => onTreasuryChange(e.target.value.trim())}
        placeholder="0x..."
        aria-invalid={!!treasuryWallet && !isAddress(treasuryWallet)}
      />
    </div>
  );
}

/* ==================================================
   4. SHARED SLIDER (Primary Control)
   ================================================== */
export function SharedAllocationSlider({
  config,
  currentBps,
  maxAllowedBps,
  onChangeBps,
}: {
  config: DestinationConfig;
  currentBps: number;
  maxAllowedBps: number;
  onChangeBps: (newBps: number) => void;
}) {
  const Icon = config.icon;
  const currentPct = (currentBps / 100).toFixed(currentBps % 100 === 0 ? 0 : 1);
  const maxAllowedPct = (maxAllowedBps / 100).toFixed(0);

  const handleSlider = (vals: number[]) => {
    const val = vals[0] ?? 0;
    const clamped = Math.max(0, Math.min(maxAllowedBps, Math.round(val)));
    onChangeBps(clamped);
  };

  const handleDelta = (deltaPct: number) => {
    const next = currentBps + deltaPct * 100;
    onChangeBps(Math.max(0, Math.min(maxAllowedBps, next)));
  };

  return (
    <div className="shared-slider-control-card">
      <div className="slider-card-top-row">
        <div className="slider-active-route">
          <div className="slider-route-dot" style={{ backgroundColor: config.color }} />
          <Icon size={16} className="text-ink" />
          <strong className="slider-route-name">{config.label}</strong>
          <span className="slider-route-pct font-mono">{currentPct}%</span>
        </div>

        <div className="slider-max-info font-mono">
          <span>MAX AVAILABLE: {maxAllowedPct}%</span>
        </div>
      </div>

      <div className="slider-track-container">
        <Slider.Root
          className="slider"
          value={[currentBps]}
          min={0}
          max={Math.max(100, maxAllowedBps)}
          step={100}
          onValueChange={handleSlider}
          aria-label={`${config.label} percentage slider`}
        >
          <Slider.Track className="slider-track">
            <Slider.Range className="slider-range" style={{ backgroundColor: config.color }} />
          </Slider.Track>
          <Slider.Thumb className="slider-thumb" aria-label={`${config.label} slider thumb`} />
        </Slider.Root>
      </div>

      <div className="slider-quick-chips font-mono">
        <button
          type="button"
          className="slider-chip-btn"
          onClick={() => handleDelta(-5)}
          disabled={currentBps <= 0}
        >
          -5%
        </button>
        <button
          type="button"
          className="slider-chip-btn"
          onClick={() => handleDelta(5)}
          disabled={currentBps >= maxAllowedBps}
        >
          +5%
        </button>
        <button
          type="button"
          className="slider-chip-btn"
          onClick={() => onChangeBps(0)}
          disabled={currentBps === 0}
        >
          0%
        </button>
        <button
          type="button"
          className="slider-chip-btn chip-max"
          onClick={() => onChangeBps(maxAllowedBps)}
          disabled={currentBps === maxAllowedBps || maxAllowedBps === 0}
        >
          MAX ({maxAllowedPct}%)
        </button>
      </div>
    </div>
  );
}

/* ==================================================
   5. STRATEGY PRESETS BAR
   ================================================== */
export function StrategyPresetsBar({
  activePresetId,
  onApplyPreset,
}: {
  activePresetId: string | null;
  onApplyPreset: (id: string) => void;
}) {
  return (
    <div className="strategy-presets-wrapper">
      <span className="presets-label font-mono">
        <Sparkles size={13} className="text-lime-500" /> STRATEGY PRESETS
      </span>
      <div className="presets-pills-row">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`preset-pill ${activePresetId === p.id ? 'is-active' : ''}`}
            onClick={() => onApplyPreset(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ==================================================
   6. DARK ALLOCATION PREVIEW (Clean List, For Every 1 ETH)
   ================================================== */
export function DarkAllocationPreview({ allocations }: { allocations: AllocationsState }) {
  const activeRoutes = useMemo(() => {
    return DESTINATIONS.filter((d) => (allocations[d.key] || 0) > 0).map((d) => ({
      ...d,
      bps: allocations[d.key],
      eth: (allocations[d.key] / 10000).toFixed(4),
      pct: (allocations[d.key] / 100).toFixed(allocations[d.key] % 100 === 0 ? 0 : 1),
    }));
  }, [allocations]);

  return (
    <div className="dark-allocation-preview-panel">
      <div className="preview-panel-header">
        <div className="header-badge-group">
          <span className="preview-lime-kicker font-mono">ALLOCATION PREVIEW</span>
        </div>
        <span className="preview-basis-label font-mono">FOR EVERY 1 ETH</span>
      </div>

      <div className="preview-table-list">
        {activeRoutes.map((r) => (
          <div key={r.key} className="preview-table-row">
            <div className="table-row-left">
              <span className="route-indicator-dot" style={{ backgroundColor: r.color }} />
              <strong className="route-table-title">{r.label}</strong>
            </div>

            <div className="table-row-right font-mono">
              <span className="route-table-eth">{r.eth} ETH</span>
              <span className="route-table-pct">{r.pct}%</span>
            </div>
          </div>
        ))}

        {activeRoutes.length === 0 && (
          <p className="preview-empty-text font-mono">
            No active routes. Adjust allocations with the slider above.
          </p>
        )}
      </div>

      <div className="preview-panel-footer font-mono">
        <span>FEES → FORGE → {activeRoutes.length} ROUTES</span>
      </div>
    </div>
  );
}

/* ==================================================
   7. ROOT FEE DIRECTOR ORCHESTRATOR
   ================================================== */
export function FeeDirector({
  creatorAddress,
  initialFlow,
  onConfirmFlow,
  onChangeFlow,
  onBack,
  strategies,
  onStrategiesChange,
}: {
  creatorAddress?: Address;
  initialFlow: Flow;
  strategies: Strategies;
  onStrategiesChange: (value: Strategies) => void;
  onConfirmFlow: (flow: Flow) => void;
  onChangeFlow?: (flow: Flow) => void;
  onBack: () => void;
}) {
  const { initialAllocations, initialTreasury } = useMemo(() => {
    const allocs: AllocationsState = {
      buyback: 0,
      buyBurn: 0,
      gradBoost: 0,
      holders: 0,
      creator: 0,
      treasury: 0,
      dca: 0,
    };
    let tr = '';

    initialFlow.forEach((item) => {
      const match = DESTINATIONS.find((d) => d.kind === item.kind);
      if (match) {
        allocs[match.key] = item.bps;
        if (match.key === 'treasury') tr = item.recipient;
      }
    });

    return { initialAllocations: allocs, initialTreasury: tr };
  }, [initialFlow]);

  const [allocations, setAllocations] = useState<AllocationsState>(initialAllocations);
  const [selectedKey, setSelectedKey] = useState<DestinationKey>('buyback');
  const [treasuryWallet, setTreasuryWallet] = useState<string>(initialTreasury);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  // Total BPS
  const totalBps = useMemo(() => {
    return Object.values(allocations).reduce((sum, v) => sum + (v || 0), 0);
  }, [allocations]);

  const remainingBps = Math.max(0, 10000 - totalBps);

  // Check preset match
  const currentPresetMatch = useMemo(() => {
    for (const p of PRESETS) {
      const match = Object.keys(p.allocations).every(
        (k) => p.allocations[k as DestinationKey] === allocations[k as DestinationKey],
      );
      if (match) return p.id;
    }
    return null;
  }, [allocations]);

  // Construct flow helper
  const constructFlow = useCallback(
    (allocs: AllocationsState, tr: string): Flow => {
      const result: Flow = [];
      DESTINATIONS.forEach((d) => {
        const bps = allocs[d.key] || 0;
        if (bps > 0) {
          let recipient = '0x0000000000000000000000000000000000000000';
          if (d.kind === 0) recipient = creatorAddress || '';
          else if (d.kind === 1) recipient = tr;

          result.push({ kind: d.kind, recipient, bps });
        }
      });
      return result;
    },
    [creatorAddress],
  );

  // Live sync with right sidebar
  useEffect(() => {
    if (onChangeFlow) {
      onChangeFlow(constructFlow(allocations, treasuryWallet));
    }
  }, [allocations, treasuryWallet, constructFlow, onChangeFlow]);

  // Handle Preset
  const handleApplyPreset = (presetId: string) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setAllocations({ ...preset.allocations });
    setActivePresetId(preset.id);
    onStrategiesChange(defaultStrategies());
  };

  // Slider or quick chip change for currently selected destination
  const handleBpsChange = (destKey: DestinationKey, newBps: number) => {
    const current = allocations[destKey] || 0;
    const maxAllowed = current + remainingBps;
    const clamped = Math.max(0, Math.min(maxAllowed, newBps));

    setAllocations((prev) => ({
      ...prev,
      [destKey]: clamped,
    }));
    setActivePresetId(null);
  };

  // Drag adjustment between adjacent active segments
  const handleAdjustAdjacent = (
    keyLeft: DestinationKey,
    keyRight: DestinationKey,
    deltaBps: number,
  ) => {
    const bpsLeft = allocations[keyLeft] || 0;
    const bpsRight = allocations[keyRight] || 0;
    const sum = bpsLeft + bpsRight;

    const nextLeft = Math.max(0, Math.min(sum, bpsLeft + deltaBps));
    const nextRight = sum - nextLeft;

    setAllocations((prev) => ({
      ...prev,
      [keyLeft]: nextLeft,
      [keyRight]: nextRight,
    }));
    setActivePresetId(null);
  };

  // Smart Remaining action: assign remaining to currently selected route
  const handleAssignRemaining = () => {
    if (remainingBps <= 0) return;
    handleBpsChange(selectedKey, (allocations[selectedKey] || 0) + remainingBps);
  };

  // Validation
  const validationErrors = useMemo(
    () => [
      ...validateFlow(constructFlow(allocations, treasuryWallet), creatorAddress),
      ...validateStrategies(strategies, constructFlow(allocations, treasuryWallet)),
    ],
    [allocations, treasuryWallet, creatorAddress, strategies, constructFlow],
  );

  const canProceed = totalBps === 10000 && validationErrors.length === 0;

  const handleConfirm = () => {
    if (!canProceed) return;
    onConfirmFlow(constructFlow(allocations, treasuryWallet));
  };

  const selectedConfig = DESTINATIONS.find((d) => d.key === selectedKey) || DESTINATIONS[0];
  const selectedCurrentBps = allocations[selectedKey] || 0;
  const selectedMaxAllowedBps = selectedCurrentBps + remainingBps;

  return (
    <div className="unified-fee-configurator">
      {/* 1. STAGE HEADER */}
      <div className="configurator-header">
        <div>
          <span className="step-tag">STAGE 02 / PROGRAM THE FLOW</span>
          <h2 className="configurator-title">Where should the fees go?</h2>
        </div>
        <span className="step-stage-indicator">2 OF 3</span>
      </div>

      <p className="configurator-subtitle">
        Choose what every creator-fee dollar should do. Select any destination to adjust its
        percentage with the shared slider.
      </p>

      {/* 2. DISTRIBUTION OVERVIEW & MULTI-SEGMENT BAR */}
      <DistributionOverview
        totalBps={totalBps}
        allocations={allocations}
        selectedKey={selectedKey}
        onSelectKey={setSelectedKey}
        onAdjustAdjacent={handleAdjustAdjacent}
        onAssignRemaining={remainingBps > 0 ? handleAssignRemaining : undefined}
      />

      {/* 3. STRATEGY PRESETS */}
      <StrategyPresetsBar
        activePresetId={currentPresetMatch || activePresetId}
        onApplyPreset={handleApplyPreset}
      />

      {/* 4. DESTINATION CARDS (2 COLUMNS DESKTOP/TABLET, 1 COLUMN MOBILE, EQUAL HEIGHTS) */}
      <div className="destination-cards-grid">
        {DESTINATIONS.map((dest) => (
          <DestinationCard
            key={dest.key}
            config={dest}
            bps={allocations[dest.key] || 0}
            isSelected={selectedKey === dest.key}
            onSelect={() => setSelectedKey(dest.key)}
            creatorConnected={!!creatorAddress}
          />
        ))}
      </div>

      {/* 5. SEPARATE CONTEXTUAL RECIPIENT INPUTS (OUTSIDE & BELOW CARDS) */}
      <ContextualRecipientInputs
        allocations={allocations}
        treasuryWallet={treasuryWallet}
        onTreasuryChange={setTreasuryWallet}
      />

      {/* 6. SHARED SLIDER (PRIMARY CONTROL) */}
      <SharedAllocationSlider
        config={selectedConfig}
        currentBps={selectedCurrentBps}
        maxAllowedBps={selectedMaxAllowedBps}
        onChangeBps={(newBps) => handleBpsChange(selectedKey, newBps)}
      />

      {selectedCurrentBps > 0 && (
        <StrategyEditor
          kind={selectedConfig.kind}
          value={strategies}
          onChange={onStrategiesChange}
        />
      )}

      {/* 7. DARK ALLOCATION PREVIEW (CLEAN SEPARATED LIST) */}
      <DarkAllocationPreview allocations={allocations} />

      {/* 8. VALIDATION NOTICES (IF BLOCKED) */}
      {validationErrors.length > 0 && totalBps === 10000 && (
        <div className="configurator-validation-card" role="alert">
          <AlertCircle size={16} className="text-amber-500 shrink-0" />
          <div className="validation-copy">
            <strong>ACTION REQUIRED BEFORE REVIEW:</strong>
            <ul className="validation-list">
              {validationErrors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 9. BOTTOM ACTION BAR (CONNECTED TO ALLOCATION STATUS) */}
      <div className="configurator-action-bar">
        <button type="button" className="button button-secondary" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>TOKEN DETAILS</span>
        </button>

        <div className="bottom-allocation-status font-mono">
          {totalBps === 10000 ? (
            <span className="status-confirmed">
              <Check size={14} className="inline text-lime-600" /> 100% allocated · Ready
            </span>
          ) : totalBps < 10000 ? (
            <span className="status-pending">
              {(totalBps / 100).toFixed(0)}% allocated · {((10000 - totalBps) / 100).toFixed(0)}%
              remaining
            </span>
          ) : (
            <span className="status-warning">
              Over allocated · {((totalBps - 10000) / 100).toFixed(1)}%
            </span>
          )}
        </div>

        <button
          type="button"
          className="button button-lime button-stage-next"
          disabled={!canProceed}
          onClick={handleConfirm}
          aria-label="Review flow"
        >
          <span>REVIEW FLOW</span>
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
