import { it, expect } from 'vitest';
import { phaseLabel } from '../src/lib/pons/reads';
import { developerBuyValue } from '../src/lib/pons/writes';
import { ponsAbi } from '../src/lib/pons/abi';
it('uses PONS authoritative phases', () => {
  expect([0, 1, 2, 3, 9].map(phaseLabel)).toEqual([
    'BONDING',
    'GRADUATED',
    'MIGRATED',
    'RESCUED',
    'NOT AVAILABLE',
  ]);
});
it('parses developer buy without floating point rounding and rejects negatives', () => {
  expect(developerBuyValue('0.000000000000000001')).toBe(1n);
  expect(() => developerBuyValue('-1')).toThrow();
  expect(() => developerBuyValue('1e10')).toThrow();
});
it('pins the verified receiver parameter and launch event', () => {
  const launch = ponsAbi.find((a) => a.type === 'function' && a.name === 'launchToken');
  expect(launch?.inputs[0].components.find((c) => c.name === 'creatorFeeRecipient')?.type).toBe(
    'address',
  );
  expect(ponsAbi.some((a) => a.type === 'event' && a.name === 'TokenLaunched')).toBe(true);
});
