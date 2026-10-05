'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '@/app/providers';
import { ApiError, api } from '@/lib/api';
import { AdminShell, Empty, MoneyDto, Panel, RequireStaff } from '@/components/shell';

interface TransferRow {
  id: string;
  reference: string;
  state: string;
  senderStatus: string;
  corridorId: string;
  sendAmount: MoneyDto;
  recipientAmount: MoneyDto;
  fee: MoneyDto;
  maskedRecipient: string;
  resolvedName: string | null;
  failureCode: string | null;
  createdAt: string;
}

interface TransferDetail extends TransferRow {
  payinProviderRef: string | null;
  payoutProviderRef: string | null;
  payoutInstitutionRef: string | null;
  failureReason: string | null;
  screenings: Array<{
    id: string;
    subjectType: string;
    status: string;
    score: number;
    listVersion: string;
    screenedAt: string;
  }>;
  timeline: Array<{
    event: string;
    fromState: string;
    toState: string;
    actorType: string;
    at: string;
  }>;
  ledger: Array<{
    id: string;
    reason: string;
    description: string;
    occurredAt: string;
    entries: Array<{ account: string; direction: string; amount: MoneyDto }>;
  }>;
}

const REASON_CODES = [
  'PARTNER_OUTAGE',
  'RECIPIENT_UNREACHABLE',
  'SENDER_REQUEST',
  'SUSPECTED_FRAUD',
  'DUPLICATE_TRANSFER',
  'DATA_ENTRY_ERROR',
  'REGULATORY_HOLD',
];

/**
 * Operations console (BUILD_PLAN 9.2).
 *
 * The ledger postings are shown alongside the transfer, because the question an
 * operator actually has when something looks wrong is "where is the money", and
 * the answer is the double entries.
 */
