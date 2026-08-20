'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdmin } from '@/app/providers';
import { ApiError, api } from '@/lib/api';
import { AdminShell, Empty, Panel, RequireStaff } from '@/components/shell';

interface Declaration {
  declarationId: string;
  transferReference: string;
  transferState: string;
  valueDate: string;
  regime: string;
  categoryCode: string;
  categoryLabel: string;
  allowanceKind: string;
  allowanceYear: number;
  amountMinorUnits: string;
  currency: string;
  senderName: string | null;
  senderIdentityNumber: string | null;
  senderTaxReference: string | null;
  reportedAt: string | null;
}

interface Extract {
  declarations: Declaration[];
  missingIdentity: number;
}

/** Decimals per currency. Only the ones a regime can quote an allowance in. */
const DECIMALS: Record<string, number> = { ZAR: 2, NGN: 2, GHS: 2, XAF: 0, XOF: 0 };

/**
 * Exchange-control console (BUILD_PLAN 4.3c, OPEN_ITEMS B8).
 *
 * We do not file with the regulator — the Authorised Dealer does. What they
 * need is each declaration joined to the sender's identity, and this is the one
 * screen where a name, a national identity number and a payment come together.
 * That join happens in memory on the server when the extract is produced and is
 * never persisted, so this page is the only place it exists.
 *
 * Two things are deliberately loud rather than tidy:
 *
 *  - a declaration with no sender name is shown as a problem, not skipped. It
 *    means the residency partition holds no record for that token, and handing
 *    the AD a file with a silent gap in it is worse than handing them nothing;
 *  - "mark as reported" is a claim about the outside world, so it is a separate
 *    deliberate act after the file has actually been sent — never a side effect
 *    of downloading it.
 */
