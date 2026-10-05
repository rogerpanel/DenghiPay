'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAdmin } from '@/app/providers';

const CONSOLES = [
  { href: '/compliance', label: 'Compliance', roles: ['COMPLIANCE_OFFICER', 'SUPPORT', 'ADMIN'] },
  {
    href: '/operations',
    label: 'Operations',
    roles: ['SUPPORT', 'COMPLIANCE_OFFICER', 'ADMIN', 'TREASURY_OPERATOR'],
  },
  {
    href: '/support',
    label: 'Support',
    roles: ['SUPPORT', 'COMPLIANCE_OFFICER', 'ADMIN'],
  },
  { href: '/treasury', label: 'Treasury', roles: ['TREASURY_OPERATOR', 'ADMIN'] },
  // Compliance only, matching the API. The extract joins a name to a national
  // identity number, and the segregation that keeps an administrator out of
  // compliance decisions keeps them out of compliance data too.
  { href: '/exchange-control', label: 'Exchange control', roles: ['COMPLIANCE_OFFICER'] },
  {
    href: '/reports',
    label: 'Reporting',
    roles: ['ADMIN', 'COMPLIANCE_OFFICER', 'TREASURY_OPERATOR'],
  },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { staff, signOut, can } = useAdmin();
  const pathname = usePathname();

  return (
    <div className="mp-app">
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
        Back office · demonstration environment · no real money moves
      </div>

      <header className="mp-header">
        <div className="mp-header__inner mp-header__inner--wide" style={{ flexWrap: 'wrap' }}>
          <Link href="/compliance" className="mp-logo">
            <span className="mp-logo__mark" aria-hidden>
              M
            </span>
            MoraPay
          </Link>

          <nav style={{ display: 'flex', gap: 'var(--space-1)', flex: 1, flexWrap: 'wrap' }}>
            {CONSOLES.filter((item) => can(...item.roles)).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`mp-button ${
                  pathname.startsWith(item.href) ? 'mp-button--secondary' : 'mp-button--ghost'
                }`}
                style={{ minHeight: 36, padding: '0 14px', fontSize: 'var(--text-sm)' }}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {staff === null ? null : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span className="mp-small mp-muted">
                {staff.displayName} · {staff.roles.join(', ')}
              </span>
              <button
                className="mp-button mp-button--ghost"
                style={{ minHeight: 36, padding: '0 12px' }}
                onClick={signOut}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mp-main mp-main--wide">{children}</main>
    </div>
  );
}

export function RequireStaff({ children }: { children: React.ReactNode }) {
  const { staff, loading } = useAdmin();
  const router = useRouter();

  useEffect(() => {
    if (!loading && staff === null) router.replace('/login');
  }, [loading, staff, router]);

  if (loading) {
    return (
      <div className="mp-card" aria-busy="true">
        <div className="mp-skeleton" style={{ width: '40%' }} />
      </div>
    );
  }
  if (staff === null) return null;
  return <>{children}</>;
}

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mp-card">
      <div className="mp-row" style={{ marginBottom: 'var(--space-3)' }}>
        <h2 className="mp-card__title" style={{ margin: 0 }}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mp-muted mp-small">{children}</p>;
}

export interface MoneyDto {
  amount: string;
  currency: string;
  minorUnits: string;
  formatted: string;
}
