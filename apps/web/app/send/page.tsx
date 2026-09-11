'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/app/providers';
import {
  ApiError,
  api,
  corridorsPath,
  lastCorridor,
  newIdempotencyKey,
  rememberCorridor,
} from '@/lib/api';
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

/** Mirrors `ExchangeControlInfo` in @morapay/contracts. */
interface ExchangeControl {
  required: boolean;
  regimeCountry: string | null;
  regimeCountryName: string | null;
  authority: string | null;
  reportedBy: string | null;
  categories: Array<{ code: string; label: string; allowance: string }>;
  allowanceYear: number | null;
  annualMinorUnits: string | null;
  remainingMinorUnits: string | null;
  usedThroughUsMinorUnits: string | null;
  declaredElsewhereMinorUnits: string | null;
  currency: string | null;
}

const NO_EXCHANGE_CONTROL: ExchangeControl = {
  required: false,
  regimeCountry: null,
  regimeCountryName: null,
  authority: null,
  reportedBy: null,
  categories: [],
  allowanceYear: null,
  annualMinorUnits: null,
  remainingMinorUnits: null,
  usedThroughUsMinorUnits: null,
  declaredElsewhereMinorUnits: null,
  currency: null,
};

const PURPOSES = ['FAMILY_SUPPORT', 'EDUCATION', 'MEDICAL', 'GIFT', 'OWN_ACCOUNT'] as const;

/* ------------------------------------------------------------------- page */

