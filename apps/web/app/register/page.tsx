'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { useApp } from '@/app/providers';
import { ApiError, api, setSession } from '@/lib/api';
import { AppShell, ErrorNotice, Field } from '@/components/shell';

/**
 * Where the sender lives. It decides which country holds their personal data
 * and which corridors they can send on, and it is asked once — moving it later
 * means moving rows between jurisdictions.
 *
 * South Africa is absent on purpose. It is a destination and not an origin
 * until SARB exchange-control reporting exists, so there is no store for a
 * South African sender's data and the API refuses the residency outright.
 */
type Residency = 'RU' | 'BY' | 'NG' | 'GH' | 'CM' | 'BJ';

interface SessionResponse {
  accessToken: string;
  refreshToken: string;
}

export default function RegisterPage() {
  const { t, locale, refreshAccount } = useApp();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [residency, setResidency] = useState<Residency>('RU');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api<SessionResponse>('/auth/register', {
        method: 'POST',
        body: { email, password, locale, residencyCountry: residency, acceptedTerms: true },
        authenticated: false,
      });
      setSession(session);
      await refreshAccount();
      router.push('/verify');
    } catch (caught) {
      if (caught instanceof ApiError && caught.body.issues !== undefined) {
        setError(caught.body.issues.map((issue) => issue.message).join('. '));
      } else {
        setError(caught instanceof ApiError ? caught.message : t('error.generic'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell showNav={false}>
      <div className="mp-stack">
        <h1>{t('auth.signUp.title')}</h1>

        <form className="mp-card mp-stack" onSubmit={submit}>
          <ErrorNotice message={error} />

          <Field label={t('auth.email')}>
            <input
              className="mp-input"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label={t('auth.password')} hint={t('auth.passwordHint')}>
            <input
              className="mp-input"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {/* Residency decides which partition holds this person's data — see
              BUILD_PLAN 12.1. It is asked once, at registration, because moving
              it later means moving rows between jurisdictions. */}
          <Field label={t('send.recipient.country')}>
            <select
              className="mp-select"
              value={residency}
              onChange={(e) => setResidency(e.target.value as Residency)}
            >
              <option value="RU">Россия / Russia</option>
              <option value="BY">Беларусь / Belarus</option>
              <option value="NG">Nigeria</option>
              <option value="GH">Ghana</option>
              <option value="CM">Cameroun / Cameroon</option>
              <option value="BJ">Bénin / Benin</option>
            </select>
          </Field>

          <label
            className="mp-small"
            style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}
          >
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              required
              style={{ width: 20, height: 20, marginTop: 2, flex: 'none' }}
            />
            {t('auth.terms')}
          </label>

          <button
            className="mp-button mp-button--primary mp-button--block"
            disabled={busy || !accepted}
          >
            {t('action.signUp')}
          </button>
        </form>

        <p className="mp-center mp-small">
          {t('auth.haveAccount')} <Link href="/login">{t('action.signIn')}</Link>
        </p>
      </div>
    </AppShell>
  );
}
