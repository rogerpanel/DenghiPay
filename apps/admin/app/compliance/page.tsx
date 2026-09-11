'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '@/app/providers';
import { ApiError, api } from '@/lib/api';
import { AdminShell, Empty, Panel, RequireStaff } from '@/components/shell';

interface ComplianceCase {
  id: string;
  type: string;
  status: string;
  summary: string;
  transferId: string | null;
  transferReference: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
  notes: Array<{ id: string; authorId: string; body: string; createdAt: string }>;
}

interface KycCase {
  id: string;
  userId: string;
  targetTier: number;
  status: string;
  documentTypes: string[];
  submittedAt: string;
}

/**
 * Compliance console (BUILD_PLAN 9.1).
 *
 * A decision requires a written reason — the field is mandatory here because it
 * is mandatory on the server, and the reason goes into the hash-chained audit
 * log alongside the actor and the before/after state.
 */
function ComplianceConsole() {
  const { can } = useAdmin();
  const [cases, setCases] = useState<ComplianceCase[] | null>(null);
  const [kyc, setKyc] = useState<KycCase[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [queue, kycQueue] = await Promise.all([
        api<{ cases: ComplianceCase[] }>('/admin/compliance/cases'),
        can('COMPLIANCE_OFFICER', 'ADMIN')
          ? api<{ cases: KycCase[] }>('/admin/compliance/kyc')
          : Promise.resolve({ cases: [] }),
      ]);
      setCases(queue.cases);
      setKyc(kycQueue.cases);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the queue');
      setCases([]);
    }
  }, [can]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(caseId: string, decision: 'CLEAR' | 'REJECT') {
    const reason = reasons[caseId] ?? '';
    if (reason.trim().length < 5) {
      setError('A decision needs a written reason of at least five characters.');
      return;
    }
    setBusy(caseId);
    setError(null);
    try {
      await api(`/admin/compliance/cases/${caseId}/decision`, {
        method: 'POST',
        body: { decision, reason },
      });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The decision was not recorded');
    } finally {
      setBusy(null);
    }
  }

  async function decideKyc(caseId: string, decision: 'APPROVE' | 'REJECT') {
    const reason = reasons[caseId] ?? '';
    if (reason.trim().length < 5) {
      setError('A KYC decision needs a written reason.');
      return;
    }
    setBusy(caseId);
    try {
      await api(`/admin/compliance/kyc/${caseId}/decision`, {
        method: 'POST',
        body: { decision, reason },
      });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The decision was not recorded');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mp-stack">
      <h1>Compliance</h1>

      {error === null ? null : (
        <div className="mp-notice mp-notice--danger" role="alert">
          {error}
        </div>
      )}

      <Panel title={`Review queue${cases === null ? '' : ` · ${cases.length}`}`}>
        {cases === null ? (
          <div className="mp-skeleton" style={{ width: '50%' }} />
        ) : cases.length === 0 ? (
          <Empty>Nothing waiting. Every transfer is screened, so this is where hits land.</Empty>
        ) : (
          <div className="mp-stack">
            {cases.map((item) => (
              <article key={item.id} className="mp-card mp-card--flat mp-stack mp-stack--tight">
                <div className="mp-row">
                  <div>
                    <strong>{item.summary}</strong>
                    <br />
                    <span className="mp-small mp-muted">
                      {item.type} · {new Date(item.createdAt).toLocaleString()}
                      {item.transferReference === null ? '' : ` · ${item.transferReference}`}
                    </span>
                  </div>
                  <span
                    className={`mp-badge ${
                      item.status === 'OPEN' ? 'mp-badge--warning' : 'mp-badge--progress'
                    }`}
                  >
                    {item.status}
                  </span>
                </div>

                {/* The screening evidence an officer needs to adjudicate: which
                    list, what score, which programme. */}
                <details>
                  <summary className="mp-small mp-muted">Evidence</summary>
                  <pre
                    className="mp-small"
                    style={{
                      whiteSpace: 'pre-wrap',
                      background: 'var(--surface-sunken)',
                      padding: 8,
                      borderRadius: 6,
                      overflowX: 'auto',
                    }}
                  >
                    {JSON.stringify(item.detail, null, 2)}
                  </pre>
                </details>

                {can('COMPLIANCE_OFFICER') ? (
                  <div className="mp-stack mp-stack--tight">
                    <input
                      className="mp-input"
                      placeholder="Reason for this decision (recorded in the audit log)"
                      value={reasons[item.id] ?? ''}
                      onChange={(e) =>
                        setReasons((current) => ({ ...current, [item.id]: e.target.value }))
                      }
                    />
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button
                        className="mp-button mp-button--primary"
                        disabled={busy === item.id}
                        onClick={() => decide(item.id, 'CLEAR')}
                      >
                        Clear and release
                      </button>
                      <button
                        className="mp-button mp-button--danger"
                        disabled={busy === item.id}
                        onClick={() => decide(item.id, 'REJECT')}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mp-small mp-muted">
                    Only a compliance officer may decide a case — an administrator cannot.
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </Panel>

      {can('COMPLIANCE_OFFICER', 'ADMIN') ? (
        <Panel title={`KYC decisions · ${kyc.length}`}>
          {kyc.length === 0 ? (
            <Empty>No identity verifications are waiting for a human.</Empty>
          ) : (
            <div className="mp-stack">
              {kyc.map((item) => (
                <article key={item.id} className="mp-card mp-card--flat mp-stack mp-stack--tight">
                  <div className="mp-row">
                    <div>
                      <strong>Tier {item.targetTier} requested</strong>
                      <br />
                      <span className="mp-small mp-muted">
                        {item.documentTypes.join(', ')} ·{' '}
                        {new Date(item.submittedAt).toLocaleString()}
                      </span>
                    </div>
                    <span className="mp-badge mp-badge--warning">{item.status}</span>
                  </div>
                  {can('COMPLIANCE_OFFICER') ? (
                    <div className="mp-stack mp-stack--tight">
                      <input
                        className="mp-input"
                        placeholder="Reason"
                        value={reasons[item.id] ?? ''}
                        onChange={(e) =>
                          setReasons((current) => ({ ...current, [item.id]: e.target.value }))
                        }
                      />
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button
                          className="mp-button mp-button--primary"
                          disabled={busy === item.id}
                          onClick={() => decideKyc(item.id, 'APPROVE')}
                        >
                          Approve
                        </button>
                        <button
                          className="mp-button mp-button--danger"
                          disabled={busy === item.id}
                          onClick={() => decideKyc(item.id, 'REJECT')}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

export default function CompliancePage() {
  return (
    <AdminShell>
      <RequireStaff>
        <ComplianceConsole />
      </RequireStaff>
    </AdminShell>
  );
}