function SendFlow() {
  const { t, account } = useApp();
  const router = useRouter();
  /* "Send again" arrives here as query parameters. Prefill only: the corridor,
     the recipient and the amount are filled in, and then every check runs
     exactly as it would for a transfer typed from scratch — a fresh quote at
     today's rate, screening, and the limit check. Nothing is inherited from the
     transfer being repeated. */
  const params = useSearchParams();
  const repeatCorridorId = params.get('corridorId');
  const repeatRecipientId = params.get('recipientId');
  const repeatAmount = params.get('amount');

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [corridors, setCorridors] = useState<Corridor[]>([]);
  const [corridorId, setCorridorId] = useState(repeatCorridorId ?? 'RU-NG');
  const [amountText, setAmountText] = useState(repeatAmount ?? '100000');
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

  const [exchangeControl, setExchangeControl] = useState<ExchangeControl>(NO_EXCHANGE_CONTROL);
  const [categoryCode, setCategoryCode] = useState('');
  const [usedElsewhereText, setUsedElsewhereText] = useState('0');
  const [declarationAccepted, setDeclarationAccepted] = useState(false);

  const residency = account?.residencyCountry ?? null;
  const corridor = useMemo(
    () => corridors.find((c) => c.id === corridorId) ?? null,
    [corridors, corridorId],
  );
  /* Whether this destination is paid by wallet or by bank account.
     This used to ask `destinationCountry === 'GH'`, which was the same question
     while Ghana was the only wallet destination. With Cameroon and Benin also
     paying wallets and South Africa paying bank accounts, the country is the
     wrong thing to ask about — the corridor already states its payout methods. */
  const destinationPaysWallets = corridor?.payoutMethods.includes('MOBILE_MONEY') ?? false;
  const destinationCountry = corridor?.destinationCountry ?? null;
  /* How many decimals this origin's money has. The CFA francs have none, so a
     sender typing 200000 means two hundred thousand francs and not two
     thousand — a hundredfold error that still looks like a plausible number.
     Read off the corridor's own minimum rather than shipping a currency table
     to the browser: the server already formatted it to the right precision. */
  const sendDecimals = decimalsOf(corridor?.minSend.amount);

  useEffect(() => {
    void (async () => {
      const [corridorList, recipientList] = await Promise.all([
        api<{ corridors: Corridor[] }>(corridorsPath(residency)),
        api<{ recipients: Recipient[] }>('/recipients'),
      ]);
      // Only corridors that start where this sender lives. Someone in Lagos has
      // no way to hand over rubles, and offering RU→NG to them produces a quote
      // they can never pay. The server has already applied the residency filter;
      // `enabled` is still checked here because the catalogue is public and does
      // not promise to have excluded it.
      const usable = corridorList.corridors.filter((c) => c.enabled);
      setCorridors(usable);
      /* Functional form on purpose: reading `corridorId` here would make it a
         dependency, and this effect would then re-run — and re-fetch — every
         time the sender picked a different corridor.

         The fallback order matters. A repeat ("send again") wins, because the
         sender has just said what they want. Otherwise the corridor they last
         sent on, because remittance is overwhelmingly the same route month after
         month, and re-picking it out of fourteen is a tax on the common case.
         Only then the first in the list. */
      setCorridorId((current) => {
        if (usable.some((c) => c.id === current)) return current;
        const remembered = lastCorridor(account?.id ?? null);
        if (remembered !== null && usable.some((c) => c.id === remembered)) return remembered;
        return usable.length > 0 ? usable[0]!.id : current;
      });
      setRecipients(recipientList.recipients);

      // A repeat names its recipient, so the sender should not have to pick the
      // same person again. The quote is still theirs to request.
      if (repeatRecipientId !== null) {
        const repeat = recipientList.recipients.find((r) => r.id === repeatRecipientId);
        if (repeat !== undefined) setSelectedRecipient(repeat);
      }
    })().catch(() => setError(t('error.generic')));
  }, [t, residency, repeatRecipientId]);

  /* Institutions belong to a destination, so they are fetched when one is
     chosen rather than once at load. Offering every Nigerian bank to somebody
     adding a Beninese wallet is how a recipient ends up unreachable. */
  useEffect(() => {
    if (destinationCountry === null) return;
    void (async () => {
      const list = await api<Institutions>(`/institutions?country=${destinationCountry}`);
      setInstitutions(list);
      // Default to the first option this destination actually offers.
      if (list.banks[0] !== undefined) setNewBankCode(list.banks[0].code);
      if (list.networks[0] !== undefined) setNewNetwork(list.networks[0].code);
    })().catch(() => setError(t('error.generic')));
  }, [destinationCountry, t]);

  /* A corridor collects on the rails it has. When the sender changes corridor,
     the previously chosen method may not exist on the new one — SBP does not
     exist on NG→GH — so follow the corridor rather than leave a stale value
     that the API will reject at confirmation. */
  useEffect(() => {
    const methods = corridor?.payinMethods ?? [];
    if (methods.length > 0 && !methods.includes(payinMethod)) {
      setPayinMethod(methods[0]!);
    }
  }, [corridor, payinMethod]);

  /* Whether this corridor's origin has an exchange-control regime, and what is
     left of the sender's allowance under it.

     Asked per corridor because the answer is "no" almost everywhere: a Lagos
     sender gets `required: false` and never sees the step. Asked again on every
     corridor change because the regime belongs to where the money leaves from,
     not to where it lands. */
  useEffect(() => {
    if (corridorId === '') return;
    let current = true;
    void (async () => {
      const info = await api<ExchangeControl>(
        `/transfers/exchange-control?corridorId=${encodeURIComponent(corridorId)}`,
      );
      if (!current) return;
      setExchangeControl(info);
      // A declaration belongs to the corridor it was made on. Carrying a
      // category or an affirmation across a corridor change would file a
      // South African reason code against a payment that left Accra.
      setCategoryCode('');
      setDeclarationAccepted(false);
    })().catch(() => {
      // Failing closed: without an answer we cannot know a declaration is
      // unnecessary, and the API refuses an undeclared payment anyway. The
      // sender sees that refusal rather than a silent, wrong "not required".
      if (current) setExchangeControl(NO_EXCHANGE_CONTROL);
    });
    return () => {
      current = false;
    };
  }, [corridorId]);

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
      const minorUnits = toMinorUnits(amountText, sendDecimals);
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
  }, [amountText, corridorId, sendDecimals, t]);

  /*
   * Quote as soon as the sender stops typing, rather than making them ask.
   *
   * The amount step used to need two taps: one to fetch a quote and one to move
   * on. The first tap carried no decision — the sender had already said what
   * they wanted by typing it — so it was a round trip they waited for after
   * being made to ask for it.
   *
   * Four conditions, and each is here to avoid a pointless request rather than
   * out of caution:
   *
   *  - 400ms after the last keystroke, so typing "25000" is one quote and not
   *    five.
   *  - Only inside the corridor's own minimum and maximum. Below the minimum the
   *    server would refuse, and a validation error that appears while somebody
   *    is still typing the first digit reads as the app being broken.
   *  - Not while a quote for this exact amount already stands, so re-rendering
   *    does not re-quote.
   *  - Not while a request is in flight.
   *
   * Nothing is skipped by this. A quote is a price with a ninety-second lock,
   * not a commitment: screening, the limit check and the sender's explicit
   * confirmation all still happen afterwards, unchanged.
   */
  /* Held in a ref, not named as a dependency. `requestQuote` is rebuilt on every
     amount change, so depending on it would re-arm the timer on each render; the
     ref keeps the effect depending only on the values that should actually
     re-trigger a quote, while still calling the current function. */
  const requestQuoteRef = useRef(requestQuote);
  requestQuoteRef.current = requestQuote;

  const quotedAmount = quote?.sendAmount.minorUnits ?? null;
  useEffect(() => {
    if (corridor === null || busy) return;
    let minorUnits: bigint;
    try {
      minorUnits = BigInt(toMinorUnits(amountText, sendDecimals));
    } catch {
      return; // Not yet a number — the sender is mid-keystroke.
    }
    if (minorUnits <= 0n) return;
    if (minorUnits < BigInt(corridor.minSend.minorUnits)) return;
    if (minorUnits > BigInt(corridor.maxSend.minorUnits)) return;
    if (quotedAmount !== null && BigInt(quotedAmount) === minorUnits) return;

    const timer = setTimeout(() => void requestQuoteRef.current(), 400);
    return () => clearTimeout(timer);
  }, [amountText, corridor, sendDecimals, quotedAmount, busy]);

  /* The recipient the sender is describing, in the shape the API expects.
     Built in one place because the enquiry and the save must describe the same
     person — the confirmation step compares the name returned by the first
     against the name stored by the second, and a divergence here would read as
     a name mismatch. `declaredName` differs between the two calls: the sender's
     own spelling first, the institution's spelling once resolved. */
  function recipientDetails(declaredName: string = newName) {
    return destinationPaysWallets
      ? {
          method: 'MOBILE_MONEY' as const,
          country: destinationCountry ?? '',
          msisdn: newMsisdn,
          network: newNetwork,
          declaredName,
        }
      : {
          method: 'BANK_ACCOUNT' as const,
          country: destinationCountry ?? '',
          accountNumber: newAccount,
          bankCode: newBankCode,
          declaredName,
        };
  }

  async function runNameEnquiry() {
    setBusy(true);
    setError(null);
    setEnquiry(null);
    try {
      const details = recipientDetails();
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
      const details = recipientDetails(enquiry.resolvedName);
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
          // Omitted entirely where no regime applies. Sending an empty object
          // would fail schema validation on corridors that need nothing.
          ...(exchangeControl.required
            ? {
                exchangeControl: {
                  categoryCode,
                  declaredElsewhereMinorUnits: toMinorUnits(usedElsewhereText, sendDecimals),
                  declarationAccepted,
                },
              }
            : {}),
        },
      });
      // Remembered only once a transfer actually exists. Storing it earlier
      // would learn from a corridor somebody looked at and abandoned.
      rememberCorridor(account?.id ?? null, corridorId);
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
          destinationPaysWallets={destinationPaysWallets}
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
          exchangeControl={exchangeControl}
          sendDecimals={sendDecimals}
          categoryCode={categoryCode}
          setCategoryCode={setCategoryCode}
          usedElsewhereText={usedElsewhereText}
          setUsedElsewhereText={setUsedElsewhereText}
          declarationAccepted={declarationAccepted}
          setDeclarationAccepted={setDeclarationAccepted}
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

        {/* The rate arrives on its own once typing stops, so this is a retry
            rather than a step. It stays because a failed request needs a way
            back, and because a sender watching a locked rate tick down wants to
            refresh it deliberately. */}
        <button
          className="mp-button mp-button--secondary mp-button--block"
          onClick={props.onQuote}
          disabled={props.busy}
        >
          {props.busy
            ? t('send.amount.quoting')
            : props.quote === null
              ? t('send.amount.getRate')
              : t('send.amount.refreshQuote')}
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
  destinationPaysWallets: boolean;
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

        {props.destinationPaysWallets ? (
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
                {props.destinationPaysWallets
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
  exchangeControl: ExchangeControl;
  sendDecimals: number;
  categoryCode: string;
  setCategoryCode: (value: string) => void;
  usedElsewhereText: string;
  setUsedElsewhereText: (value: string) => void;
  declarationAccepted: boolean;
  setDeclarationAccepted: (value: boolean) => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { t } = useApp();
  const expired = props.secondsLeft <= 0;
  /* A declaration that is required and not complete stops the confirm button
     here as well as at the API. Both, not either: the button is a courtesy and
     the server is the control. */
  const declarationIncomplete =
    props.exchangeControl.required && (props.categoryCode === '' || !props.declarationAccepted);

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

      {props.exchangeControl.required ? (
        <DeclarationStep
          info={props.exchangeControl}
          decimals={props.sendDecimals}
          categoryCode={props.categoryCode}
          setCategoryCode={props.setCategoryCode}
          usedElsewhereText={props.usedElsewhereText}
          setUsedElsewhereText={props.setUsedElsewhereText}
          accepted={props.declarationAccepted}
          setAccepted={props.setDeclarationAccepted}
        />
      ) : null}

      {expired ? (
        <div className="mp-notice mp-notice--warning">{t('send.amount.expired')}</div>
      ) : null}

      <button
        className="mp-button mp-button--primary mp-button--block"
        onClick={props.onConfirm}
        disabled={props.busy || expired || declarationIncomplete}
      >
        {t('send.review.commit')} · {props.quote.totalToPay.formatted}
      </button>

      <button className="mp-button mp-button--ghost mp-button--block" onClick={props.onBack}>
        {t('action.back')}
      </button>
    </div>
  );
}

/* ------------------------------------------------------- step: declaration */

/**
 * The exchange-control declaration.
 *
 * Shown only where the origin has a regime — today South Africa under SARB.
 * Three things are asked for and each is load-bearing:
 *
 *  - the published reason code, because the Authorised Dealer files against it
 *    and "other" is not a category a regulator accepts;
 *  - what the sender has already used elsewhere this year, because an allowance
 *    is personal and spans every provider they use. We cannot verify it and we
 *    must not ignore it: counting only what we can see would confidently permit
 *    a payment that breaches the regulation;
 *  - an affirmation, which is recorded rather than decorative.
 *
 * The remaining figure is shown with the caveat that it is what we know about.
 * Presenting our own tally as the true headroom would be a lie the sender acts
 * on, and they are the only party here who knows the real number.
 */
function DeclarationStep(props: {
  info: ExchangeControl;
  decimals: number;
  categoryCode: string;
  setCategoryCode: (value: string) => void;
  usedElsewhereText: string;
  setUsedElsewhereText: (value: string) => void;
  accepted: boolean;
  setAccepted: (value: boolean) => void;
}) {
  const { t } = useApp();
  const { info } = props;
  const currency = info.currency;

  return (
    <section className="mp-card mp-stack">
      <h2 className="mp-card__title">{t('send.declaration.title')}</h2>
      <p className="mp-small mp-muted">
        {t('send.declaration.intro', {
          country: info.regimeCountryName ?? info.regimeCountry ?? '',
          authority: info.authority ?? '',
          reportedBy: info.reportedBy ?? '',
        })}
      </p>

      <Field label={t('send.declaration.category')}>
        <select
          className="mp-select"
          value={props.categoryCode}
          onChange={(e) => props.setCategoryCode(e.target.value)}
        >
          <option value="">{t('send.declaration.categoryPlaceholder')}</option>
          {info.categories.map((category) => (
            <option key={category.code} value={category.code}>
              {category.code} · {category.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="mp-breakdown mp-numeric">
        <div className="mp-breakdown__row">
          <span>{t('send.declaration.allowance', { year: info.allowanceYear ?? '' })}</span>
          <span>{formatMinorUnits(info.annualMinorUnits, props.decimals, currency)}</span>
        </div>
        <div className="mp-breakdown__row">
          <span>{t('send.declaration.usedThroughUs')}</span>
          <span>{formatMinorUnits(info.usedThroughUsMinorUnits, props.decimals, currency)}</span>
        </div>
        <div className="mp-breakdown__row mp-breakdown__row--highlight">
          <span>{t('send.declaration.remaining')}</span>
          <span>{formatMinorUnits(info.remainingMinorUnits, props.decimals, currency)}</span>
        </div>
      </div>

      <Field
        label={t('send.declaration.usedElsewhere')}
        hint={t('send.declaration.usedElsewhereHint')}
      >
        <input
          className="mp-input mp-numeric"
          inputMode="decimal"
          value={props.usedElsewhereText}
          onChange={(e) => props.setUsedElsewhereText(e.target.value.replace(/[^\d.]/g, ''))}
          aria-label={t('send.declaration.usedElsewhere')}
        />
      </Field>

      <p className="mp-small mp-muted">{t('send.declaration.caveat')}</p>

      <label
        className="mp-small"
        style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}
      >
        <input
          type="checkbox"
          checked={props.accepted}
          onChange={(e) => props.setAccepted(e.target.checked)}
          style={{ width: 20, height: 20, marginTop: 2, flex: 'none' }}
        />
        <span>{t('send.declaration.affirm')}</span>
      </label>

      {props.categoryCode === '' ? (
        <p className="mp-small mp-muted">{t('send.declaration.categoryRequired')}</p>
      ) : props.accepted ? null : (
        <p className="mp-small mp-muted">{t('send.declaration.affirmRequired')}</p>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- helpers */

/**
 * "100000.50" → "10000050", at the currency's own precision.
 *
 * The decimal count is a parameter rather than a constant two: XAF and XOF have
 * none, and treating a francophone sender's 200000 as 20 000 000 minor units
 * would multiply their transfer by a hundred. Never goes through a float.
 */
function toMinorUnits(input: string, decimals: number): string {
  const [whole = '0', fraction = ''] = input.split('.');
  const scaled =
    decimals === 0
      ? whole || '0'
      : `${whole || '0'}${fraction.padEnd(decimals, '0').slice(0, decimals)}`;
  return scaled.replace(/^0+(?=\d)/, '');
}

/**
 * How many decimals a currency has, read off an amount the server formatted.
 *
 * `Money.toDecimalString()` always emits exactly `exponent` fraction digits, so
 * the corridor's own minimum carries the precision without the browser needing
 * a currency table. Defaults to two when there is no corridor yet.
 */
function decimalsOf(amount: string | undefined): number {
  if (amount === undefined) return 2;
  return amount.split('.')[1]?.length ?? 0;
}

/** Minor units to a grouped decimal string, for display only. */
function formatMinorUnits(
  minorUnits: string | null,
  decimals: number,
  currency: string | null,
): string {
  if (minorUnits === null) return '—';
  const digits = minorUnits.padStart(decimals + 1, '0');
  const whole = digits
    .slice(0, digits.length - decimals)
    // A non-breaking space, so a grouped amount never wraps mid-number.
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  const fraction = decimals === 0 ? '' : `.${digits.slice(digits.length - decimals)}`;
  return `${whole}${fraction}${currency === null ? '' : `\u00a0${currency}`}`;
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
