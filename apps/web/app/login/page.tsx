'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { useApp } from '@/app/providers';
import { ApiError, api, setSession } from '@/lib/api';
import { AppShell, ErrorNotice, Field } from '@/components/shell';
import type { TranslationKey } from '@/lib/i18n';

interface SessionResponse {
  accessToken: string;
  refreshToken: string;
}

export default function LoginPage() {
  const { t, refreshAccount } = useApp();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api<SessionResponse>('/auth/login', {
        method: 'POST',
        body: { email, password },
        authenticated: false,
      });
      setSession(session);
      await refreshAccount();
      router.push('/home');
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : 'generic';
      setError(t(`error.${code}` as TranslationKey) ?? t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell showNav={false}>
      <div className="mp-stack">
        <div>
          <h1>{t('auth.signIn.title')}</h1>
          <p className="mp-muted">{t('app.tagline')}</p>
        </div>

        <form className="mp-card mp-stack" onSubmit={submit}>
          <ErrorNotice message={error} />

          <Field label={t('auth.email')}>
            <input
              className="mp-input"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label={t('auth.password')}>
            <input
              className="mp-input"
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          <button className="mp-button mp-button--primary mp-button--block" disabled={busy}>
            {t('action.signIn')}
          </button>
        </form>

        <p className="mp-center mp-small">
          {t('auth.noAccount')} <Link href="/register">{t('action.signUp')}</Link>
        </p>

        <p className="mp-small mp-muted mp-center">{t('compliance.note')}</p>
      </div>
    </AppShell>
  );
}
