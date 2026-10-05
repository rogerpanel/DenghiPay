'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/app/providers';
import { api } from '@/lib/api';
import { AppShell, LoadingCard, MoneyDto, RequireAuth, StatusBadge } from '@/components/shell';
import type { TranslationKey } from '@/lib/i18n';

interface PayinInstructions {
  kind: 'SBP' | 'QR' | 'VIRTUAL_ACCOUNT' | 'CARD' | 'MOBILE_MONEY';
  deepLink?: string;
  payload?: string;
  accountNumber?: string;
  bankName?: string;
  reference?: string;
  redirectUrl?: string;
  msisdn?: string;
  network?: string;
  ussdFallback?: string;
}

interface Transfer {
  id: string;
  reference: string;
  corridorId: string;
  purpose: string;
  recipientId?: string;
  state: string;
  senderStatus: string;
  sendAmount: MoneyDto;
  fee: MoneyDto;
  totalToPay: MoneyDto;
  recipientAmount: MoneyDto;
  recipient: { id: string; maskedAccount: string; resolvedName: string | null; country: string };
  payinMethod: string;
  payinInstructions: PayinInstructions | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
  timeline: Array<{ event: string; toState: string; senderStatus: string; at: string }>;
}

const TERMINAL = ['completed', 'refunded', 'failed'];

