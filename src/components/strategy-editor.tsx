'use client';
import { useState } from 'react';
import type { Limits, Strategies } from '@/lib/strategies';
function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | number;
  onChange: (s: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="strategy-field">
      <span>{label}</span>
      <input
        inputMode="decimal"
        value={draft ?? value}
        onFocus={() => setDraft(String(value))}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(e.target.value);
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  );
}
export function StrategyEditor({
  kind,
  value: c,
  onChange,
}: {
  kind: number;
  value: Strategies;
  onChange: (c: Strategies) => void;
}) {
  if (![7, 8].includes(kind)) return null;
  const key = kind === 7 ? 'grad' : 'dca';
  const l = c[key];
  const limit = (name: keyof Limits, value: string | number) =>
    onChange({ ...c, [key]: { ...l, [name]: value } });
  return (
    <section className="strategy-editor" aria-label="Strategy settings">
      {kind === 7 && (
        <>
          <h3>GRAD BOOST</h3>
          <Field
            label="Trigger at bonding progress (%)"
            value={c.triggerProgressBps / 100}
            onChange={(v) => onChange({ ...c, triggerProgressBps: Number(v) * 100 })}
          />
          <p>
            Funds accumulate during bonding. At &ge; {c.triggerProgressBps / 100}%, up to{' '}
            {l.maxExecutionNative} ETH per execution may buy from the real PONS bonding market.
          </p>
        </>
      )}
      {kind === 8 && (
        <>
          <h3>DCA STRATEGY | PREVIOUS CHECK</h3>
          <p>
            Compare with the previous check every {l.cooldownSeconds / 60} minutes. Buy only when a
            configured dip is confirmed by spaced PONS price observations. A running keeper is
            required.
          </p>
          {c.levels.map((level, i) => (
            <div className="strategy-row" key={i}>
              <strong>LEVEL {i + 1}</strong>
              <Field
                label="Price drop (%)"
                value={level.dropBps / 100}
                onChange={(v) =>
                  onChange({
                    ...c,
                    levels: c.levels.map((x, j) =>
                      i === j ? { ...x, dropBps: Number(v) * 100 } : x,
                    ),
                  })
                }
              />
              <button
                type="button"
                onClick={() => onChange({ ...c, levels: c.levels.filter((_, j) => i !== j) })}
                disabled={c.levels.length === 1}
              >
                Remove level {i + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={c.levels.length >= 5}
            onClick={() =>
              onChange({
                ...c,
                levels: [
                  ...c.levels,
                  { dropBps: Math.min(9900, (c.levels.at(-1)?.dropBps || 0) + 1000), spendBps: 0 },
                ],
              })
            }
          >
            + ADD LEVEL
          </button>
          <p>
            Only the deepest matching level buys once per interval, using the complete accumulated
            DCA reserve. Flat or rising prices do not buy. The creator can permanently cancel DCA
            and claim the reserve; future DCA fees then go to the creator.
          </p>
        </>
      )}
      <details>
        <summary>ADVANCED SETTINGS</summary>
        <div className="strategy-limits">
          {kind === 7 && (
            <Field
              label="Max per execution (ETH)"
              value={l.maxExecutionNative}
              onChange={(v) => limit('maxExecutionNative', v)}
            />
          )}
          {kind === 7 && (
            <Field
              label="Min execution (ETH)"
              value={l.minExecutionNative}
              onChange={(v) => limit('minExecutionNative', v)}
            />
          )}
          <Field
            label="Slippage (%)"
            value={l.slippageBps / 100}
            onChange={(v) => limit('slippageBps', Number(v) * 100)}
          />
          {kind === 8 ? (
            <p>Fixed execution interval: 5 minutes</p>
          ) : (
            <Field
              label="Cooldown (minutes)"
              value={l.cooldownSeconds / 60}
              onChange={(v) => limit('cooldownSeconds', Number(v) * 60)}
            />
          )}
        </div>
      </details>
    </section>
  );
}
export function StrategyReview({
  value: c,
  flow,
}: {
  value: Strategies;
  flow: { kind: number }[];
}) {
  const rules = flow.filter((d) => d.kind >= 7);
  if (rules.length === 0) return null;
  return (
    <details className="strategy-editor">
      <summary>STRATEGY RULES</summary>
      {rules.map((d) => {
          const l = c[d.kind === 7 ? 'grad' : 'dca'];
          return (
            <div key={d.kind}>
              <h4>{d.kind === 7 ? 'GRAD BOOST' : 'DCA BUYBACK'}</h4>
              <p>
                {d.kind === 8
                  ? 'Complete accumulated reserve'
                  : `${l.minExecutionNative}-${l.maxExecutionNative} ETH per execution`}{' '}
                | {l.slippageBps / 100}% slippage | {l.cooldownSeconds / 60} min interval
              </p>
              {d.kind === 7 && <p>Triggers at &ge; {c.triggerProgressBps / 100}% bonding.</p>}
              {d.kind === 8 && (
                <>
                  <p>
                    Previous-check reference | repeat after each interval when price drops. Requires
                    an active keeper and confirmed market prices, including after migration. Creator
                    cancellation returns reserve and future DCA fees to creator claims.
                  </p>
                  {c.levels.map((l, i) => (
                    <p key={i}>
                      -{l.dropBps / 100}% | deploy the complete accumulated DCA reserve.
                    </p>
                  ))}
                </>
              )}
            </div>
          );
        })}
    </details>
  );
}
