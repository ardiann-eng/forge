import { describe, it, expect } from 'vitest';
import { normalizeForgeActivity, formatRelativeTime } from '../src/lib/market/activity';
import type { Activity, IndexedToken } from '../src/lib/indexer/types';

describe('normalizeForgeActivity', () => {
  const sampleTokens: IndexedToken[] = [
    {
      token: '0x4b394Aa9dF919902EDE5860cc01702d936916b32',
      router: '0x6dD379990c17E6C50c6773BC8Bbb108AF4A454d8',
      creator: '0x562F8803d087C4A327bbB1540C00Eac3E6E3402d',
      name: 'FORGE Test 0914131059',
      symbol: 'FT131059',
    },
  ];

  it('normalizes TokenLaunched with deterministic launch sequence', () => {
    const event1: Activity = {
      id: 'tx1:0',
      event: 'TokenLaunched',
      address: '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e',
      token: '0x4b394Aa9dF919902EDE5860cc01702d936916b32',
      creator: '0x562F8803d087C4A327bbB1540C00Eac3E6E3402d',
      block: '100',
      blockHash: '0xabc',
      timestamp: '1789390000',
      hash: '0x123',
      logIndex: 0,
    };

    const norm = normalizeForgeActivity(event1, {
      tokens: sampleTokens,
      allEvents: [event1],
    });

    expect(norm.type).toBe('LAUNCH');
    expect(norm.title).toBe('TOKEN LAUNCH #1');
    expect(norm.tokenSymbol).toBe('FT131059');
    expect(norm.accent).toBe('lime');
  });

  it('normalizes RouterCreated to FLOW ACTIVATED', () => {
    const event: Activity = {
      id: 'tx2:0',
      event: 'RouterCreated',
      address: '0x556be53ccf6a6427730315af23eaca4344e0b8ca',
      router: '0x6dD379990c17E6C50c6773BC8Bbb108AF4A454d8',
      creator: '0x562F8803d087C4A327bbB1540C00Eac3E6E3402d',
      block: '101',
      blockHash: '0xdef',
      timestamp: '1789390100',
      hash: '0x456',
      logIndex: 1,
    };

    const norm = normalizeForgeActivity(event, {
      tokens: sampleTokens,
    });

    expect(norm.type).toBe('FLOW_CREATED');
    expect(norm.title).toBe('$FT131059 FLOW ACTIVATED');
    expect(norm.description).toContain('Creator-fee routing rules deployed');
  });

  it('normalizes BuyAndBurnExecuted to BUY + BURN with amount', () => {
    const event: Activity = {
      id: 'tx3:0',
      event: 'BuyAndBurnExecuted',
      address: '0x6dD379990c17E6C50c6773BC8Bbb108AF4A454d8',
      amount: '420000000000000000', // 0.42 ETH
      block: '102',
      blockHash: '0xghi',
      timestamp: '1789390200',
      hash: '0x789',
      logIndex: 2,
    };

    const norm = normalizeForgeActivity(event);
    expect(norm.type).toBe('BUY_BURN');
    expect(norm.title).toBe('BUY + BURN');
    expect(norm.accent).toBe('orange');
    expect(norm.description).toContain('0.4200 ETH');
  });

  it('normalizes Claimed identifying connected wallet claimant', () => {
    const myWallet = '0x562F8803d087C4A327bbB1540C00Eac3E6E3402d' as const;
    const event: Activity = {
      id: 'tx4:0',
      event: 'Claimed',
      address: '0x6dD379990c17E6C50c6773BC8Bbb108AF4A454d8',
      creator: myWallet,
      amount: '180000000000000000', // 0.18 ETH
      block: '103',
      blockHash: '0xjkl',
      timestamp: '1789390300',
      hash: '0xaaa',
      logIndex: 3,
    };

    const norm = normalizeForgeActivity(event, {
      connectedWallet: myWallet,
    });

    expect(norm.type).toBe('CLAIM');
    expect(norm.title).toBe('YOU CLAIMED FEES');
    expect(norm.description).toBe('You claimed 0.1800 ETH');
  });
});

describe('formatRelativeTime', () => {
  it('formats recent timestamps accurately', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatRelativeTime(now - 3)).toBe('just now');
    expect(formatRelativeTime(now - 45)).toBe('45s ago');
    expect(formatRelativeTime(now - 300)).toBe('5m ago');
    expect(formatRelativeTime(now - 7200)).toBe('2h ago');
    expect(formatRelativeTime(now - 90000)).toBe('Yesterday');
  });
});