function ExchangeControlConsole() {
  const { can } = useAdmin();
  const [extract, setExtract] = useState<Extract | null>(null);
  const [includeReported, setIncludeReported] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<Extract>(
        `/admin/exchange-control/pending?includeReported=${includeReported}`,
      );
      setExtract(result);
      setSelected({});
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load declarations');
      setExtract({ declarations: [], missingIdentity: 0 });
    }
  }, [includeReported]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = extract?.declarations ?? [];
  const selectedIds = useMemo(
    () => rows.filter((row) => selected[row.declarationId] === true).map((r) => r.declarationId),
    [rows, selected],
  );

  /* What each sender has consumed, of the rows on screen.
     Grouped by identity number and allowance year, because an allowance is per
     person per calendar year. Keyed by identity rather than by name: two people
     can share a name, and one person can be recorded under two spellings. */
  const bySender = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        senderName: string | null;
        identity: string | null;
        year: number;
        currency: string;
        count: number;
        totalMinorUnits: string;
      }
    >();
    for (const row of rows) {
      const key = `${row.senderIdentityNumber ?? `unknown:${row.declarationId}`}:${row.allowanceYear}`;
      const existing = groups.get(key);
      if (existing === undefined) {
        groups.set(key, {
          key,
          senderName: row.senderName,
          identity: row.senderIdentityNumber,
          year: row.allowanceYear,
          currency: row.currency,
          count: 1,
          totalMinorUnits: row.amountMinorUnits,
        });
        continue;
      }
      existing.count += 1;
      // BigInt, not Number: a rand total in minor units passes 2^53 long before
      // it stops being a plausible annual allowance.
      existing.totalMinorUnits = (
        BigInt(existing.totalMinorUnits) + BigInt(row.amountMinorUnits)
      ).toString();
    }
    return [...groups.values()];
  }, [rows]);

  /* The file the Authorised Dealer receives. CSV because that is what a bank's
     reporting desk actually ingests, and because it is readable by a human
     checking it before it leaves the building. */
  function downloadCsv() {
    const chosen =
      selectedIds.length > 0 ? rows.filter((r) => selectedIds.includes(r.declarationId)) : rows;
    const header = [
      'declaration_id',
      'transfer_reference',
      'value_date',
      'regime',
      'category_code',
      'category_label',
      'allowance_kind',
      'allowance_year',
      'amount',
      'currency',
      'sender_name',
      'sender_identity_number',
      'sender_tax_reference',
      'transfer_state',
    ];
    const lines = chosen.map((row) =>
      [
        row.declarationId,
        row.transferReference,
        row.valueDate,
        row.regime,
        row.categoryCode,
        row.categoryLabel,
        row.allowanceKind,
        String(row.allowanceYear),
        // Ungrouped on purpose: the grouping separators are for a human reading
        // the table, and a reporting desk parses this column.
        decimalString(row.amountMinorUnits, row.currency),
        row.currency,
        // Empty rather than a placeholder: the AD must see the gap.
        row.senderName ?? '',
        row.senderIdentityNumber ?? '',
        row.senderTaxReference ?? '',
        row.transferState,
      ]
        .map(csvCell)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `exchange-control-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function markReported() {
    if (selectedIds.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ marked: number }>('/admin/exchange-control/mark-reported', {
        method: 'POST',
        body: { ids: selectedIds },
      });
      setNotice(`${result.marked} declaration(s) marked as handed to the Authorised Dealer.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Nothing was marked');
    } finally {
      setBusy(false);
    }
  }

  if (!can('COMPLIANCE_OFFICER')) {
    return (
      <div className="mp-notice mp-notice--warning">
        Exchange-control declarations carry identity numbers. Only a compliance officer may read
        them.
      </div>
    );
  }

  return (
    <div className="mp-stack">
      <h1>Exchange control</h1>

      <p className="mp-small mp-muted" style={{ marginTop: 0 }}>
        Declarations captured at the point of sending, for the Authorised Dealer to file. MoraPay
        does not file with the regulator; the AD does, and these are the rows they need.
      </p>

      {error === null ? null : (
        <div className="mp-notice mp-notice--danger" role="alert">
          {error}
        </div>
      )}
      {notice === null ? null : <div className="mp-notice mp-notice--info">{notice}</div>}

      {extract !== null && extract.missingIdentity > 0 ? (
        <div className="mp-notice mp-notice--warning">
          {extract.missingIdentity} declaration(s) have no sender identity on file. The residency
          partition holds no record for those tokens. Investigate before sending the extract — a
          file with a silent gap is worse than no file.
        </div>
      ) : null}

      {bySender.length === 0 ? null : (
        <Panel title="Allowance used, by sender">
          <p className="mp-small mp-muted" style={{ marginTop: 0 }}>
            Totalled across the declarations listed below, and across MoraPay only. A sender&apos;s
            allowance is personal and spans every provider they use, so this is a floor on what they
            have consumed — never a ceiling. The Authorised Dealer holds the complete picture.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="mp-table">
              <thead>
                <tr>
                  <th>Sender</th>
                  <th>Identity</th>
                  <th>Year</th>
                  <th style={{ textAlign: 'right' }}>Declarations</th>
                  <th style={{ textAlign: 'right' }}>Total through us</th>
                </tr>
              </thead>
              <tbody>
                {bySender.map((group) => (
                  <tr key={group.key}>
                    <td>
                      {group.senderName ?? (
                        <span className="mp-badge mp-badge--warning">no record</span>
                      )}
                    </td>
                    <td className="mp-numeric mp-small">{group.identity ?? '—'}</td>
                    <td className="mp-numeric">{group.year}</td>
                    <td className="mp-numeric" style={{ textAlign: 'right' }}>
                      {group.count}
                    </td>
                    <td className="mp-numeric" style={{ textAlign: 'right' }}>
                      {formatMinor(group.totalMinorUnits, group.currency)} {group.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel
        title={`Declarations · ${rows.length}`}
        action={
          <label className="mp-small mp-muted" style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input
              type="checkbox"
              checked={includeReported}
              onChange={(e) => setIncludeReported(e.target.checked)}
            />
            Include already reported
          </label>
        }
      >
        {extract === null ? (
          <div className="mp-skeleton" style={{ width: '50%' }} />
        ) : rows.length === 0 ? (
          <Empty>
            Nothing to report. Declarations appear here as soon as a sender on a regulated origin
            confirms a transfer.
          </Empty>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="mp-table">
              <thead>
                <tr>
                  <th />
                  <th>Reference</th>
                  <th>Value date</th>
                  <th>Category</th>
                  <th>Allowance</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Sender</th>
                  <th>Identity</th>
                  <th>State</th>
                  <th>Reported</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.declarationId}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.transferReference}`}
                        checked={selected[row.declarationId] === true}
                        disabled={row.reportedAt !== null}
                        onChange={(e) =>
                          setSelected((current) => ({
                            ...current,
                            [row.declarationId]: e.target.checked,
                          }))
                        }
                      />
                    </td>
                    <td className="mp-numeric">{row.transferReference}</td>
                    <td className="mp-small">{row.valueDate.slice(0, 10)}</td>
                    <td>
                      <strong className="mp-numeric">{row.categoryCode}</strong>
                      <br />
                      <span className="mp-small mp-muted">{row.categoryLabel}</span>
                    </td>
                    <td className="mp-small">
                      {row.allowanceKind}
                      <br />
                      <span className="mp-muted">{row.allowanceYear}</span>
                    </td>
                    <td className="mp-numeric" style={{ textAlign: 'right' }}>
                      {formatMinor(row.amountMinorUnits, row.currency)} {row.currency}
                    </td>
                    <td>
                      {row.senderName ?? (
                        <span className="mp-badge mp-badge--warning">no record</span>
                      )}
                    </td>
                    <td className="mp-numeric mp-small">{row.senderIdentityNumber ?? '—'}</td>
                    <td className="mp-small">{row.transferState}</td>
                    <td className="mp-small mp-muted">
                      {row.reportedAt === null ? '—' : row.reportedAt.slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {rows.length === 0 ? null : (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button className="mp-button mp-button--secondary" onClick={downloadCsv}>
            {selectedIds.length === 0
              ? `Download all ${rows.length} as CSV`
              : `Download ${selectedIds.length} selected as CSV`}
          </button>
          <button
            className="mp-button mp-button--primary"
            disabled={busy || selectedIds.length === 0}
            onClick={markReported}
          >
            Mark {selectedIds.length} as reported
          </button>
        </div>
      )}

      <p className="mp-small mp-muted">
        Marking a declaration as reported records that it was handed over — it is not a side effect
        of downloading the file, because downloading is not sending.
      </p>
    </div>
  );
}

/** Minor units to a plain decimal string, at the currency's own precision. */
function decimalString(minorUnits: string, currency: string): string {
  const decimals = DECIMALS[currency] ?? 2;
  const digits = minorUnits.padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  return decimals === 0 ? whole : `${whole}.${digits.slice(digits.length - decimals)}`;
}

/** The same number, grouped for a human reading the table. */
function formatMinor(minorUnits: string, currency: string): string {
  const [whole = '0', fraction] = decimalString(minorUnits, currency).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** RFC 4180 quoting. A name with a comma in it must not shift every column. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export default function ExchangeControlPage() {
  return (
    <AdminShell>
      <RequireStaff>
        <ExchangeControlConsole />
      </RequireStaff>
    </AdminShell>
  );
}
