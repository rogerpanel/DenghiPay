'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApp } from '@/app/providers';
import { ApiError, api } from '@/lib/api';
import { AppShell, ErrorNotice, LoadingCard, MoneyDto, RequireAuth } from '@/components/shell';
import type { TranslationKey } from '@/lib/i18n';

interface Receipt {
  reference: string;
  status: string;
  issuedAt: string;
  valueDate: string;
  completedAt: string | null;
  senderName: string | null;
  senderCountry: string;
  recipientName: string | null;
  recipientMasked: string;
  recipientCountry: string;
  recipientMethod: string;
  corridorId: string;
  purpose: string;
  sendAmount: MoneyDto;
  fee: MoneyDto;
  totalPaid: MoneyDto;
  recipientAmount: MoneyDto;
  midRate: string;
  effectiveRate: string;
  fxMarginBps: number;
  declaration: {
    regime: string;
    categoryCode: string;
    categoryLabel: string;
    allowanceYear: number;
  } | null;
}

/**
 * Proof of payment.
 *
 * Built to be printed. People forward these to landlords, universities and
 * immigration officers, so the page carries a print stylesheet that drops the
 * app furniture and leaves the document — rather than a "download PDF" button
 * that needs a rendering service to exist.
 */
function ReceiptInner() {
  const { t } = useApp();
  const params = useParams<{ id: string }>();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Receipt>(`/transfers/${params.id}/receipt`)
      .then(setReceipt)
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : t('error.generic'));
      });
  }, [params.id, t]);

  if (error !== null) return <ErrorNotice message={error} />;
  if (receipt === null) return <LoadingCard />;

  return (
    <div className="mp-stack">
      <style>{`
        @media print {
          .mp-header, .mp-nav, .mp-no-print { display: none !important; }
          .mp-main { padding: 0 !important; }
          .mp-card { border: none !important; box-shadow: none !important; }
        }
      `}</style>

      <div className="mp-row mp-no-print">
        <h1 style={{ margin: 0 }}>{t('receipt.title')}</h1>
        <button className="mp-button mp-button--secondary" onClick={() => window.print()}>
          {t('receipt.print')}
        </button>
      </div>

      <section className="mp-card mp-stack">
        <div className="mp-row">
          <div>
            <strong style={{ fontSize: 'var(--text-xl)' }}>MoraPay</strong>
            <br />
            <span className="mp-small mp-muted">{t('receipt.subtitle')}</span>
          </div>
          <span className="mp-badge mp-badge--progress">{receipt.status}</span>
        </div>

        <div className="mp-breakdown mp-numeric">
          <Row label={t('receipt.reference')} value={receipt.reference} />
          <Row
            label={t('receipt.valueDate')}
            value={new Date(receipt.valueDate).toLocaleString()}
          />
          {receipt.completedAt === null ? null : (
            <Row
              label={t('receipt.completedAt')}
              value={new Date(receipt.completedAt).toLocaleString()}
            />
          )}
          <Row label={t('receipt.sender')} value={receipt.senderName ?? '—'} />
          <Row label={t('receipt.from')} value={receipt.senderCountry} />
          <Row label={t('receipt.recipient')} value={receipt.recipientName ?? '—'} />
          <Row
            label={t('receipt.account')}
            value={`${receipt.recipientMasked} · ${receipt.recipientCountry}`}
          />
          <Row
            label={t('send.review.purpose')}
            value={t(`purpose.${receipt.purpose}` as TranslationKey)}
          />
        </div>
      </section>

      <section className="mp-card">
        <h2 className="mp-card__title">{t('send.breakdown.title')}</h2>
        <div className="mp-breakdown mp-numeric">
          <Row label={t('send.breakdown.sendAmount')} value={receipt.sendAmount.formatted} />
          <Row label={t('send.breakdown.fixedFee')} value={receipt.fee.formatted} />
          <Row label={t('send.breakdown.midRate')} value={receipt.midRate} />
          <Row
            label={`${t('send.breakdown.ourRate')} (${(receipt.fxMarginBps / 100).toFixed(2)}%)`}
            value={receipt.effectiveRate}
          />
          <div className="mp-breakdown__row mp-breakdown__row--highlight">
            <span>{t('send.breakdown.totalToPay')}</span>
            <span>{receipt.totalPaid.formatted}</span>
          </div>
          <div className="mp-breakdown__row mp-breakdown__row--total">
            <span>{t('send.amount.theyReceive')}</span>
            <span>{receipt.recipientAmount.formatted}</span>
          </div>
        </div>
      </section>

      {receipt.declaration === null ? null : (
        <section className="mp-card">
          <h2 className="mp-card__title">{t('send.declaration.title')}</h2>
          <div className="mp-breakdown mp-numeric">
            <Row
              label={t('send.declaration.category')}
              value={`${receipt.declaration.categoryCode} · ${receipt.declaration.categoryLabel}`}
            />
            <Row label={t('receipt.regime')} value={receipt.declaration.regime} />
            <Row
              label={t('send.declaration.allowance', { year: receipt.declaration.allowanceYear })}
              value={String(receipt.declaration.allowanceYear)}
            />
          </div>
        </section>
      )}

      <p className="mp-small mp-muted">
        {t('receipt.issued', { at: new Date(receipt.issuedAt).toLocaleString() })}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="mp-breakdown__row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function ReceiptPage() {
  return (
    <AppShell>
      <RequireAuth>
        <ReceiptInner />
      </RequireAuth>
    </AppShell>
  );
}
