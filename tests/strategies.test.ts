import { describe, it, expect } from 'vitest';
import { defaultStrategies, validateStrategies, strategyArgs } from '../src/lib/strategies';
import { validateFlow, destinationLabel, destinationOptions } from '../src/lib/flow';
import { PRESETS } from '../src/components/fee-director';
const wallet = '0x1111111111111111111111111111111111111111';
describe('V2 strategies', () => {
  it('valid defaults encode native values exactly', () => {
    const c = defaultStrategies();
    expect(validateStrategies(c, [])).toEqual([]);
    expect(strategyArgs(c).grad.maxExecutionNative).toBe(250000000000000000n);
  });
  it('removed routes cannot be created', () => {
    for (const kind of [2, 5, 9]) {
      if (kind === 2 || kind === 5) expect(destinationLabel(kind)).toContain('LEGACY');
      expect(validateFlow([{ kind, recipient: wallet, bps: 10000 }]).length).toBeGreaterThan(0);
      expect(destinationOptions.some((d) => +d.value === kind)).toBe(false);
    }
  });
  it('rejects fractional BPS, invalid decimal limits, cooldowns and unsorted levels', () => {
    for (const mutate of [
      (c: ReturnType<typeof defaultStrategies>) => {
        c.levels[0].dropBps = 0.5;
      },
      (c: ReturnType<typeof defaultStrategies>) => {
        c.grad.minExecutionNative = '1e-2';
      },
      (c: ReturnType<typeof defaultStrategies>) => {
        c.dca.cooldownSeconds = 59;
      },
      (c: ReturnType<typeof defaultStrategies>) => {
        c.levels.reverse();
      },
    ]) {
      const c = defaultStrategies();
      mutate(c);
      expect(validateStrategies(c, []).length).toBeGreaterThan(0);
    }
  });
  it('presets total exactly 100%', () => {
    for (const p of PRESETS) {
      expect(Object.values(p.allocations).reduce((s, v) => s + v, 0)).toBe(10000);
      expect(validateStrategies(defaultStrategies(), [])).toEqual([]);
    }
  });
});
