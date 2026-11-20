'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useApp } from '@/app/providers';
import { api } from '@/lib/api';
import { AppShell, ErrorNotice, LoadingCard } from '@/components/shell';

/** What the API can offer when nothing is configured to deliver mail. */
interface Shortcut {
  available: boolean;
  link: string | null;
  reason: string | null;
}

function VerifyInner() {
  const { t, refreshAccount, account } = useApp();
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [shortcut, setShortcut] = useState<Shortcut | null>(null);

  /* On a deployment with no mail server the confirmation link has to come from
     somewhere, or a real person can never finish signing up. It is scoped to
     the signed-in caller — never the whole outbox, which would hand any visitor
     every pending user's token. */
  const loadShortcut = useCallback(async () => {
    try {
      setShortcut(await api<Shortcut>('/auth/verification-link'));
    } catch {
      setShortcut({ available: false, link: null, reason: null });
    }
  }, []);

  useEffect(() => {
    if (token === null) return;
    setState('working');
    void (async () => {
      try {
        await api<{ verified: true }>('/auth/verify-email', {
          method: 'POST',
          body: { token },
          authenticated: false,
        });
        await refreshAccount();
        setState('done');
      } catch {
        setError(t('error.generic'));
        setState('failed');
      }
    })();
  }, [token, refreshAccount, t]);

  // Only when the page is being used as "we sent you a link", not when it is
  // consuming one from the URL.
  useEffect(() => {
    if (token !== null) return;
    void loadShortcut();
  }, [token, loadShortcut]);

  /* Resending used to be fire-and-forget: no busy state, no confirmation, and a
     rejected promise nobody handled. From the outside that is indistinguishable
     from a button that does nothing, which is exactly what it looked like. */
  async function resend() {
    setBusy(true);
    setError(null);
    setResent(false);
    try {
      await api('/auth/resend-verification', { method: 'POST' });
      setResent(true);
      await loadShortcut();
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'working') return <LoadingCard />;

  if (state === 'done' || account?.emailVerified === true) {
    return (
      <div className="mp-stack">
        <div className="mp-card mp-stack">
          <h1>{t('auth.verify.title')}</h1>
          <div className="mp-notice mp-notice--info">{t('auth.verify.success')}</div>
          <Link href="/send" className="mp-button mp-button--primary mp-button--block">
            {t('action.sendMoney')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mp-stack">
      <div className="mp-card mp-stack">
        <h1>{t('auth.verify.title')}</h1>
        <ErrorNotice message={error} />
        {/* Only claim to have emailed them when something actually did. */}
        <p className="mp-muted">
          {shortcut?.available === true ? t('auth.verify.bodyNoMail') : t('auth.verify.body')}
        </p>
        {resent ? <div className="mp-notice mp-notice--info">{t('auth.verify.resent')}</div> : null}
        <button
          className="mp-button mp-button--secondary mp-button--block"
          onClick={resend}
          disabled={busy}
        >
          {busy ? t('auth.verify.resending') : t('auth.verify.resend')}
        </button>

        {shortcut?.available === true && shortcut.link !== null ? (
          <>
            <a
              className="mp-button mp-button--primary mp-button--block"
              href={shortcut.link}
              rel="noreferrer"
            >
              {t('auth.verify.openLink')}
            </a>
            <p className="mp-small mp-muted">{t('auth.verify.noMailServer')}</p>
          </>
        ) : shortcut?.reason === null ? null : (
          <p className="mp-small mp-muted">{shortcut?.reason}</p>
        )}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <AppShell showNav={false}>
      <Suspense fallback={<LoadingCard />}>
        <VerifyInner />
      </Suspense>
    </AppShell>
  );
}
