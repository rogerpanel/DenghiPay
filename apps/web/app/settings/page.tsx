'use client';

import Link from 'next/link';
import { useApp } from '@/app/providers';
import { AppShell, RequireAuth } from '@/components/shell';
import { LOCALES, LOCALE_NAMES } from '@/lib/i18n';

function SettingsInner() {
  const { t, locale, setLocale, account, signOut } = useApp();

  return (
    <div className="mp-stack">
      <h1>{t('settings.title')}</h1>

      <section className="mp-card mp-stack">
        <h2 className="mp-card__title">{t('settings.language')}</h2>
        <div className="mp-stack mp-stack--tight">
          {LOCALES.map((option) => (
            <button
              key={option}
              className="mp-list__item"
              aria-pressed={locale === option}
              onClick={() => setLocale(option)}
            >
              <span style={{ flex: 1 }}>{LOCALE_NAMES[option]}</span>
              {locale === option ? <span aria-hidden>✓</span> : null}
            </button>
          ))}
        </div>
        {/* BUILD_PLAN 10.6: the table structure already supports Hausa, Yoruba,
            Igbo and Twi — adding one is a dictionary file, not a refactor. */}
      </section>

      <section className="mp-card mp-stack mp-stack--tight">
        <h2 className="mp-card__title">{t('settings.account')}</h2>
        <div className="mp-row">
          <span className="mp-muted mp-small">{t('auth.email')}</span>
          <span>{account?.email}</span>
        </div>
        <div className="mp-row">
          <span className="mp-muted mp-small">{t('settings.verification')}</span>
          <span>{t('kyc.tier', { tier: account?.kycTier ?? 0 })}</span>
        </div>
        <Link href="/kyc" className="mp-button mp-button--secondary mp-button--block">
          {t('kyc.title')}
        </Link>
      </section>

      <section className="mp-card mp-stack">
        <h2 className="mp-card__title">{t('settings.manage')}</h2>
        <Link href="/schedules" className="mp-button mp-button--ghost mp-button--block">
          {t('schedules.title')}
        </Link>
        <Link href="/alerts" className="mp-button mp-button--ghost mp-button--block">
          {t('alerts.title')}
        </Link>
        <Link href="/support" className="mp-button mp-button--ghost mp-button--block">
          {t('support.title')}
        </Link>
      </section>

      <section className="mp-card">
        <h2 className="mp-card__title">{t('settings.install')}</h2>
        <p className="mp-small mp-muted">{t('settings.installHint')}</p>
      </section>

      <button className="mp-button mp-button--danger mp-button--block" onClick={signOut}>
        {t('action.signOut')}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AppShell>
      <RequireAuth>
        <SettingsInner />
      </RequireAuth>
    </AppShell>
  );
}
