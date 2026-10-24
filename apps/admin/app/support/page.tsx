'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '@/app/providers';
import { ApiError, api } from '@/lib/api';
import { AdminShell, Empty, Panel, RequireStaff } from '@/components/shell';

interface SupportMessage {
  id: string;
  authorType: 'USER' | 'STAFF';
  authorLabel: string;
  body: string;
  createdAt: string;
}

interface SupportThread {
  id: string;
  subject: string;
  status: 'OPEN' | 'ANSWERED' | 'RESOLVED';
  transferId: string | null;
  transferReference: string | null;
  createdAt: string;
  updatedAt: string;
  messages: SupportMessage[];
}

/**
 * The support queue (BUILD_PLAN 14.6).
 *
 * Deliberately not the compliance queue. A compliance case is a regulated
 * record with a decision, a reason and four-eyes around it; this is a
 * conversation with a customer about a payment. They are next to each other in
 * the navigation and nowhere else.
 *
 * Oldest first, because a support queue sorted newest-first is a queue where
 * the person who has waited longest is on the last page.
 */
function SupportConsole() {
  const { can } = useAdmin();
  const [threads, setThreads] = useState<SupportThread[] | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api<{ threads: SupportThread[] }>('/admin/support/threads');
      setThreads(result.threads);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the queue');
      setThreads([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function reply(threadId: string) {
    const body = (replies[threadId] ?? '').trim();
    if (body === '') return;
    setBusy(threadId);
    setError(null);
    try {
      await api(`/admin/support/threads/${threadId}/reply`, { method: 'POST', body: { body } });
      setReplies((current) => ({ ...current, [threadId]: '' }));
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The reply was not sent');
    } finally {
      setBusy(null);
    }
  }

  async function resolve(threadId: string) {
    setBusy(threadId);
    try {
      await api(`/admin/support/threads/${threadId}/resolve`, { method: 'POST' });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!can('SUPPORT', 'COMPLIANCE_OFFICER', 'ADMIN')) {
    return <div className="mp-notice mp-notice--warning">You do not have access to support.</div>;
  }

  return (
    <div className="mp-stack">
      <h1>Support</h1>
      <p className="mp-small mp-muted" style={{ marginTop: 0 }}>
        Customer conversations, oldest first. This is not the compliance queue — a decision that
        needs a reason and a second pair of eyes belongs there, not here.
      </p>

      {error === null ? null : (
        <div className="mp-notice mp-notice--danger" role="alert">
          {error}
        </div>
      )}

      <Panel title={`Open conversations · ${threads?.length ?? 0}`}>
        {threads === null ? (
          <div className="mp-skeleton" style={{ width: '50%' }} />
        ) : threads.length === 0 ? (
          <Empty>Nothing waiting. Threads a customer opens in the app land here.</Empty>
        ) : (
          <div className="mp-stack">
            {threads.map((thread) => (
              <article key={thread.id} className="mp-card mp-card--flat mp-stack mp-stack--tight">
                <div className="mp-row">
                  <div>
                    <strong>{thread.subject}</strong>
                    <br />
                    <span className="mp-small mp-muted">
                      {thread.transferReference === null ? '' : `${thread.transferReference} · `}
                      opened {new Date(thread.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <span
                    className={`mp-badge ${
                      thread.status === 'OPEN' ? 'mp-badge--warning' : 'mp-badge--progress'
                    }`}
                  >
                    {thread.status}
                  </span>
                </div>

                <div className="mp-stack mp-stack--tight">
                  {thread.messages.map((message) => (
                    <div
                      key={message.id}
                      style={{
                        borderLeft: `3px solid ${
                          message.authorType === 'STAFF'
                            ? 'var(--brand-500, #e08a1e)'
                            : 'var(--border)'
                        }`,
                        paddingLeft: 10,
                      }}
                    >
                      <div className="mp-small mp-muted">
                        {message.authorType === 'STAFF' ? message.authorLabel : 'Customer'} ·{' '}
                        {new Date(message.createdAt).toLocaleString()}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{message.body}</div>
                    </div>
                  ))}
                </div>

                <textarea
                  className="mp-input"
                  rows={3}
                  placeholder="Reply to the customer. Never include identity numbers — this is not a partition."
                  value={replies[thread.id] ?? ''}
                  onChange={(e) =>
                    setReplies((current) => ({ ...current, [thread.id]: e.target.value }))
                  }
                />
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    className="mp-button mp-button--primary"
                    disabled={busy === thread.id || (replies[thread.id] ?? '').trim() === ''}
                    onClick={() => void reply(thread.id)}
                  >
                    Send reply
                  </button>
                  <button
                    className="mp-button mp-button--secondary"
                    disabled={busy === thread.id}
                    onClick={() => void resolve(thread.id)}
                  >
                    Mark resolved
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

export default function SupportPage() {
  return (
    <AdminShell>
      <RequireStaff>
        <SupportConsole />
      </RequireStaff>
    </AdminShell>
  );
}
