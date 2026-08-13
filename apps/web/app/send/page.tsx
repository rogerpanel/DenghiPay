'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/app/providers';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { AppShell, ErrorNotice, Field, MoneyDto, RequireAuth } from '@/components/shell';
import type { TranslationKey } from '@/lib/i18n';

/* ------------------------------------------------------------------ types */

interface Corridor {
  id: string;
  sourceCountry: string;
  sourceCurrency: string;
  destinationCountry: string;
  destinationCurrency: string;
  payinMethods: string[];
  payoutMethods: string[];
  minSend: MoneyDto;
  maxSend: MoneyDto;
  fixedFee: MoneyDto;
  fxMarginBps: number;
  enabled: boolean;
  open: boolean;
}

interface Quote {
  id: string;
  sendAmount: MoneyDto;
  fixedFee: MoneyDto;
  fxMargin: MoneyDto;
  totalToPay: MoneyDto;
  totalCost: MoneyDto;
  recipientAmount: MoneyDto;
  recipientAmountAtMid: MoneyDto;
  midRate: string;
  effectiveRate: string;
  fxMarginBps: number;
  expiresAt: string;
  expiresInSeconds: number;
}

interface Recipient {
  id: string;
  method: string;
  country: string;
  maskedAccount: string;
  resolvedName: string | null;
  nickname: string | null;
}

interface Institutions {
  banks: Array<{ code: string; name: string }>;
  networks: Array<{ code: string; name: string }>;
}

type NameEnquiry =
  | { status: 'RESOLVED'; resolvedName: string; institution: string; matchesDeclaredName: boolean }
  | { status: 'NOT_FOUND'; reason: string }
  | { status: 'UNSUPPORTED'; reason: string };

const PURPOSES = ['FAMILY_SUPPORT', 'EDUCATION', 'MEDICAL', 'GIFT', 'OWN_ACCOUNT'] as const;

/* ------------------------------------------------------------------- page */

