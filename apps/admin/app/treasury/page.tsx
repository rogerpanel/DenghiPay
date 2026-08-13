'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '@/app/providers';
import { ApiError, api } from '@/lib/api';
import { AdminShell, Empty, MoneyDto, Panel, RequireStaff } from '@/components/shell';

interface Positions {
  floats: Array<{
    currency: string;
    accountCode: string;
    balance: MoneyDto;
    lowWatermark: MoneyDto;
    target: MoneyDto;
    belowThreshold: boolean;
  }>;
  exposure: Array<{ currency: string; openExposure: MoneyDto; positionCount: number }>;
}

interface Prefunding {
  id: string;
  currency: string;
  amount: MoneyDto;
  status: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  approvedBy: string | null;
  selfApprovalBlocked: boolean;
}

interface ReconRun {
  id: string;
  providerId: string;
  windowStart: string;
  windowEnd: string;
  ranAt: string;
  matchedCount: number;
  breakCount: number;
}

interface SuspenseItem {
  id: string;
  reference: string;
  amount: MoneyDto;
  note: string;
  openedAt: string;
  ageDays: number;
}

/**
 * Treasury console (BUILD_PLAN 9.3).
 *
 * The four-eyes rule is visible in the interface — the approve button is
 * disabled on your own request — and enforced on the server, in the posting
 * builder, and by a database constraint. The disabled button is the courtesy;
 * the other three are the control.
 */
