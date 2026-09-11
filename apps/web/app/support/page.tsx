'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/app/providers';
import { ApiError, api } from '@/lib/api';
import { AppShell, ErrorNotice, Field, LoadingCard, RequireAuth } from '@/components/shell';

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

function SupportInner() {
  const { t } = useApp();
  const [threads, setThreads] = useState<SupportThread[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<{ threads: SupportThread[] }>('/support');
      setThreads(result.threads);
    } catch {
      setError(t('error.generic'));
      setThreads([]);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const thread = await api<SupportThread>('/support', {
        method: 'POST',
        body: { subject, body },
      });
      setSubject('');
      setBody('');
      setOpenId(thread.id);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(threadId: string) {
    setBusy(true);
    try {
      await api(`/support/${threadId}/reply`, { method: 'POST', body: { body: reply } });
      setReply('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  if (threads === null) return <LoadingCard />;

  return (
    <div className="mp-stack">
      <h1>{t('support.title')}</h1>
      <ErrorNotice message={error} />

      {threads.map((thread) => (
        <section key={thread.id} className="mp-card mp-stack mp-stack--tight">
          <button
            className="mp-row"
            style={{ background: 'none', border: 0, padding: 0, width: '100%', textAlign: 'left' }}
            onClick={() => setOpenId(openId === thread.id ? null : thread.id)}
          >
            <span>
              <strong>{thread.subject}</strong>
              <br />
              <span className="mp-small mp-muted">
                {thread.transferReference === null ? '' : `${thread.transferReference} · `}
                {new Date(thread.updatedAt).toLocaleString()}
              </span>
            </span>
            <span
              className={`mp-badge ${
                thread.status === 'ANSWERED'
                  ? 'mp-badge--progress'
                  : thread.status === 'RESOLVED'
                    ? 'mp-badge--success'
                    : 'mp-badge--warning'
              }`}
            >
              {t(`support.status.${thread.status}` as never)}
            </span>
          </button>

          {openId === thread.id ? (
            <div className="mp-stack mp-stack--tight">
              {thread.messages.map((message) => (
                <div
                  key={message.id}
                  className="mp-card mp-card--flat"
                  style={{
                    background:
                      message.authorType === 'STAFF' ? 'var(--surface-sunken)' : undefined,
                  }}
                >
                  <div className="mp-small mp-muted">
                    {message.authorType === 'USER' ? t('support.you') : message.authorLabel} ·{' '}
                    {new Date(message.createdAt).toLocaleString()}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{message.body}</div>
                </div>
              ))}

              <Field label={t('support.reply')}>
                <textarea
                  className="mp-input"
                  rows={3}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
              </Field>
              <button
                className="mp-button mp-button--secondary mp-button--block"
                disabled={busy || reply.trim() === ''}
                onClick={() => void sendReply(thread.id)}
              >
                {t('support.send')}
              </button>
            </div>
          ) : null}
        </section>
      ))}

      <section className="mp-card mp-stack">
        <h2 className="mp-card__title">{t('support.new')}</h2>
        <Field label={t('support.subject')}>
          <input
            className="mp-input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>
        <Field label={t('support.message')} hint={t('support.noSecrets')}>
          <textarea
            className="mp-input"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <button
          className="mp-button mp-button--primary mp-button--block"
          disabled={busy || subject.trim().length < 3 || body.trim() === ''}
          onClick={open}
        >
          {t('support.open')}
        </button>
      </section>
    </div>
  );
}

export default function SupportPage() {
  return (
    <AppShell>
      <RequireAuth>
        <SupportInner />
      </RequireAuth>
    </AppShell>
  );
}
