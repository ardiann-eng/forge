'use client';
import { useSystemStatus } from '@/components/data';
import { ForgeAddress, ForgeStatus } from '@/components/ui';
export default function Status() {
  const { data, isLoading, error } = useSystemStatus();
  return (
    <section className="content-page">
      <div className="page-heading">
        <p className="muted">SYSTEM STATUS</p>
        <h1>
          Ready when
          <br />
          the rails are.
        </h1>
        <p>Configuration and verified integration capabilities.</p>
      </div>
      {isLoading ? (
        <p>Checking configuration…</p>
      ) : error ? (
        <p role="alert">Status is unavailable. Please reload.</p>
      ) : (
        data && (
          <>
            <ForgeStatus tone={data.ready ? 'success' : 'warning'}>
              {data.ready
                ? 'Configured · transactions require live verification'
                : 'Configuration required'}
            </ForgeStatus>
            <div className="status-panel">
              <h2>Before launch</h2>
              {data.blockers.length ? (
                <ul>
                  {data.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  Launch configuration is present. Each transaction still undergoes RPC verification
                  and simulation.
                </p>
              )}
              <dl className="review-list">
                <div>
                  <dt>Network</dt>
                  <dd>
                    {data.network} · {data.chainId}
                  </dd>
                </div>
                <div>
                  <dt>PONS launch factory</dt>
                  <dd>
                    <ForgeAddress value={data.pons} short />
                  </dd>
                </div>
                <div>
                  <dt>ForgeRouterFactory</dt>
                  <dd>
                    <ForgeAddress value={data.forgeFactory} short />
                  </dd>
                </div>
              </dl>
              <h3>Integration boundaries</h3>
              <ul>
                {data.limitations.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <p className="muted small">{data.verification}</p>
            </div>
          </>
        )
      )}
    </section>
  );
}
