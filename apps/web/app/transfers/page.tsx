'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApp } from '@/app/providers';
import { api } from '@/lib/api';
import { AppShell, LoadingCard, MoneyDto, RequireAuth, StatusBadge } from '@/components/shell';

interface TransferSummary {
  id: string;
  reference: string;
  senderStatus: string;
  sendAmount: MoneyDto;
  recipientAmount: MoneyDto;
  recipient: { resolvedName: string | null; maskedAccount: string };
  createdAt: string;
}

function TransfersList() {
  const { t } = useApp();
  const [transfers, setTransfers] = useState<TransferSummary[] | null>(null);

  useEffect(() => {
    void api<{ transfers: TransferSummary[] }>('/transfers?limit=50')
      .then((result) => setTransfers(result.transfers))
      .catch(() => setTransfers([]));
  }, []);

  if (transfers === null) return <LoadingCard />;

  return (
    <div className="mp-stack">
      <h1>{t('nav.transfers')}</h1>
      {transfers.length === 0 ? (
        <p className="mp-muted">{t('home.empty')}</p>
      ) : (
        <ul className="mp-list">
          {transfers.map((transfer) => (
            <li key={transfer.id}>
              <Link href={`/transfers/${transfer.id}`} className="mp-list__item">
                <span className="mp-avatar" aria-hidden>
                  {(transfer.recipient.resolvedName ?? '?').charAt(0)}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>{transfer.recipient.resolvedName ?? transfer.reference}</strong>
                  <br />
                  <span className="mp-small mp-muted mp-numeric">
                    {transfer.sendAmount.formatted} → {transfer.recipientAmount.formatted}
                  </span>
                  <br />
                  <span className="mp-small mp-muted">
                    {new Date(transfer.createdAt).toLocaleDateString()} · {transfer.reference}
                  </span>
                </span>
                <StatusBadge status={transfer.senderStatus} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TransfersPage() {
  return (
    <AppShell>
      <RequireAuth>
        <TransfersList />
      </RequireAuth>
    </AppShell>
  );
}
