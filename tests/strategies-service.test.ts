import { beforeEach, describe, it, expect, vi } from 'vitest';
const { load, readContract, simulateContract, getBlock } = vi.hoisted(() => ({
  load: vi.fn(),
  readContract: vi.fn(),
  simulateContract: vi.fn(),
  getBlock: vi.fn(),
}));
vi.mock('../src/lib/indexer/store', () => ({ fileStore: { load } }));
vi.mock('../src/lib/client', () => ({
  publicClient: { readContract, simulateContract, getBlock },
}));
import { getStrategies } from '../src/lib/forge/strategies-service';
import { GET } from '../src/app/api/token/[address]/strategies/route';
const token = '0x1111111111111111111111111111111111111111',
  router = '0x2222222222222222222222222222222222222222',
  factory = '0x3333333333333333333333333333333333333333';
const snapshot = () => ({
  cursor: '100',
  updatedAt: new Date().toISOString(),
  factoryV2: factory,
  tokens: [{ token, router }],
  events: [{ event: 'RouterCreated', router, address: factory }],
});
beforeEach(() => {
  vi.resetAllMocks();
  getBlock.mockResolvedValue({ timestamp: 1000n });
  simulateContract.mockResolvedValue({ result: 1000n });
});
describe('normalized strategy API', () => {
  it('returns empty without fabricating data', async () => {
    load.mockResolvedValue(null);
    expect(await getStrategies(token)).toEqual({ state: 'empty' });
    expect(readContract).not.toHaveBeenCalled();
  });
  it('rejects invalid addresses before RPC', async () => {
    const r = await GET(new Request('http://local'), {
      params: Promise.resolve({ address: 'invalid' }),
    });
    expect(r.status).toBe(400);
    expect(readContract).not.toHaveBeenCalled();
  });
  it('preserves historical allocation labels', async () => {
    load.mockResolvedValue({ ...snapshot(), factoryV2: undefined });
    readContract.mockResolvedValue([
      { kind: 2, bps: 4000, recipient: token },
      { kind: 5, bps: 6000, recipient: router },
    ]);
    const r = await getStrategies(token);
    expect(r.version).toBe(1);
    expect(r.legacy?.every((x) => x.label.includes('LEGACY'))).toBe(true);
    expect(readContract).toHaveBeenCalledTimes(1);
  });
  it('serializes exact reserves and fails closed for DCA', async () => {
    load.mockResolvedValue(snapshot());
    readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case 'getDestinations':
          return [
            { kind: 7, bps: 5000, recipient: router },
            { kind: 8, bps: 5000, recipient: router },
          ];
        case 'getLevels':
          return [{ dropBps: 1000, spendBps: 10000 }];
        case 'gradLimits':
        case 'dcaLimits':
          return [1n, 100n, 200, 60];
        case 'paused':
        case 'levelExecuted':
          return false;
        case 'triggerProgressBps':
          return 7500;
        case 'bondingProgressBps':
          return 8000n;
        case 'bounds':
        case 'previewDca':
          throw Error('Price warming up');
        case 'priceResolver':
          return '0x0000000000000000000000000000000000000000';
        default:
          return 0n;
      }
    });
    const r = await GET(new Request('http://local'), {
      params: Promise.resolve({ address: token }),
    });
    const d = await r.json();
    expect(d.dca.currentPrice).toBeNull();
    expect(d.dca.eligible).toBe(false);
    expect(d.dca.reserve).toBe('0');
    expect(d.gradBoost.eligible).toBe(false);
    expect(readContract.mock.calls.every(([r]) => r.blockNumber === 100n)).toBe(true);
  });
  it('reports a confirmed previous-check dip and current-reserve buy eligibility', async () => {
    load.mockResolvedValue(snapshot());
    readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      const values: Record<string, unknown> = {
        getDestinations: [{ kind: 8, bps: 10000, recipient: router }],
        getLevels: [{ dropBps: 1000, spendBps: 10000 }],
        gradLimits: [1n, 100n, 200, 60],
        dcaLimits: [1n, 100n, 200, 300],
        paused: false,
        dcaCancelled: false,
        levelExecuted: false,
        creator: token,
        priceResolver: factory,
        marketAdapter: factory,
        anchorPrice: 10000n,
        bounds: [8000n, 8100n, 990n, 120n, true],
        previewDca: [true, 0n, 25n, 8000n, 8100n],
        quoteBuy: 1000n,
        dcaBuybackBalance: 25n,
        lastDcaCheck: 700n,
        dcaEpoch: 3n,
      };
      return values[functionName] ?? 0n;
    });
    const d = await getStrategies(token);
    expect(d.dca?.referenceMode).toBe('PREVIOUS_CHECK');
    expect(d.dca?.dipBps).toBe(1900);
    expect(d.dca?.currentPrice).toBe(8100n);
    expect(d.dca?.eligible).toBe(true);
    expect(d.dca?.nextBuyAmount).toBe(25n);
    expect(d.dca?.nextExecution).toBe(1000n);
    expect(d.dca?.levels[0].triggered).toBe(true);
  });
  it('returns explicit errors when RPC fails', async () => {
    load.mockResolvedValue(snapshot());
    readContract.mockRejectedValue(Error('rpc'));
    const r = await GET(new Request('http://local'), {
      params: Promise.resolve({ address: token }),
    });
    expect(r.status).toBe(503);
    expect((await r.json()).state).toBe('error');
  });
});
