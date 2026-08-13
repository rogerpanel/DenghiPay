'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useApp } from '@/app/providers';
import { api } from '@/lib/api';
import { AppShell, ErrorNotice, LoadingCard } from '@/components/shell';

function VerifyInner() {
  const { t, refreshAccount, account } = useApp();
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);

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

  async function resend() {
    await api('/auth/resend-verification', { method: 'POST' });
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
        <p className="mp-muted">{t('auth.verify.body')}</p>
        <button className="mp-button mp-button--secondary mp-button--block" onClick={resend}>
          {t('auth.verify.resend')}
        </button>
        {/* In development the mail outbox stands in for a mailbox, so the link
            is one click away rather than requiring an SMTP server. */}
        <p className="mp-small mp-muted">
          Development: open the{' '}
          <a href="http://localhost:4000/simulator/outbox" target="_blank" rel="noreferrer">
            mail outbox
          </a>{' '}
          to find the link.
        </p>
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
