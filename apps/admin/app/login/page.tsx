'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { useAdmin } from '@/app/providers';
import { ApiError, StaffSession, api, setStaffSession } from '@/lib/api';

export default function AdminLoginPage() {
  const router = useRouter();
  const { refreshStaff } = useAdmin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api<StaffSession>('/admin/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setStaffSession(session);
      await refreshStaff();
      router.push('/compliance');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mp-app">
      <main className="mp-main" style={{ paddingTop: 'var(--space-8)' }}>
        <div className="mp-stack">
          <div className="mp-center">
            <span className="mp-logo">
              <span className="mp-logo__mark" aria-hidden>
                M
              </span>
              MoraPay
            </span>
            <p className="mp-muted mp-small">Back office</p>
          </div>

          <form className="mp-card mp-stack" onSubmit={submit}>
            {error === null ? null : (
              <div className="mp-notice mp-notice--danger" role="alert">
                {error}
              </div>
            )}

            <div className="mp-field">
              <label className="mp-label">Email</label>
              <input
                className="mp-input"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="mp-field">
              <label className="mp-label">Password</label>
              <input
                className="mp-input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button className="mp-button mp-button--primary mp-button--block" disabled={busy}>
              Sign in
            </button>
          </form>

          {/* Development credentials, printed by `pnpm seed`. This block is for
              a local demonstration; production has no such hint. */}
          <div className="mp-card mp-card--flat mp-small mp-muted">
            <strong>Development accounts</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              <li>compliance@morapay.local — compliance queue</li>
              <li>treasury@morapay.local — requests prefunding</li>
              <li>treasury2@morapay.local — approves it (four-eyes)</li>
              <li>support@morapay.local — operations</li>
              <li>admin@morapay.local — reporting and audit</li>
            </ul>
            <p style={{ marginBottom: 0 }}>Password: morapay-local-staff-2026</p>
          </div>
        </div>
      </main>
    </div>
  );
}
