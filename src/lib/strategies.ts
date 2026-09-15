import { parseEther } from 'viem';
import type { Flow } from './flow';
export type Limits = {
  minExecutionNative: string;
  maxExecutionNative: string;
  slippageBps: number;
  cooldownSeconds: number;
};
export type Strategies = {
  triggerProgressBps: number;
  grad: Limits;
  dca: Limits;
  levels: { dropBps: number; spendBps: number }[];
};
export function defaultStrategies(): Strategies {
  const limits = {
    minExecutionNative: '0.02',
    maxExecutionNative: '0.25',
    slippageBps: 200,
    cooldownSeconds: 1800,
  };
  return {
    triggerProgressBps: 8000,
    grad: { ...limits },
    dca: { ...limits, cooldownSeconds: 300 },
    levels: [
      { dropBps: 1000, spendBps: 2000 },
      { dropBps: 2000, spendBps: 3000 },
      { dropBps: 3000, spendBps: 5000 },
    ],
  };
}
export function validateStrategies(c: Strategies, flow: Flow): string[] {
  void flow;
  const errors: string[] = [];
  const integer = (v: number, min: number, max: number) =>
    Number.isInteger(v) && v >= min && v <= max;
  if (!integer(c.triggerProgressBps, 0, 10000))
    errors.push('Grad trigger must be between 0 and 100%.');
  for (const [name, l] of [
    ['Grad Boost', c.grad],
    ['DCA', c.dca],
  ] as const) {
    try {
      if (
        !/^\d+(\.\d{1,18})?$/.test(l.minExecutionNative) ||
        !/^\d+(\.\d{1,18})?$/.test(l.maxExecutionNative) ||
        parseEther(l.minExecutionNative) <= 0n ||
        parseEther(l.maxExecutionNative) < parseEther(l.minExecutionNative) ||
        parseEther(l.maxExecutionNative) >= 2n ** 256n
      )
        throw Error();
    } catch {
      errors.push(`${name}: enter positive native limits with minimum no greater than maximum.`);
    }
    if (
      !integer(l.slippageBps, 1, 1000) ||
      !integer(
        l.cooldownSeconds,
        name === 'DCA' ? 300 : 60,
        name === 'DCA' ? 300 : 4294967295,
      )
    )
      errors.push(
        `${name}: slippage must be 0.01-10%; ${name === 'DCA' ? 'interval must be exactly 300' : 'cooldown must be at least 60'} seconds.`,
      );
  }
  if (
    c.levels.length < 1 ||
    c.levels.length > 5 ||
    c.levels.some(
      (l, i) => !integer(l.dropBps, 1, 9999) || (i > 0 && l.dropBps <= c.levels[i - 1].dropBps),
    )
  )
    errors.push('Use 1-5 increasing dip levels.');
  return errors;
}
export function strategyArgs(c: Strategies) {
  const limits = (l: Limits) => ({
    ...l,
    minExecutionNative: parseEther(l.minExecutionNative),
    maxExecutionNative: parseEther(l.maxExecutionNative),
  });
  return {
    ...c,
    grad: limits(c.grad),
    dca: limits(c.dca),
  };
}
