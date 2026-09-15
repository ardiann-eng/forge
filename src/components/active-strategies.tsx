'use client';
import { useQuery } from '@tanstack/react-query';
import { formatEther, parseEther } from 'viem';
import { useState } from 'react';
import { useConnection, useWalletClient } from 'wagmi';
import { strategyTransaction } from '@/lib/forge/strategy-transactions';
import type { Address } from 'viem';
import { forgeAutomationExecutor } from '@/lib/config';
import {
  flowNeedsAutomation,
  fundAutomation,
  getAutomationState,
  updateAutomation,
} from '@/lib/forge/automation';
type Limits = {
  minExecutionNative: string;
  maxExecutionNative: string;
  slippageBps: number;
  cooldownSeconds: number;
};
type Data = {
  state: string;
  version?: number;
  router?: Address;
  creator?: Address;
  paused?: boolean;
  flow?: { kind: number; bps: number }[];
  gradBoost?: { reserve: string; triggerProgressBps: number; eligible: boolean; limits: Limits };
  dca?: {
    reserve: string;
    status: string;
    anchorPrice: string;
    currentPrice: string | null;
    dipBps: number | null;
    checkDue: boolean;
    cancelled: boolean;
    levels: { dropBps: number; spendBps: number; executed: boolean }[];
    limits: Limits;
  };
};
export function ActiveStrategies({ token }: { token: Address }) {
  const { address } = useConnection();
  const { data: wallet } = useWalletClient();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [gasAmount, setGasAmount] = useState('0.01');
  const q = useQuery<Data>({
    queryKey: ['strategies', token],
    queryFn: async () => {
      const r = await fetch(`/api/token/${token}/strategies`);
      if (!r.ok) throw Error('Strategy state unavailable');
      return r.json();
    },
    refetchInterval: 30000,
  });
  const d = q.data;
  const automation = useQuery({
    queryKey: ['automation', d?.router],
    enabled: !!forgeAutomationExecutor && !!d?.router,
    queryFn: () => getAutomationState(d!.router!),
    refetchInterval: 30000,
  });
  if (q.isPending)
    return (
      <div
        className="skeleton"
        role="status"
        aria-label="Loading strategies"
        style={{ height: 48 }}
      />
    );
  if (q.isError)
    return (
      <p role="status">
        Strategy state unavailable. <button onClick={() => q.refetch()}>Retry</button>
      </p>
    );
  if (!d || d.version !== 2) return null;
  const active = (kind: number) => d.flow?.some((f) => f.kind === kind && f.bps > 0);
  const rules = (l: Limits) => (
    <p>
      {formatEther(BigInt(l.minExecutionNative))}-{formatEther(BigInt(l.maxExecutionNative))} ETH |{' '}
      {l.slippageBps / 100}% slippage | {l.cooldownSeconds / 60} min cooldown
    </p>
  );
  async function execute(
    action:
      | 'executeGradBoost'
      | 'checkDca'
      | 'cancelDca'
      | 'claim',
  ) {
    if (!wallet || !address || !d?.router) return;
    setBusy(true);
    setMessage('Awaiting wallet confirmation');
    try {
      await strategyTransaction(wallet, address, d.router, action, (h) =>
        setMessage(`Confirming ${h}`),
      );
      setMessage('Transaction confirmed');
      await q.refetch();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function automationAction(action: 'fund' | 'pause' | 'resume' | 'withdraw') {
    if (!wallet || !address || !d?.router) return;
    setBusy(true);
    setMessage('Awaiting wallet confirmation');
    try {
      if (action === 'fund') {
        const amount = parseEther(gasAmount);
        await fundAutomation(wallet, address, d.router, amount, (hash) =>
          setMessage(`Confirming ${hash}`),
        );
      } else {
        await updateAutomation(wallet, address, d.router, action, (hash) =>
          setMessage(`Confirming ${hash}`),
        );
      }
      setMessage('Automation transaction confirmed');
      await automation.refetch();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const automatedFlow = flowNeedsAutomation((d.flow || []).map((f) => ({ ...f, recipient: '' })));
  const isCreator = address?.toLowerCase() === d.creator?.toLowerCase();
  return (
    <details className="strategy-editor">
      <summary>ACTIVE STRATEGIES {d.paused ? ' - PAUSED' : ''}</summary>
      {d.state === 'stale' && (
        <p role="status">Indexer data is stale. Execution eligibility must be refreshed.</p>
      )}
      {automatedFlow && (
        <section className="active-automation-panel">
          <div>
            <span>AUTOMATION GAS</span>
            <strong>{formatEther(automation.data?.balance ?? 0n)} ETH</strong>
            <p>
              Shared keeper reimbursement for this router ·{' '}
              {automation.data?.paused ? 'paused' : 'active'}
            </p>
          </div>
          <div className="active-automation-controls">
            <label>
              Top up amount
              <input
                type="number"
                min="0.000001"
                max="1"
                step="0.001"
                value={gasAmount}
                onChange={(event) => setGasAmount(event.target.value)}
              />
            </label>
            <button disabled={busy || !wallet} onClick={() => automationAction('fund')}>
              Top up gas
            </button>
            {isCreator && (
              <>
                <button
                  disabled={busy || !wallet}
                  onClick={() =>
                    automationAction(automation.data?.paused ? 'resume' : 'pause')
                  }
                >
                  {automation.data?.paused ? 'Resume automation' : 'Pause automation'}
                </button>
                <button
                  disabled={busy || !wallet || (automation.data?.balance ?? 0n) === 0n}
                  onClick={() => automationAction('withdraw')}
                >
                  Withdraw unused gas
                </button>
              </>
            )}
          </div>
        </section>
      )}
      {active(7) && d.gradBoost && (
        <div>
          <h3>GRAD BOOST | {d.gradBoost.eligible ? 'ELIGIBLE' : 'WAITING'}</h3>
          <p>
            {formatEther(BigInt(d.gradBoost.reserve))} ETH reserve | triggers at{' '}
            {d.gradBoost.triggerProgressBps / 100}% bonding
          </p>
          {rules(d.gradBoost.limits)}
          <button
            disabled={busy || !wallet || d.state === 'stale' || !d.gradBoost.eligible}
            onClick={() => execute('executeGradBoost')}
          >
            Review Grad Boost in wallet
          </button>
        </div>
      )}
      {active(8) && d.dca && (
        <div>
          <h3>DCA BUYBACK</h3>
          <p>{d.dca.status}</p>
          <p>
            {formatEther(BigInt(d.dca.reserve))} ETH held | previous reference{' '}
            {d.dca.anchorPrice === '0' ? 'not captured' : d.dca.anchorPrice}
          </p>
          {d.dca.levels.map((l, i) => (
            <p key={i}>
              -{l.dropBps / 100}% | deploy {l.spendBps / 100}% |{' '}
              {l.executed ? 'Bought on latest check' : 'No buy on latest check'}
            </p>
          ))}
          <p>
            Current confirmed upper price: {d.dca.currentPrice ?? 'warming up'} | Dip:{' '}
            {d.dca.dipBps === null ? 'unavailable' : `${d.dca.dipBps / 100}%`}
          </p>
          <p>
            Every check updates the reference. Only a further drop can trigger another buy.
            Automatic checks require a running keeper.
          </p>
          {rules(d.dca.limits)}
          <button
            disabled={busy || !wallet || d.state === 'stale' || !d.dca.checkDue}
            onClick={() => execute('checkDca')}
          >
            Review DCA check in wallet
          </button>
          {address?.toLowerCase() === d.creator?.toLowerCase() && (
            <>
              <p>
                Permanent cancellation moves the remaining reserve and future DCA fees to creator
                claims.
              </p>
              <button
                disabled={busy || !wallet || d.dca.cancelled}
                onClick={() => execute('cancelDca')}
              >
                Permanently cancel DCA
              </button>
              {d.dca.cancelled && (
                <button disabled={busy || !wallet} onClick={() => execute('claim')}>
                  Claim creator fees and returned DCA reserve
                </button>
              )}
            </>
          )}
        </div>
      )}
      <p role="status">{message}</p>
    </details>
  );
}
