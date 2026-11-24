'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/app/providers';
import type { TranslationKey } from '@/lib/i18n';

export function Logo() {
  return (
    <Link href="/home" className="mp-logo">
      <span className="mp-logo__mark" aria-hidden>
        M
      </span>
      MoraPay
    </Link>
  );
}

/**
 * The demonstration banner.
 *
 * Visible on every screen for as long as `LIVE_FUNDS_ENABLED` is false, which
 * is guardrail G1 made legible to whoever is looking at the screen. It
 * disappears on its own when the flag is flipped — nobody has to remember to
 * remove it.
 */
export function DemoBanner() {
  const { t } = useApp();
  return (
    <div
      style={{
        background: 'var(--brand-100)',
        color: 'var(--brand-900)',
        textAlign: 'center',
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        padding: '4px 8px',
      }}
    >
      {t('demo.banner')}
    </div>
  );
}

export function OfflineBanner() {
  const { t, online } = useApp();
  if (online) return null;
  return (
    <div className="mp-notice mp-notice--warning" style={{ borderRadius: 0 }}>
      {t('error.offline')}
    </div>
  );
}

export function AppShell({
  children,
  wide = false,
  showNav = true,
}: {
  children: React.ReactNode;
  wide?: boolean;
  showNav?: boolean;
}) {
  return (
    <div className="mp-app">
      <DemoBanner />
      <header className="mp-header">
        <div className={`mp-header__inner${wide ? ' mp-header__inner--wide' : ''}`}>
          <Logo />
          {showNav ? <NotificationBell /> : null}
        </div>
      </header>
      <OfflineBanner />
      <main className={`mp-main${wide ? ' mp-main--wide' : ''}`}>{children}</main>
      {showNav ? <BottomNav /> : null}
    </div>
  );
}

/**
 * The unread count, and a way into the list.
 *
 * Polled rather than pushed. A remittance app is opened deliberately, a few
 * times a month, so a socket held open for hours to deliver a handful of events
 * costs battery on exactly the low-end phones our senders carry.
 */
export function NotificationBell() {
  const { account } = useApp();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (account === null) return;
    try {
      const result = await api<{ unread: number }>('/notifications');
      setUnread(result.unread);
    } catch {
      // A failed count is not worth an error banner; the list will say so.
    }
  }, [account]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (account === null) return null;

  return (
    <Link
      href="/notifications"
      className="mp-button mp-button--ghost"
      style={{ minHeight: 40, padding: '0 12px', position: 'relative' }}
      aria-label={unread === 0 ? 'Notifications' : `Notifications, ${unread} unread`}
    >
      <span aria-hidden style={{ fontSize: 18 }}>
        ☰
      </span>
      {unread > 0 ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 2,
            right: 4,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            background: 'var(--danger, #c0392b)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            lineHeight: '18px',
            textAlign: 'center',
            padding: '0 4px',
          }}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </Link>
  );
}

const NAV: Array<{ href: string; key: TranslationKey; icon: string }> = [
  { href: '/home', key: 'nav.home', icon: '⌂' },
  { href: '/send', key: 'nav.send', icon: '↗' },
  { href: '/transfers', key: 'nav.transfers', icon: '≡' },
  { href: '/settings', key: 'nav.settings', icon: '⚙' },
];

export function BottomNav() {
  const pathname = usePathname();
  const { t } = useApp();
  return (
    <nav className="mp-nav" aria-label="Primary">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="mp-nav__item"
          aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
        >
          <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>
            {item.icon}
          </span>
          {t(item.key)}
        </Link>
      ))}
    </nav>
  );
}

/** Redirects to sign-in when there is no session. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { account, loading } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (!loading && account === null) router.replace('/login');
  }, [loading, account, router]);

  if (loading) return <LoadingCard />;
  if (account === null) return null;
  return <>{children}</>;
}

export function LoadingCard() {
  return (
    <div className="mp-card mp-stack" aria-busy="true">
      <div className="mp-skeleton" style={{ width: '60%' }} />
      <div className="mp-skeleton" style={{ width: '90%' }} />
      <div className="mp-skeleton" style={{ width: '40%' }} />
    </div>
  );
}

export function ErrorNotice({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <div className="mp-notice mp-notice--danger" role="alert">
      {message}
    </div>
  );
}

/** Maps a sender-facing status to the badge tone it deserves. */
export function StatusBadge({ status }: { status: string }) {
  const { t } = useApp();
  const tone =
    status === 'completed' || status === 'delivered'
      ? 'success'
      : status === 'failed'
        ? 'danger'
        : status === 'under_review' || status === 'refund_in_progress' || status === 'refunded'
          ? 'warning'
          : status === 'draft'
            ? 'neutral'
            : 'progress';

  return (
    <span className={`mp-badge mp-badge--${tone}`}>{t(`status.${status}` as TranslationKey)}</span>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="mp-field">
      <label className="mp-label">{label}</label>
      {children}
      {hint === undefined ? null : <span className="mp-hint">{hint}</span>}
      {error === undefined || error === null ? null : <span className="mp-error">{error}</span>}
    </div>
  );
}

export interface MoneyDto {
  amount: string;
  currency: string;
  minorUnits: string;
  formatted: string;
}

export function Money({ value, large = false }: { value: MoneyDto; large?: boolean }) {
  return <span className={`mp-amount${large ? ' mp-amount--lg' : ''}`}>{value.formatted}</span>;
}