function TransferDetail({ id }: { id: string }) {
  const { t } = useApp();
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [simulating, setSimulating] = useState(false);

  const load = useCallback(async () => {
    const result = await api<Transfer>(`/transfers/${id}`);
    setTransfer(result);
    return result;
  }, [id]);

  /* Poll while the transfer is in flight. The states a sender sees change
     without them doing anything, so the screen has to keep up. */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const run = async () => {
      try {
        const result = await load();
        if (cancelled) return;
        if (!TERMINAL.includes(result.senderStatus)) {
          timer = setTimeout(run, 2500);
        }
      } catch {
        if (!cancelled) timer = setTimeout(run, 5000);
      }
    };

    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load]);

  async function simulatePayment() {
    if (transfer === null) return;
    setSimulating(true);
    try {
      await api(`/simulator/payin/${transfer.reference}/pay`, { method: 'POST' });
      await load();
    } finally {
      setSimulating(false);
    }
  }

  if (transfer === null) return <LoadingCard />;

  const awaitingPayment = transfer.senderStatus === 'awaiting_your_payment';
  const helpKey = `status.help.${transfer.senderStatus}` as TranslationKey;
  const help = t(helpKey);

  return (
    <div className="mp-stack">
      <div className="mp-row">
        <div>
          <h1 style={{ marginBottom: 4 }}>{transfer.recipient.resolvedName}</h1>
          <span className="mp-small mp-muted mp-numeric">
            {t('transfer.reference')} {transfer.reference}
          </span>
        </div>
        <StatusBadge status={transfer.senderStatus} />
      </div>

      <section className="mp-card mp-stack mp-stack--tight">
        <div className="mp-row">
          <span className="mp-muted mp-small">{t('transfer.sent')}</span>
          <span className="mp-amount mp-numeric">{transfer.sendAmount.formatted}</span>
        </div>
        <div className="mp-row">
          <span className="mp-muted mp-small">{t('send.breakdown.fixedFee')}</span>
          <span className="mp-numeric">{transfer.fee.formatted}</span>
        </div>
        <div className="mp-row">
          <span className="mp-muted mp-small">{t('transfer.received')}</span>
          <span className="mp-amount mp-numeric" style={{ color: 'var(--heading)' }}>
            {transfer.recipientAmount.formatted}
          </span>
        </div>
        <div className="mp-row">
          <span className="mp-muted mp-small">{t('transfer.recipient')}</span>
          <span className="mp-numeric">{transfer.recipient.maskedAccount}</span>
        </div>
      </section>

      {help === helpKey ? null : <div className="mp-notice mp-notice--info">{help}</div>}

      {transfer.failureReason === null ? null : (
        <div className="mp-notice mp-notice--danger">{transfer.failureReason}</div>
      )}

      {awaitingPayment && transfer.payinInstructions !== null ? (
        <PayinCard
          instructions={transfer.payinInstructions}
          onSimulate={simulatePayment}
          simulating={simulating}
        />
      ) : null}

      <section className="mp-card">
        <h2 className="mp-card__title">{t('transfer.timeline')}</h2>
        <ol className="mp-timeline">
          {transfer.timeline.map((event, index) => {
            const isLast = index === transfer.timeline.length - 1;
            return (
              <li className="mp-timeline__item" key={`${event.event}-${event.at}`}>
                <span
                  className={`mp-timeline__dot ${
                    isLast ? 'mp-timeline__dot--current' : 'mp-timeline__dot--done'
                  }`}
                  aria-hidden
                />
                <span>
                  <strong>{t(`status.${event.senderStatus}` as TranslationKey)}</strong>
                  <br />
                  <span className="mp-small mp-muted">{new Date(event.at).toLocaleString()}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {/* A finished transfer has two things a sender wants next: the paperwork,
          and the same payment again next month. Send-again is prefill only —
          the send flow re-quotes, re-screens and re-checks limits exactly as it
          does for a transfer started from scratch. */}
      {transfer.state === 'COMPLETED' || transfer.state === 'REFUNDED' ? (
        <>
          <Link
            href={`/transfers/${transfer.id}/receipt`}
            className="mp-button mp-button--secondary mp-button--block"
          >
            {t('receipt.view')}
          </Link>
          {transfer.state === 'COMPLETED' ? (
            <Link
              href={
                `/send?corridorId=${encodeURIComponent(transfer.corridorId)}` +
                `&recipientId=${encodeURIComponent(transfer.recipient.id)}` +
                `&amount=${encodeURIComponent(transfer.sendAmount.amount)}` +
                `&purpose=${encodeURIComponent(transfer.purpose)}`
              }
              className="mp-button mp-button--primary mp-button--block"
            >
              {t('transfer.sendAgain')}
            </Link>
          ) : null}
        </>
      ) : null}

      <Link href="/transfers" className="mp-button mp-button--ghost mp-button--block">
        {t('nav.transfers')}
      </Link>
    </div>
  );
}

function PayinCard({
  instructions,
  onSimulate,
  simulating,
}: {
  instructions: PayinInstructions;
  onSimulate: () => void;
  simulating: boolean;
}) {
  const { t } = useApp();
  const [copied, setCopied] = useState(false);

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="mp-card mp-stack">
      <h2 className="mp-card__title">{t('send.pay.title')}</h2>

      {instructions.kind === 'SBP' && instructions.deepLink !== undefined ? (
        <>
          <p className="mp-small">{t('send.pay.sbp')}</p>
          <a
            className="mp-button mp-button--primary mp-button--block"
            href={instructions.deepLink}
            target="_blank"
            rel="noreferrer"
          >
            {t('send.pay.openBank')}
          </a>
        </>
      ) : null}

      {instructions.kind === 'QR' && instructions.payload !== undefined ? (
        <>
          <p className="mp-small">{t('send.pay.qr')}</p>
          <code
            className="mp-small"
            style={{ wordBreak: 'break-all', background: 'var(--surface-sunken)', padding: 8 }}
          >
            {instructions.payload}
          </code>
        </>
      ) : null}

      {instructions.kind === 'VIRTUAL_ACCOUNT' ? (
        <>
          <p className="mp-small">{t('send.pay.account')}</p>
          <div className="mp-breakdown mp-numeric">
            <div className="mp-breakdown__row">
              <span>{instructions.bankName}</span>
              <strong>{instructions.accountNumber}</strong>
            </div>
            <div className="mp-breakdown__row">
              <span>{t('send.pay.reference')}</span>
              <strong>{instructions.reference}</strong>
            </div>
          </div>
          <button
            className="mp-button mp-button--secondary mp-button--block"
            onClick={() => copy(instructions.reference ?? '')}
          >
            {copied ? t('action.copied') : t('action.copy')}
          </button>
        </>
      ) : null}

      {/* Ghana collects by debiting the sender's own wallet, so there is
          nothing for them to go and do except answer the prompt. The wallet is
          shown because a sender should be able to see which one is about to be
          debited, and the short code because prompts get dropped. */}
      {instructions.kind === 'MOBILE_MONEY' ? (
        <>
          <p className="mp-small">{t('send.pay.momo')}</p>
          <div className="mp-breakdown mp-numeric">
            <div className="mp-breakdown__row">
              <span>{t('send.pay.momoWallet')}</span>
              <strong>
                {instructions.network} {instructions.msisdn}
              </strong>
            </div>
            <div className="mp-breakdown__row">
              <span>{t('send.pay.momoFallback')}</span>
              <strong>{instructions.ussdFallback}</strong>
            </div>
          </div>
        </>
      ) : null}

      <p className="mp-small mp-muted">{t('send.pay.waiting')}</p>

      {/* Demonstration only. The API refuses this endpoint entirely when
          LIVE_FUNDS_ENABLED is true. */}
      <button
        className="mp-button mp-button--secondary mp-button--block"
        onClick={onSimulate}
        disabled={simulating}
      >
        {t('send.pay.simulate')}
      </button>
    </section>
  );
}

export default function TransferPage() {
  const params = useParams<{ id: string }>();
  return (
    <AppShell>
      <RequireAuth>
        <TransferDetail id={params.id} />
      </RequireAuth>
    </AppShell>
  );
}