function OperationsConsole() {
  const { can } = useAdmin();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<TransferRow[] | null>(null);
  const [selected, setSelected] = useState<TransferDetail | null>(null);
  const [reasonCode, setReasonCode] = useState(REASON_CODES[0] ?? 'PARTNER_OUTAGE');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const search = useCallback(async () => {
    const params = query.trim() === '' ? '' : `?reference=${encodeURIComponent(query.trim())}`;
    const result = await api<{ transfers: TransferRow[] }>(`/admin/transfers${params}`);
    setRows(result.transfers);
  }, [query]);

  useEffect(() => {
    void search().catch(() => setRows([]));
  }, [search]);

  async function open(id: string) {
    setSelected(await api<TransferDetail>(`/admin/transfers/${id}`));
  }

  async function refund() {
    if (selected === null) return;
    if (reason.trim().length < 5) {
      setError('A refund needs a written reason.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/transfers/${selected.id}/refund`, {
        method: 'POST',
        body: { reasonCode, reason },
      });
      await open(selected.id);
      await search();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The refund was not initiated');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mp-stack">
      <h1>Operations</h1>

      {error === null ? null : (
        <div className="mp-notice mp-notice--danger" role="alert">
          {error}
        </div>
      )}

      <Panel
        title="Transfer search"
        action={
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input
              className="mp-input"
              placeholder="Reference, e.g. MP-4F2A"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ minHeight: 36 }}
            />
            <button
              className="mp-button mp-button--secondary"
              style={{ minHeight: 36 }}
              onClick={() => void search()}
            >
              Search
            </button>
          </div>
        }
      >
        {rows === null ? (
          <div className="mp-skeleton" style={{ width: '60%' }} />
        ) : rows.length === 0 ? (
          <Empty>No transfers match.</Empty>
        ) : (
          <div className="mp-scroll-x">
            <table className="mp-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Corridor</th>
                  <th>Recipient</th>
                  <th>Sent</th>
                  <th>Received</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="mp-numeric">{row.reference}</td>
                    <td>{row.corridorId}</td>
                    <td>
                      {row.resolvedName}
                      <br />
                      <span className="mp-muted mp-numeric">{row.maskedRecipient}</span>
                    </td>
                    <td className="mp-numeric">{row.sendAmount.formatted}</td>
                    <td className="mp-numeric">{row.recipientAmount.formatted}</td>
                    <td>
                      <span className="mp-badge mp-badge--progress">{row.state}</span>
                    </td>
                    <td>
                      <button
                        className="mp-button mp-button--ghost"
                        style={{ minHeight: 32, padding: '0 10px' }}
                        onClick={() => void open(row.id)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected === null ? null : (
        <>
          <Panel title={`Transfer ${selected.reference}`}>
            <div className="mp-grid">
              <div className="mp-stack mp-stack--tight">
                <div className="mp-row">
                  <span className="mp-muted mp-small">State</span>
                  <strong>{selected.state}</strong>
                </div>
                <div className="mp-row">
                  <span className="mp-muted mp-small">Pay-in reference</span>
                  <span className="mp-numeric mp-small">{selected.payinProviderRef ?? '—'}</span>
                </div>
                <div className="mp-row">
                  <span className="mp-muted mp-small">Payout reference</span>
                  <span className="mp-numeric mp-small">{selected.payoutProviderRef ?? '—'}</span>
                </div>
                <div className="mp-row">
                  <span className="mp-muted mp-small">Institution reference</span>
                  <span className="mp-numeric mp-small">
                    {selected.payoutInstitutionRef ?? '—'}
                  </span>
                </div>
                {selected.failureReason === null ? null : (
                  <div className="mp-notice mp-notice--danger mp-small">
                    {selected.failureCode}: {selected.failureReason}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mp-card__title">Screening</h3>
                <table className="mp-table">
                  <tbody>
                    {selected.screenings.map((screening) => (
                      <tr key={screening.id}>
                        <td>{screening.subjectType}</td>
                        <td>
                          <span
                            className={`mp-badge ${
                              screening.status === 'CLEAR'
                                ? 'mp-badge--success'
                                : 'mp-badge--danger'
                            }`}
                          >
                            {screening.status}
                          </span>
                        </td>
                        <td className="mp-numeric">{screening.score}</td>
                        <td className="mp-small mp-muted">{screening.listVersion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Panel>

          <Panel title="Ledger postings">
            {selected.ledger.length === 0 ? (
              <Empty>Nothing posted yet — no money has moved.</Empty>
            ) : (
              <div className="mp-scroll-x">
                <table className="mp-table">
                  <thead>
                    <tr>
                      <th>Reason</th>
                      <th>Account</th>
                      <th>Dr</th>
                      <th>Cr</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.ledger.flatMap((posting) =>
                      posting.entries.map((entry, index) => (
                        <tr key={`${posting.id}-${index}`}>
                          <td>{index === 0 ? posting.reason : ''}</td>
                          <td className="mp-small mp-numeric">{entry.account}</td>
                          <td className="mp-numeric">
                            {entry.direction === 'DEBIT' ? entry.amount.formatted : ''}
                          </td>
                          <td className="mp-numeric">
                            {entry.direction === 'CREDIT' ? entry.amount.formatted : ''}
                          </td>
                          <td className="mp-small mp-muted">
                            {index === 0 ? new Date(posting.occurredAt).toLocaleString() : ''}
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Timeline">
            <ol className="mp-timeline">
              {selected.timeline.map((event) => (
                <li className="mp-timeline__item" key={`${event.event}-${event.at}`}>
                  <span className="mp-timeline__dot mp-timeline__dot--done" aria-hidden />
                  <span>
                    <strong>
                      {event.fromState} → {event.toState}
                    </strong>
                    <br />
                    <span className="mp-small mp-muted">
                      {event.event} · {event.actorType} · {new Date(event.at).toLocaleString()}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>

          {can('SUPPORT', 'ADMIN') ? (
            <Panel title="Manual intervention">
              <div className="mp-stack mp-stack--tight">
                {/* A reason code and free text are both mandatory: the code
                    makes intervention countable, the text makes it explicable. */}
                <div className="mp-field">
                  <label className="mp-label">Reason code</label>
                  <select
                    className="mp-select"
                    value={reasonCode}
                    onChange={(e) => setReasonCode(e.target.value)}
                  >
                    {REASON_CODES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  className="mp-input"
                  placeholder="What happened, in a sentence"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <button
                  className="mp-button mp-button--danger"
                  onClick={refund}
                  disabled={busy}
                  style={{ alignSelf: 'flex-start' }}
                >
                  Refund this transfer
                </button>
              </div>
            </Panel>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function OperationsPage() {
  return (
    <AdminShell>
      <RequireStaff>
        <OperationsConsole />
      </RequireStaff>
    </AdminShell>
  );
}
