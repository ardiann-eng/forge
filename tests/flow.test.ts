import { describe, it, expect } from 'vitest';
import { validateFlow } from '../src/lib/flow';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const creator = privateKeyToAccount(generatePrivateKey()).address;
const treasury = privateKeyToAccount(generatePrivateKey()).address;

describe('allocation constraints', () => {
  it('accepts exact integer basis points with direct destinations', () =>
    expect(
      validateFlow(
        [
          { kind: 0, recipient: creator, bps: 4000 },
          { kind: 1, recipient: treasury, bps: 6000 },
        ],
        creator,
      ),
    ).toEqual([]));

  it('accepts valid protocol action destinations (Buyback, Burn, Liquidity, Holders)', () =>
    expect(
      validateFlow(
        [
          { kind: 0, recipient: creator, bps: 2500 },
          { kind: 3, recipient: '0x0000000000000000000000000000000000000000', bps: 2500 },
          { kind: 4, recipient: '0x0000000000000000000000000000000000000000', bps: 2500 },
          { kind: 5, recipient: '0x0000000000000000000000000000000000000000', bps: 2500 },
        ],
        creator,
      ),
    ).toEqual([]));

  it('rejects totals below and above 100 percent', () => {
    for (const bps of [9999, 10001])
      expect(validateFlow([{ kind: 0, recipient: creator, bps }], creator).length).toBeGreaterThan(
        0,
      );
  });

  it('rejects duplicate addresses ignoring case on direct destinations', () =>
    expect(
      validateFlow(
        [
          { kind: 0, recipient: creator, bps: 5000 },
          { kind: 2, recipient: creator.toLowerCase(), bps: 5000 },
        ],
        creator,
      ),
    ).toContain('Each direct destination must have a different wallet.'));

  it('rejects duplicate automated fee destination kinds', () =>
    expect(
      validateFlow(
        [
          { kind: 0, recipient: creator, bps: 5000 },
          { kind: 3, recipient: '0x0000000000000000000000000000000000000000', bps: 2500 },
          { kind: 3, recipient: '0x0000000000000000000000000000000000000000', bps: 2500 },
        ],
        creator,
      ),
    ).toContain('Each automated fee destination (Buyback, Burn, Liquidity, Holders) can only be added once.'));

  it('rejects unavailable destinations and zero wallets on direct destinations', () =>
    expect(
      validateFlow(
        [
          { kind: 99, recipient: '0x0000000000000000000000000000000000000000', bps: 5000 },
          { kind: 1, recipient: '0x0000000000000000000000000000000000000000', bps: 5000 },
        ],
        creator,
      ).length,
    ).toBeGreaterThan(1));

  it('does not label another wallet as the creator', () =>
    expect(validateFlow([{ kind: 0, recipient: treasury, bps: 10000 }], creator)).toContain(
      'The creator destination must be your connected wallet.',
    ));
});
