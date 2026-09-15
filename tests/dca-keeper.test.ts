import { describe, it, expect, vi } from 'vitest';
import { type PublicClient } from 'viem';
import {
  prepareAutomatedFeeBatch,
  prepareDcaCheck,
  prepareGradBoost,
} from '../src/lib/forge/dca-keeper';
const router = '0x1111111111111111111111111111111111111111';
const keeper = '0x2222222222222222222222222222222222222222';
const token = '0x3333333333333333333333333333333333333333';
const adapter = '0x4444444444444444444444444444444444444444';
function fixture(due: boolean, amount: bigint, quote = 1000n) {
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    const values: Record<string, unknown> = {
      previewDca: [due, 0n, amount, 9000n, 9100n],
      token,
      marketAdapter: adapter,
      dcaLimits: [1n, 100n, 200, 300],
      baseLimits: [1n, 100n, 200, 300],
      buybackReserve: amount,
      burnReserve: amount,
      lastBuybackExecution: 0n,
      lastBurnExecution: 0n,
      creationTimestamp: 700n,
      gradLimits: [10n, 40n, 200, 300],
      gradBoostBalance: amount,
    };
    return values[functionName];
  });
  const simulateContract = vi.fn(async (request) =>
    request.functionName === 'quoteBuyForRecipient' ? { request, result: quote } : { request },
  );
  const client = {
    getBlock: vi.fn(async () => ({ number: 12n, timestamp: 1000n })),
    readContract,
    simulateContract,
  };
  return { ...client, client: client as unknown as PublicClient };
}
describe('DCA keeper transaction preparation', () => {
  it('does nothing before the contract interval is due', async () => {
    const f = fixture(false, 0n);
    expect(await prepareDcaCheck(f.client, router, keeper)).toBeNull();
    expect(f.simulateContract).not.toHaveBeenCalled();
  });
  it('updates the baseline without a swap on flat/rising or first checks', async () => {
    const f = fixture(true, 0n);
    const p = await prepareDcaCheck(f.client, router, keeper);
    expect(p?.minOut).toBe(0n);
    expect(p?.deadline).toBe(1180n);
    expect(f.readContract).toHaveBeenCalledTimes(1);
    expect(f.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'checkDca', args: [0n, 1180n], account: keeper }),
    );
  });
  it('uses the contract amount and actual router recipient tax, then simulates', async () => {
    const f = fixture(true, 50n);
    const p = await prepareDcaCheck(f.client, router, keeper);
    expect(p?.minOut).toBe(980n);
    expect(p?.amount).toBe(50n);
    expect(f.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: adapter,
        functionName: 'quoteBuyForRecipient',
        args: [token, 50n, router],
        account: keeper,
        blockNumber: 12n,
      }),
    );
  });
  it('never prepares a buy with zero protected output', async () => {
    const f = fixture(true, 50n, 0n);
    await expect(prepareDcaCheck(f.client, router, keeper)).rejects.toThrow('quote unavailable');
    expect(f.simulateContract).toHaveBeenCalledTimes(1);
    expect(
      f.simulateContract.mock.calls.some(([request]) => request.functionName === 'checkDca'),
    ).toBe(false);
  });
  it('propagates a stale/racing/reverted simulation without submitting', async () => {
    const f = fixture(true, 50n);
    f.simulateContract.mockRejectedValue(Error('ExecutionGuard'));
    await expect(prepareDcaCheck(f.client, router, keeper)).rejects.toThrow('ExecutionGuard');
  });
});

describe('managed strategy preparation', () => {
  it('caps Grad Boost at its configured maximum and protects the quote', async () => {
    const f = fixture(true, 50n);
    const p = await prepareGradBoost(f.client, router, keeper);
    expect(p).toMatchObject({ amount: 40n, minOut: 980n, deadline: 1180n });
    expect(f.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: router,
        functionName: 'executeGradBoost',
        args: [40n, 980n, 1180n],
        account: keeper,
      }),
    );
  });
});

describe('five-minute fee batch preparation', () => {
  it('uses the complete accumulated buyback reserve', async () => {
    const f = fixture(true, 50n);
    const p = await prepareAutomatedFeeBatch(f.client, router, keeper, 'executeBuyback');
    expect(p).toMatchObject({ amount: 50n, minOut: 980n });
    expect(f.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: router,
        functionName: 'executeBuyback',
        args: [50n, 980n],
      }),
    );
  });

  it('does nothing with an empty reserve or before five minutes', async () => {
    const empty = fixture(true, 0n);
    expect(await prepareAutomatedFeeBatch(empty.client, router, keeper, 'executeBurn')).toBeNull();
    const early = fixture(true, 50n);
    early.getBlock.mockResolvedValue({ number: 12n, timestamp: 999n } as never);
    expect(await prepareAutomatedFeeBatch(early.client, router, keeper, 'executeBurn')).toBeNull();
    expect(early.simulateContract).not.toHaveBeenCalled();
  });
});
