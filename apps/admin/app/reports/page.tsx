'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AdminShell, Empty, MoneyDto, Panel, RequireStaff } from '@/components/shell';

interface VolumeRow {
  corridorId: string;
  count: number;
  sendTotal: MoneyDto;
  recipientTotal: MoneyDto;
  feeTotal: MoneyDto;
  completed: number;
  failed: number;
  refunded: number;
}

interface AuditEvent {
  sequence: string;
  actorType: string;
  actorId: string | null;
  action: string;
  subjectType: string;
  subjectId: string | null;
  reason: string | null;
  at: string;
}

/**
 * Reporting and audit (BUILD_PLAN 9.4, 2.5).
 *
 * The chain-verification button is the interesting one: it recomputes every
 * audit hash from genesis and reports the first row that does not follow. That
 * is the DoD for step 2.5, exposed where a compliance officer can run it rather
 * than buried in a test.
 */
function ReportsConsole() {
  const [rows, setRows] = useState<VolumeRow[] | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [chain, setChain] = useState<{
    ok: boolean;
    checked: number;
    brokenAtSequence?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [volumes, audit] = await Promise.all([
      api<{ rows: VolumeRow[] }>('/admin/reports/volumes'),
      api<{ events: AuditEvent[] }>('/admin/audit?limit=50'),
    ]);
    setRows(volumes.rows);
    setEvents(audit.events);
  }, []);

  useEffect(() => {
    void load().catch(() => setRows([]));
  }, [load]);

  async function verifyChain() {
    setBusy(true);
    try {
      setChain(await api('/admin/audit/verify'));
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    if (rows === null) return;
    const header = 'corridor,transfers,sent,received,fees,completed,failed,refunded';
    const body = rows
      .map((row) =>
        [
          row.corridorId,
          row.count,
          `${row.sendTotal.amount} ${row.sendTotal.currency}`,
          `${row.recipientTotal.amount} ${row.recipientTotal.currency}`,
          `${row.feeTotal.amount} ${row.feeTotal.currency}`,
          row.completed,
          row.failed,
          row.refunded,
        ].join(','),
      )
      .join('\n');

    const blob = new Blob([`${header}\n${body}\n`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `morapay-volumes-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mp-stack">
      <h1>Reporting</h1>

      <Panel
        title="Volume by corridor · last 30 days"
        action={
          <button
            className="mp-button mp-button--secondary"
            style={{ minHeight: 36 }}
            onClick={exportCsv}
          >
            Export CSV
          </button>
        }
      >
        {rows === null ? (
          <div className="mp-skeleton" style={{ width: '50%' }} />
        ) : rows.length === 0 ? (
          <Empty>No transfers in the window.</Empty>
        ) : (
          <div className="mp-scroll-x">
            <table className="mp-table">
              <thead>
                <tr>
                  <th>Corridor</th>
                  <th>Transfers</th>
                  <th>Sent</th>
                  <th>Received</th>
                  <th>Fees</th>
                  <th>Completed</th>
                  <th>Failed</th>
                  <th>Refunded</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.corridorId}>
                    <td>{row.corridorId}</td>
                    <td className="mp-numeric">{row.count}</td>
                    <td className="mp-numeric">{row.sendTotal.formatted}</td>
                    <td className="mp-numeric">{row.recipientTotal.formatted}</td>
                    <td className="mp-numeric">{row.feeTotal.formatted}</td>
                    <td className="mp-numeric">{row.completed}</td>
                    <td className="mp-numeric">{row.failed}</td>
                    <td className="mp-numeric">{row.refunded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mp-small mp-muted" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
          Regulatory report scaffolding. The shape a licensing submission needs — volumes by
          corridor, outcomes, fees — with the suspicious-activity extract to follow once the
          compliance officer has signed off the format.
        </p>
      </Panel>

      <Panel
        title="Audit trail"
        action={
          <button
            className="mp-button mp-button--secondary"
            style={{ minHeight: 36 }}
            onClick={verifyChain}
            disabled={busy}
          >
            Verify the hash chain
          </button>
        }
      >
        {chain === null ? null : chain.ok ? (
          <div className="mp-notice mp-notice--info" style={{ marginBottom: 'var(--space-3)' }}>
            Chain intact across {chain.checked} events. Every row follows from the one before it.
          </div>
        ) : (
          <div className="mp-notice mp-notice--danger" style={{ marginBottom: 'var(--space-3)' }}>
            Chain broken at sequence {chain.brokenAtSequence}. A historical row has been altered.
          </div>
        )}

        <div className="mp-scroll-x">
          <table className="mp-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Subject</th>
                <th>Reason</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.sequence}>
                  <td className="mp-numeric mp-small">{event.sequence}</td>
                  <td>
                    <strong className="mp-small">{event.action}</strong>
                  </td>
                  <td className="mp-small mp-muted">{event.actorType}</td>
                  <td className="mp-small mp-muted">{event.subjectType}</td>
                  <td className="mp-small">{event.reason ?? ''}</td>
                  <td className="mp-small mp-muted">{new Date(event.at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <AdminShell>
      <RequireStaff>
        <ReportsConsole />
      </RequireStaff>
    </AdminShell>
  );
}