function TreasuryConsole() {
  const { can } = useAdmin();
  const [positions, setPositions] = useState<Positions | null>(null);
  const [prefunding, setPrefunding] = useState<Prefunding[]>([]);
  const [runs, setRuns] = useState<ReconRun[]>([]);
  const [suspense, setSuspense] = useState<SuspenseItem[]>([]);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'RUB' | 'NGN' | 'GHS'>('NGN');
  const [reason, setReason] = useState('');
  const [decisionReason, setDecisionReason] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [pos, pre, recon, susp] = await Promise.all([
      api<Positions>('/admin/treasury/positions'),
      api<{ requests: Prefunding[] }>('/admin/treasury/prefunding'),
      api<{ runs: ReconRun[] }>('/admin/reconciliation/runs'),
      api<{ items: SuspenseItem[] }>('/admin/reconciliation/suspense'),
    ]);
    setPositions(pos);
    setPrefunding(pre.requests);
    setRuns(recon.runs);
    setSuspense(susp.items);
  }, []);

  useEffect(() => {
    void load().catch(() => setError('Could not load treasury data'));
  }, [load]);

  async function request() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api('/admin/treasury/prefunding', {
        method: 'POST',
        body: {
          currency,
          amountMinorUnits: toMinorUnits(amount),
          reason,
        },
      });
      setAmount('');
      setReason('');
      setNotice('Requested. A different treasury identity must approve it.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The request was not created');
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
    const why = decisionReason[id] ?? '';
    if (why.trim().length < 5) {
      setError('A treasury decision needs a written reason.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/treasury/prefunding/${id}/decision`, {
        method: 'POST',
        body: { decision, reason: why },
      });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The decision was refused');
    } finally {
      setBusy(false);
    }
  }

  async function runReconciliation(providerId: string) {
    setBusy(true);
    try {
      await api(`/admin/reconciliation/run/${providerId}`, { method: 'POST' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mp-stack">
      <h1>Treasury</h1>

      {error === null ? null : (
        <div className="mp-notice mp-notice--danger" role="alert">
          {error}
        </div>
      )}
      {notice === null ? null : <div className="mp-notice mp-notice--info">{notice}</div>}

      <Panel title="Float positions">
        {positions === null ? (
          <div className="mp-skeleton" style={{ width: '50%' }} />
        ) : (
          <div className="mp-grid">
            {positions.floats.map((position) => (
              <div key={position.currency} className="mp-card mp-card--flat">
                <div className="mp-row">
                  <strong>{position.currency}</strong>
                  {position.belowThreshold ? (
                    <span className="mp-badge mp-badge--danger">below watermark</span>
                  ) : (
                    <span className="mp-badge mp-badge--success">healthy</span>
                  )}
                </div>
                <div className="mp-amount mp-amount--lg mp-numeric">
                  {position.balance.formatted}
                </div>
                <p className="mp-small mp-muted" style={{ marginBottom: 0 }}>
                  Watermark {position.lowWatermark.formatted} · target {position.target.formatted}
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Open FX exposure">
        {positions === null || positions.exposure.length === 0 ? (
          <Empty>No open positions. Every quote lock is closed.</Empty>
        ) : (
          <table className="mp-table">
            <thead>
              <tr>
                <th>Currency</th>
                <th>Unhedged</th>
                <th>Positions</th>
              </tr>
            </thead>
            <tbody>
              {positions.exposure.map((row) => (
                <tr key={row.currency}>
                  <td>{row.currency}</td>
                  <td className="mp-numeric">{row.openExposure.formatted}</td>
                  <td className="mp-numeric">{row.positionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {can('TREASURY_OPERATOR') ? (
        <Panel title="Request prefunding">
          <div className="mp-stack mp-stack--tight">
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <select
                className="mp-select"
                style={{ maxWidth: 140 }}
                value={currency}
                onChange={(e) => setCurrency(e.target.value as 'RUB' | 'NGN' | 'GHS')}
              >
                <option value="RUB">RUB</option>
                <option value="NGN">NGN</option>
                <option value="GHS">GHS</option>
              </select>
              <input
                className="mp-input"
                style={{ maxWidth: 220 }}
                inputMode="decimal"
                placeholder="Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              />
              <input
                className="mp-input"
                style={{ flex: 1, minWidth: 240 }}
                placeholder="Why this float needs topping up"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button className="mp-button mp-button--primary" onClick={request} disabled={busy}>
                Request
              </button>
            </div>
            <p className="mp-small mp-muted">
              Guardrail G6: whoever requests this cannot approve it. A second treasury identity has
              to.
            </p>
          </div>
        </Panel>
      ) : null}

      <Panel title="Prefunding approvals">
        {prefunding.length === 0 ? (
          <Empty>No prefunding requests.</Empty>
        ) : (
          <div className="mp-stack">
            {prefunding.map((request) => (
              <article key={request.id} className="mp-card mp-card--flat mp-stack mp-stack--tight">
                <div className="mp-row">
                  <div>
                    <strong className="mp-numeric">{request.amount.formatted}</strong>
                    <br />
                    <span className="mp-small mp-muted">
                      {request.reason} · requested {new Date(request.requestedAt).toLocaleString()}
                    </span>
                  </div>
                  <span
                    className={`mp-badge ${
                      request.status === 'EXECUTED'
                        ? 'mp-badge--success'
                        : request.status === 'REJECTED'
                          ? 'mp-badge--danger'
                          : 'mp-badge--warning'
                    }`}
                  >
                    {request.status}
                  </span>
                </div>

                {request.status === 'REQUESTED' ? (
                  request.selfApprovalBlocked ? (
                    <div className="mp-notice mp-notice--warning mp-small">
                      You requested this. Four-eyes: someone else has to approve it.
                    </div>
                  ) : (
                    <div className="mp-stack mp-stack--tight">
                      <input
                        className="mp-input"
                        placeholder="Reason for the decision"
                        value={decisionReason[request.id] ?? ''}
                        onChange={(e) =>
                          setDecisionReason((current) => ({
                            ...current,
                            [request.id]: e.target.value,
                          }))
                        }
                      />
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button
                          className="mp-button mp-button--primary"
                          disabled={busy}
                          onClick={() => decide(request.id, 'APPROVE')}
                        >
                          Approve and execute
                        </button>
                        <button
                          className="mp-button mp-button--danger"
                          disabled={busy}
                          onClick={() => decide(request.id, 'REJECT')}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )
                ) : null}
              </article>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Reconciliation"
        action={
          can('TREASURY_OPERATOR', 'ADMIN') ? (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                className="mp-button mp-button--secondary"
                style={{ minHeight: 36 }}
                disabled={busy}
                onClick={() => void runReconciliation('payout-ng-sim')}
              >
                Run NG
              </button>
              <button
                className="mp-button mp-button--secondary"
                style={{ minHeight: 36 }}
                disabled={busy}
                onClick={() => void runReconciliation('payin-ru-sim')}
              >
                Run RU
              </button>
            </div>
          ) : undefined
        }
      >
        {runs.length === 0 ? (
          <Empty>No reconciliation runs yet. The scheduled job runs at 02:00 UTC.</Empty>
        ) : (
          <table className="mp-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Window</th>
                <th>Matched</th>
                <th>Breaks</th>
                <th>Ran</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{run.providerId}</td>
                  <td className="mp-small mp-muted">
                    {new Date(run.windowStart).toLocaleDateString()} –{' '}
                    {new Date(run.windowEnd).toLocaleDateString()}
                  </td>
                  <td className="mp-numeric">{run.matchedCount}</td>
                  <td className="mp-numeric">
                    {run.breakCount === 0 ? (
                      <span className="mp-badge mp-badge--success">0</span>
                    ) : (
                      <span className="mp-badge mp-badge--danger">{run.breakCount}</span>
                    )}
                  </td>
                  <td className="mp-small mp-muted">{new Date(run.ranAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title={`Suspense · ${suspense.length}`}>
        {suspense.length === 0 ? (
          <Empty>Nothing unmatched. Every movement reconciles.</Empty>
        ) : (
          <table className="mp-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Amount</th>
                <th>Note</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {suspense.map((item) => (
                <tr key={item.id}>
                  <td className="mp-numeric mp-small">{item.reference}</td>
                  <td className="mp-numeric">{item.amount.formatted}</td>
                  <td className="mp-small">{item.note}</td>
                  <td>
                    <span
                      className={`mp-badge ${
                        item.ageDays > 7 ? 'mp-badge--danger' : 'mp-badge--warning'
                      }`}
                    >
                      {item.ageDays}d
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function toMinorUnits(input: string): string {
  const [whole = '0', fraction = ''] = input.split('.');
  return `${whole || '0'}${fraction.padEnd(2, '0').slice(0, 2)}`.replace(/^0+(?=\d)/, '');
}

export default function TreasuryPage() {
  return (
    <AdminShell>
      <RequireStaff>
        <TreasuryConsole />
      </RequireStaff>
    </AdminShell>
  );
}