function SendFlow() {
  const { t, account } = useApp();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [corridors, setCorridors] = useState<Corridor[]>([]);
  const [corridorId, setCorridorId] = useState('RU-NG');
  const [amountText, setAmountText] = useState('100000');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [institutions, setInstitutions] = useState<Institutions>({ banks: [], networks: [] });
  const [selectedRecipient, setSelectedRecipient] = useState<Recipient | null>(null);

  const [newAccount, setNewAccount] = useState('');
  const [newBankCode, setNewBankCode] = useState('058');
  const [newMsisdn, setNewMsisdn] = useState('');
  const [newNetwork, setNewNetwork] = useState('MTN');
  const [newName, setNewName] = useState('');
  const [enquiry, setEnquiry] = useState<NameEnquiry | null>(null);

  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]>('FAMILY_SUPPORT');
  const [payinMethod, setPayinMethod] = useState('SBP');
  const [idempotencyKey] = useState(newIdempotencyKey);

  const corridor = useMemo(
    () => corridors.find((c) => c.id === corridorId) ?? null,
    [corridors, corridorId],
  );
  const destinationIsGhana = corridor?.destinationCountry === 'GH';

  useEffect(() => {
    void (async () => {
      const [corridorList, recipientList, institutionList] = await Promise.all([
        api<{ corridors: Corridor[] }>('/corridors'),
        api<{ recipients: Recipient[] }>('/recipients'),
        api<Institutions>('/institutions'),
      ]);
      setCorridors(corridorList.corridors.filter((c) => c.enabled));
      setRecipients(recipientList.recipients);
      setInstitutions(institutionList);
    })().catch(() => setError(t('error.generic')));
  }, [t]);

  /* The quote countdown. A quote is a promise with an expiry, and the sender
     can see it tick — better than discovering it expired on submit. */
  useEffect(() => {
    if (quote === null) return;
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.round((new Date(quote.expiresAt).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [quote]);

  const requestQuote = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const minorUnits = toMinorUnits(amountText);
      const created = await api<Quote>('/quotes', {
        method: 'POST',
        body: { corridorId, sendMinorUnits: minorUnits },
      });
      setQuote(created);
    } catch (caught) {
      setQuote(null);
      setError(messageFor(caught, t));
    } finally {
      setBusy(false);
    }
  }, [amountText, corridorId, t]);

  async function runNameEnquiry() {
    setBusy(true);
    setError(null);
    setEnquiry(null);
    try {
      const details = destinationIsGhana
        ? {
            method: 'MOBILE_MONEY' as const,
            country: 'GH' as const,
            msisdn: newMsisdn,
            network: newNetwork as 'MTN' | 'TELECEL' | 'AIRTELTIGO',
            declaredName: newName,
          }
        : {
            method: 'BANK_ACCOUNT' as const,
            country: 'NG' as const,
            accountNumber: newAccount,
            bankCode: newBankCode,
            declaredName: newName,
          };
      const result = await api<NameEnquiry>('/recipients/name-enquiry', {
        method: 'POST',
        body: { details },
      });
      setEnquiry(result);
    } catch (caught) {
      setError(messageFor(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function saveRecipient() {
    if (enquiry === null || enquiry.status !== 'RESOLVED') return;
    setBusy(true);
    setError(null);
    try {
      const details = destinationIsGhana
        ? {
            method: 'MOBILE_MONEY' as const,
            country: 'GH' as const,
            msisdn: newMsisdn,
            network: newNetwork as 'MTN' | 'TELECEL' | 'AIRTELTIGO',
            declaredName: enquiry.resolvedName,
          }
        : {
            method: 'BANK_ACCOUNT' as const,
            country: 'NG' as const,
            accountNumber: newAccount,
            bankCode: newBankCode,
            declaredName: enquiry.resolvedName,
          };
      const saved = await api<Recipient>('/recipients', { method: 'POST', body: { details } });
      setRecipients((current) => [saved, ...current]);
      setSelectedRecipient(saved);
      setStep(2);
    } catch (caught) {
      setError(messageFor(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function confirmTransfer() {
    if (quote === null || selectedRecipient === null) return;
    setBusy(true);
    setError(null);
    try {
      const transfer = await api<{ id: string }>('/transfers', {
        method: 'POST',
        idempotencyKey,
        body: {
          quoteId: quote.id,
          recipientId: selectedRecipient.id,
          payinMethod,
          purpose,
          confirmedRecipientName: selectedRecipient.resolvedName ?? '',
        },
      });
      router.push(`/transfers/${transfer.id}`);
    } catch (caught) {
      setError(messageFor(caught, t));
      setBusy(false);
    }
  }

  if (account?.capabilities.canTransfer === false) {
    return (
      <div className="mp-stack">
        <div className="mp-notice mp-notice--warning">
          {account.emailVerified ? t('kyc.tier0Block') : t('auth.verify.body')}
        </div>
        <Link
          href={account.emailVerified ? '/kyc' : '/verify'}
          className="mp-button mp-button--primary mp-button--block"
        >
          {account.emailVerified ? t('kyc.title') : t('auth.verify.title')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mp-stack">
      <div className="mp-steps" aria-hidden>
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={`mp-steps__step${index <= step ? ' mp-steps__step--done' : ''}`}
          />
        ))}
      </div>

      <ErrorNotice message={error} />

      {step === 0 ? (
        <AmountStep
          corridors={corridors}
          corridorId={corridorId}
          setCorridorId={(id) => {
            setCorridorId(id);
            setQuote(null);
            setSelectedRecipient(null);
          }}
          amountText={amountText}
          setAmountText={(value) => {
            setAmountText(value);
            setQuote(null);
          }}
          quote={quote}
          secondsLeft={secondsLeft}
          busy={busy}
          onQuote={requestQuote}
          onNext={() => setStep(1)}
        />
      ) : null}

      {step === 1 ? (
        <RecipientStep
          destinationIsGhana={destinationIsGhana}
          recipients={recipients.filter((r) => r.country === corridor?.destinationCountry)}
          institutions={institutions}
          selected={selectedRecipient}
          onSelect={(recipient) => {
            setSelectedRecipient(recipient);
            setStep(2);
          }}
          newAccount={newAccount}
          setNewAccount={setNewAccount}
          newBankCode={newBankCode}
          setNewBankCode={setNewBankCode}
          newMsisdn={newMsisdn}
          setNewMsisdn={setNewMsisdn}
          newNetwork={newNetwork}
          setNewNetwork={setNewNetwork}
          newName={newName}
          setNewName={setNewName}
          enquiry={enquiry}
          busy={busy}
          onEnquire={runNameEnquiry}
          onConfirmName={saveRecipient}
          onBack={() => setStep(0)}
        />
      ) : null}

      {step === 2 && quote !== null && selectedRecipient !== null ? (
        <ReviewStep
          quote={quote}
          recipient={selectedRecipient}
          corridor={corridor}
          purpose={purpose}
          setPurpose={setPurpose}
          payinMethod={payinMethod}
          setPayinMethod={setPayinMethod}
          secondsLeft={secondsLeft}
          busy={busy}
          onBack={() => setStep(1)}
          onConfirm={confirmTransfer}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ step: amount */

function AmountStep(props: {
  corridors: Corridor[];
  corridorId: string;
  setCorridorId: (id: string) => void;
  amountText: string;
  setAmountText: (value: string) => void;
  quote: Quote | null;
  secondsLeft: number;
  busy: boolean;
  onQuote: () => void;
  onNext: () => void;
}) {
  const { t } = useApp();
  const corridor = props.corridors.find((c) => c.id === props.corridorId);
  const expired = props.quote !== null && props.secondsLeft <= 0;

  return (
    <div className="mp-stack">
      <h1>{t('send.amount.title')}</h1>

      <div className="mp-card mp-stack">
        <Field label={t('send.amount.corridor')}>
          <select
            className="mp-select"
            value={props.corridorId}
            onChange={(e) => props.setCorridorId(e.target.value)}
          >
            {props.corridors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.sourceCountry} → {c.destinationCountry} ({c.destinationCurrency})
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={t('send.amount.youSend')}
          hint={
            corridor === undefined
              ? undefined
              : `${corridor.minSend.formatted} – ${corridor.maxSend.formatted}`
          }
        >
          <input
            className="mp-input mp-input--amount"
            // decimal, not numeric: senders type kopeks.
            inputMode="decimal"
            value={props.amountText}
            onChange={(e) => props.setAmountText(e.target.value.replace(/[^\d.]/g, ''))}
            aria-label={t('send.amount.youSend')}
          />
        </Field>

        <button
          className="mp-button mp-button--secondary mp-button--block"
          onClick={props.onQuote}
          disabled={props.busy}
        >
          {props.quote === null ? t('action.continue') : t('send.amount.refreshQuote')}
        </button>
      </div>

      {props.quote !== null ? (
        <>
          <div className="mp-card mp-stack">
            <div className="mp-row">
              <span className="mp-muted mp-small">{t('send.amount.theyReceive')}</span>
              {expired ? null : (
                <span className="mp-badge mp-badge--progress mp-numeric">
                  {t('send.amount.quoteExpires', { seconds: props.secondsLeft })}
                </span>
              )}
            </div>
            <div className="mp-amount mp-amount--lg" style={{ color: 'var(--heading)' }}>
              {props.quote.recipientAmount.formatted}
            </div>
            {expired ? (
              <div className="mp-notice mp-notice--warning">{t('send.amount.expired')}</div>
            ) : null}
          </div>

          <QuoteBreakdown quote={props.quote} />

          <button
            className="mp-button mp-button--primary mp-button--block"
            onClick={props.onNext}
            disabled={expired}
          >
            {t('action.continue')}
          </button>
        </>
      ) : null}
    </div>
  );
}

/**
 * The fee breakdown.
 *
 * Technical Architecture open question 1 asked how much of the FX spread we
 * surface. This component is the answer in the product: the mid-market rate,
 * our rate, the margin in money and in basis points, and what the recipient
 * would have received with no margin at all. Nothing is hidden inside the rate.
 */
function QuoteBreakdown({ quote }: { quote: Quote }) {
  const { t } = useApp();
  return (
    <section className="mp-card">
      <h2 className="mp-card__title">{t('send.breakdown.title')}</h2>
      <div className="mp-breakdown mp-numeric">
        <div className="mp-breakdown__row">
          <span>{t('send.breakdown.sendAmount')}</span>
          <span>{quote.sendAmount.formatted}</span>
        </div>
        <div className="mp-breakdown__row">
          <span>{t('send.breakdown.fixedFee')}</span>
          <span>{quote.fixedFee.formatted}</span>
        </div>
        <div className="mp-breakdown__row">
          <span>
            {t('send.breakdown.fxMargin')} ({(quote.fxMarginBps / 100).toFixed(2)}%)
          </span>
          <span>{quote.fxMargin.formatted}</span>
        </div>
        <div className="mp-breakdown__row mp-breakdown__row--highlight">
          <span>{t('send.breakdown.totalCost')}</span>
          <span>{quote.totalCost.formatted}</span>
        </div>
        <div className="mp-breakdown__row">
          <span>{t('send.breakdown.midRate')}</span>
          <span>{quote.midRate}</span>
        </div>
        <div className="mp-breakdown__row">
          <span>{t('send.breakdown.ourRate')}</span>
          <span>{quote.effectiveRate}</span>
        </div>
        <div className="mp-breakdown__row">
          <span>{t('send.breakdown.atMid')}</span>
          <span>{quote.recipientAmountAtMid.formatted}</span>
        </div>
        <div className="mp-breakdown__row mp-breakdown__row--total">
          <span>{t('send.breakdown.totalToPay')}</span>
          <span>{quote.totalToPay.formatted}</span>
        </div>
      </div>
      <p className="mp-small mp-muted" style={{ marginBottom: 0, marginTop: 'var(--space-3)' }}>
        {t('send.breakdown.explain')}
      </p>
    </section>
  );
}

/* --------------------------------------------------------- step: recipient */

function RecipientStep(props: {
  destinationIsGhana: boolean;
  recipients: Recipient[];
  institutions: Institutions;
  selected: Recipient | null;
  onSelect: (recipient: Recipient) => void;
  newAccount: string;
  setNewAccount: (v: string) => void;
  newBankCode: string;
  setNewBankCode: (v: string) => void;
  newMsisdn: string;
  setNewMsisdn: (v: string) => void;
  newNetwork: string;
  setNewNetwork: (v: string) => void;
  newName: string;
  setNewName: (v: string) => void;
  enquiry: NameEnquiry | null;
  busy: boolean;
  onEnquire: () => void;
  onConfirmName: () => void;
  onBack: () => void;
}) {
  const { t } = useApp();

  return (
    <div className="mp-stack">
      <h1>{t('send.recipient.title')}</h1>

      {props.recipients.length > 0 ? (
        <section className="mp-card">
          <h2 className="mp-card__title">{t('send.recipient.saved')}</h2>
          <ul className="mp-list">
            {props.recipients.map((recipient) => (
              <li key={recipient.id}>
                <button
                  className="mp-list__item"
                  aria-pressed={props.selected?.id === recipient.id}
                  onClick={() => props.onSelect(recipient)}
                >
                  <span className="mp-avatar" aria-hidden>
                    {(recipient.resolvedName ?? '?').charAt(0)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{recipient.resolvedName ?? recipient.nickname}</strong>
                    <br />
                    <span className="mp-small mp-muted mp-numeric">
                      {recipient.nickname === null ? '' : `${recipient.nickname} · `}
                      {recipient.maskedAccount}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mp-card mp-stack">
        <h2 className="mp-card__title">{t('send.recipient.new')}</h2>

        {props.destinationIsGhana ? (
          <>
            <Field label={t('send.recipient.network')}>
              <select
                className="mp-select"
                value={props.newNetwork}
                onChange={(e) => props.setNewNetwork(e.target.value)}
              >
                {props.institutions.networks.map((network) => (
                  <option key={network.code} value={network.code}>
                    {network.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('send.recipient.msisdn')} hint="233XXXXXXXXX">
              <input
                className="mp-input mp-numeric"
                inputMode="numeric"
                value={props.newMsisdn}
                onChange={(e) => props.setNewMsisdn(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label={t('send.recipient.bank')}>
              <select
                className="mp-select"
                value={props.newBankCode}
                onChange={(e) => props.setNewBankCode(e.target.value)}
              >
                {props.institutions.banks.map((bank) => (
                  <option key={bank.code} value={bank.code}>
                    {bank.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('send.recipient.accountNumber')} hint="10 digits">
              <input
                className="mp-input mp-numeric"
                inputMode="numeric"
                maxLength={10}
                value={props.newAccount}
                onChange={(e) => props.setNewAccount(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </>
        )}

        <Field label={t('send.recipient.name')}>
          <input
            className="mp-input"
            autoComplete="off"
            value={props.newName}
            onChange={(e) => props.setNewName(e.target.value)}
          />
        </Field>

        <button
          className="mp-button mp-button--secondary mp-button--block"
          onClick={props.onEnquire}
          disabled={props.busy}
        >
          {props.busy ? t('send.recipient.checking') : t('send.recipient.check')}
        </button>

        {/* The name enquiry result. This is the single most valuable screen in
            the product: the sender sees the name the institution holds, before
            they commit, and money sent to the wrong account cannot be recovered. */}
        {props.enquiry?.status === 'RESOLVED' ? (
          <div className="mp-stack mp-stack--tight">
            <div className="mp-notice mp-notice--info">
              <div className="mp-small">
                {props.destinationIsGhana
                  ? t('send.recipient.resolvedMomo')
                  : t('send.recipient.resolved')}
              </div>
              <div
                style={{
                  fontSize: 'var(--text-xl)',
                  fontWeight: 700,
                  marginTop: 'var(--space-1)',
                }}
              >
                {props.enquiry.resolvedName}
              </div>
              <div className="mp-small">{props.enquiry.institution}</div>
            </div>

            {props.enquiry.matchesDeclaredName ? null : (
              <div className="mp-notice mp-notice--warning">{t('send.recipient.nameMismatch')}</div>
            )}

            <button
              className="mp-button mp-button--primary mp-button--block"
              onClick={props.onConfirmName}
              disabled={props.busy}
            >
              {t('send.recipient.confirmName')}
            </button>
          </div>
        ) : null}

        {props.enquiry !== null && props.enquiry.status !== 'RESOLVED' ? (
          <div className="mp-notice mp-notice--danger">{props.enquiry.reason}</div>
        ) : null}
      </section>

      <button className="mp-button mp-button--ghost mp-button--block" onClick={props.onBack}>
        {t('action.back')}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ step: review */

function ReviewStep(props: {
  quote: Quote;
  recipient: Recipient;
  corridor: Corridor | null;
  purpose: (typeof PURPOSES)[number];
  setPurpose: (value: (typeof PURPOSES)[number]) => void;
  payinMethod: string;
  setPayinMethod: (value: string) => void;
  secondsLeft: number;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { t } = useApp();
  const expired = props.secondsLeft <= 0;

  return (
    <div className="mp-stack">
      <h1>{t('send.review.title')}</h1>

      <section className="mp-card mp-stack mp-stack--tight">
        <div className="mp-row">
          <span className="mp-muted mp-small">{t('transfer.recipient')}</span>
          <strong>{props.recipient.resolvedName}</strong>
        </div>
        <div className="mp-row">
          <span className="mp-muted mp-small">{t('send.recipient.accountNumber')}</span>
          <span className="mp-numeric">{props.recipient.maskedAccount}</span>
        </div>
        <div className="mp-row">
          <span className="mp-muted mp-small">{t('send.amount.theyReceive')}</span>
          <strong className="mp-numeric">{props.quote.recipientAmount.formatted}</strong>
        </div>
      </section>

      <QuoteBreakdown quote={props.quote} />

      <section className="mp-card mp-stack">
        <Field label={t('send.review.purpose')}>
          <select
            className="mp-select"
            value={props.purpose}
            onChange={(e) => props.setPurpose(e.target.value as (typeof PURPOSES)[number])}
          >
            {PURPOSES.map((value) => (
              <option key={value} value={value}>
                {t(`purpose.${value}` as TranslationKey)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('send.review.payWith')}>
          <select
            className="mp-select"
            value={props.payinMethod}
            onChange={(e) => props.setPayinMethod(e.target.value)}
          >
            {(props.corridor?.payinMethods ?? ['SBP']).map((method) => (
              <option key={method} value={method}>
                {t(`payin.${method}` as TranslationKey)}
              </option>
            ))}
          </select>
        </Field>

        {/* Guardrail G2, stated where a sender will read it. */}
        <p className="mp-small mp-muted">{t('send.review.personalOnly')}</p>
      </section>

      {expired ? (
        <div className="mp-notice mp-notice--warning">{t('send.amount.expired')}</div>
      ) : null}

      <button
        className="mp-button mp-button--primary mp-button--block"
        onClick={props.onConfirm}
        disabled={props.busy || expired}
      >
        {t('send.review.commit')} · {props.quote.totalToPay.formatted}
      </button>

      <button className="mp-button mp-button--ghost mp-button--block" onClick={props.onBack}>
        {t('action.back')}
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- helpers */

/** "100000.50" → "10000050". Never goes through a float. */
function toMinorUnits(input: string): string {
  const [whole = '0', fraction = ''] = input.split('.');
  return `${whole || '0'}${fraction.padEnd(2, '0').slice(0, 2)}`.replace(/^0+(?=\d)/, '');
}

function messageFor(caught: unknown, t: (key: TranslationKey) => string): string {
  if (!(caught instanceof ApiError)) return t('error.generic');
  const specific = t(`error.${caught.code}` as TranslationKey);
  // A translated code beats the server's English sentence; the sentence beats
  // a raw code.
  return specific.startsWith('error.') ? caught.message : specific;
}

export default function SendPage() {
  return (
    <AppShell>
      <RequireAuth>
        <SendFlow />
      </RequireAuth>
    </AppShell>
  );
}
