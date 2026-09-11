'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApp } from '@/app/providers';
import { api, corridorsPath } from '@/lib/api';
import { AppShell, LoadingCard, MoneyDto, RequireAuth, StatusBadge } from '@/components/shell';

interface TransferSummary {
  id: string;
  reference: string;
  senderStatus: string;
  sendAmount: MoneyDto;
  recipientAmount: MoneyDto;
  recipient: { resolvedName: string | null; maskedAccount: string; country: string };
  createdAt: string;
}

interface Corridor {
  id: string;
  sourceCountry: string;
  destinationCountry: string;
  destinationCurrency: string;
  fixedFee: MoneyDto;
  fxMarginBps: number;
  enabled: boolean;
  open: boolean;
}

const FLAGS: Record<string, string> = {
  RU: '🇷🇺',
  BY: '🇧🇾',
  NG: '🇳🇬',
  GH: '🇬🇭',
  ZA: '🇿🇦',
  CM: '🇨🇲',
  BJ: '🇧🇯',
};

function HomeInner() {
  const { t, account } = useApp();
  const residency = account?.residencyCountry ?? null;
  const [transfers, setTransfers] = useState<TransferSummary[] | null>(null);
  const [corridors, setCorridors] = useState<Corridor[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const [list, corridorList] = await Promise.all([
          api<{ transfers: TransferSummary[] }>('/transfers?limit=5'),
          api<{ corridors: Corridor[] }>(corridorsPath(residency)),
        ]);
        setTransfers(list.transfers);
        setCorridors(corridorList.corridors.filter((c) => c.enabled));
      } catch {
        setTransfers([]);
      }
    })();
  }, [residency]);

  return (
    <div className="mp-stack">
      {/* The verification and tier gates are surfaced here rather than
          discovered at the moment of sending, when a sender has already
          entered an amount and picked a recipient. */}
      {account?.emailVerified === false ? (
        <div className="mp-notice mp-notice--warning">
          {t('auth.verify.body')} <Link href="/verify">{t('auth.verify.title')}</Link>
        </div>
      ) : null}

      {account?.capabilities.canTransfer === false && account.emailVerified ? (
        <div className="mp-notice mp-notice--warning">
          {t('kyc.tier0Block')} <Link href="/kyc">{t('kyc.title')}</Link>
        </div>
      ) : null}

      <Link href="/send" className="mp-button mp-button--primary mp-button--block">
        {t('action.sendMoney')}
      </Link>

      <section className="mp-card">
        <h2 className="mp-card__title">{t('home.corridors')}</h2>
        <ul className="mp-list">
          {corridors.map((corridor) => (
            <li key={corridor.id} className="mp-list__item" style={{ cursor: 'default' }}>
              <span className="mp-avatar" aria-hidden>
                {FLAGS[corridor.destinationCountry] ?? '•'}
              </span>
              <span style={{ flex: 1 }}>
                <strong>
                  {FLAGS[corridor.sourceCountry]} {corridor.sourceCountry} →{' '}
                  {corridor.destinationCountry}
                </strong>
                <br />
                <span className="mp-small mp-muted">
                  {t('send.breakdown.fixedFee')} {corridor.fixedFee.formatted} ·{' '}
                  {t('send.breakdown.fxMargin')} {(corridor.fxMarginBps / 100).toFixed(2)}%
                </span>
              </span>
              {corridor.open ? null : <span className="mp-badge mp-badge--neutral">closed</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="mp-card">
        <h2 className="mp-card__title">{t('home.recent')}</h2>
        {transfers === null ? (
          <LoadingCard />
        ) : transfers.length === 0 ? (
          <p className="mp-muted mp-small">{t('home.empty')}</p>
        ) : (
          <ul className="mp-list">
            {transfers.map((transfer) => (
              <li key={transfer.id}>
                <Link href={`/transfers/${transfer.id}`} className="mp-list__item">
                  <span className="mp-avatar" aria-hidden>
                    {FLAGS[transfer.recipient.country] ?? '•'}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{transfer.recipient.resolvedName ?? transfer.reference}</strong>
                    <br />
                    <span className="mp-small mp-muted mp-numeric">
                      {transfer.sendAmount.formatted} → {transfer.recipientAmount.formatted}
                    </span>
                  </span>
                  <StatusBadge status={transfer.senderStatus} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function HomePage() {
  return (
    <AppShell>
      <RequireAuth>
        <HomeInner />
      </RequireAuth>
    </AppShell>
  );
}
