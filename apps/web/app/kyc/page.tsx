'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MSISDN_FORMAT, isCountryCode, networksFor } from '@morapay/domain';
import { useApp } from '@/app/providers';
import { ApiError, api } from '@/lib/api';
import { AppShell, ErrorNotice, Field, LoadingCard, RequireAuth } from '@/components/shell';
import type { TranslationKey } from '@/lib/i18n';

interface Requirements {
  tier: number;
  residencyCountry: string;
  requiredDocuments: string[];
  alternatives: Record<string, string[]>;
  limits: {
    perTransfer: string;
    daily: string;
    monthly: string;
    currency: string;
    decimals: number;
  };
}

/**
 * Which identity anchors a residency needs, and what its wallet looks like.
 *
 * Derived from the domain rather than listed per country. Sixteen residencies
 * with three special cases between them is not sixteen branches — it is two
 * questions ("does it have a national identity number?", "is collection a pull
 * from a wallet?") and three named exceptions.
 *
 * Russia and Belarus fall through with nothing: their identity evidence is
 * documents, collected above, and their collection is a push the sender
 * originates, so there is no wallet to debit.
 */
function anchorsFor(residency: string) {
  const country = isCountryCode(residency) ? residency : null;
  const wallet = country === null ? undefined : MSISDN_FORMAT[country];
  const collectsFromWallet = wallet !== undefined;

  // Nigeria anchors on a BVN and Ghana on a Ghana Card, so neither is asked for
  // a national identity number as well. Everyone else with a partition is.
  const usesNationalId =
    country !== null &&
    country !== 'NG' &&
    country !== 'GH' &&
    country !== 'RU' &&
    country !== 'BY';

  return {
    usesNationalId,
    collectsFromWallet,
    networks: country === null ? [] : [...networksFor(country)],
    msisdnMaxLength: wallet === undefined ? 15 : wallet.prefix.length + wallet.maxDigits,
    msisdnPlaceholder:
      wallet === undefined ? '' : `${wallet.prefix}${'X'.repeat(wallet.maxDigits)}`,
    // Nigeria's BVN is an anchor too, so the section shows for it even though
    // it answers neither question above.
    shown: usesNationalId || collectsFromWallet || country === 'NG' || country === 'GH',
  };
}

/**
 * Tiered KYC (BUILD_PLAN 3.2, 3.3, 10.3).
 *
 * The document list comes from the server, per residency, so a Nigerian student
 * in Moscow is asked for a passport, a migration card and a registration —
 * never a Russian internal passport they do not have.
 *
 * Camera capture degrades gracefully: `capture="environment"` uses the camera
 * where there is one and falls back to the file picker where there is not,
 * which is what a low-end device on a weak connection needs.
 */
function KycInner() {
  const { t, account, refreshAccount } = useApp();
  const router = useRouter();
  const targetTier = Math.min((account?.kycTier ?? 0) + 1, 3);

  const [requirements, setRequirements] = useState<Requirements | null>(null);
  const [attached, setAttached] = useState<Record<string, boolean>>({});
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [nationality, setNationality] = useState('NG');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  /* Jurisdiction-specific identity anchors. Each is stored only in its own
     residency partition, and each exists because some later step cannot run
     without it: Nigeria matches a BVN, Ghana debits a named wallet, and South
     Africa cannot decide an exchange-control declaration without an identity
     number and a residency status. Asked here because this is where identity
     evidence already is. */
  const [bvn, setBvn] = useState('');
  const [ghanaCardNo, setGhanaCardNo] = useState('');
  const [walletMsisdn, setWalletMsisdn] = useState('');
  const [walletNetwork, setWalletNetwork] = useState('MTN');
  const [nationalIdNo, setNationalIdNo] = useState('');
  const [taxReference, setTaxReference] = useState('');
  const [exchangeControlStatus, setExchangeControlStatus] = useState('RESIDENT');

  const anchors = anchorsFor(requirements?.residencyCountry ?? '');

  useEffect(() => {
    void api<Requirements>(`/kyc/requirements/${targetTier}`)
      .then(setRequirements)
      .catch(() => setError(t('error.generic')));
  }, [targetTier, t]);

  /* Default the wallet operator to one this residency actually licenses.
     The initial value is MTN, which is right in Ghana, Cameroon and Benin and
     wrong in Kenya, Tanzania and everywhere else M-PESA or Airtel operate — and
     a network the country does not license is refused by the API with a message
     about a network the sender never chose. */
  const firstNetwork = anchors.networks[0];
  useEffect(() => {
    if (firstNetwork !== undefined) setWalletNetwork(firstNetwork);
  }, [firstNetwork]);

  async function submit() {
    if (requirements === null) return;
    setBusy(true);
    setError(null);
    try {
      const residency = requirements.residencyCountry;
      const { usesNationalId, collectsFromWallet } = anchors;
      await api('/kyc/submit', {
        method: 'POST',
        body: {
          targetTier,
          person: {
            firstName,
            lastName,
            dateOfBirth,
            nationality,
            // Only the anchors this residency actually uses, and only when
            // filled in: an empty string would fail the format checks in the
            // contract rather than reading as "not provided".
            ...(residency === 'NG' && bvn !== '' ? { bvn } : {}),
            ...(residency === 'GH' && ghanaCardNo !== '' ? { ghanaCardNo } : {}),
            ...(residency === 'ZA' && taxReference !== '' ? { taxReference } : {}),
            ...(residency === 'ZA' ? { exchangeControlStatus } : {}),
            // The national identity number is the anchor for every residency
            // except Nigeria, which uses a BVN, and Ghana, which uses a Ghana
            // Card. South Africa keeps it alongside a tax reference.
            ...(usesNationalId && nationalIdNo !== '' ? { nationalIdNo } : {}),
            // A wallet to debit, wherever collection is a pull from one. This
            // was asked of Ghana alone while Ghana was the only such origin;
            // Cameroon and Benin collect the same way and were never asked, so
            // their sender_profile wallet columns sat empty and the collection
            // had nothing to debit.
            ...(collectsFromWallet && walletMsisdn !== ''
              ? { collectionWallet: { msisdn: walletMsisdn, network: walletNetwork } }
              : {}),
          },
          documents: requirements.requiredDocuments
            .filter((type) => attached[type] === true)
            .map((type) => ({ type, storageKey: `upload://${type.toLowerCase()}` })),
        },
      });
      await refreshAccount();
      setDone(true);
      setTimeout(() => router.push('/send'), 1500);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  if (requirements === null) return <LoadingCard />;

  const allAttached = requirements.requiredDocuments.every((type) => attached[type] === true);
  const perTransfer = formatMinor(
    requirements.limits.perTransfer,
    requirements.limits.currency,
    requirements.limits.decimals,
  );

  return (
    <div className="mp-stack">
      <h1>{t('kyc.title')}</h1>

      <div className="mp-notice mp-notice--info">
        {t('kyc.current', { tier: account?.kycTier ?? 0 })}{' '}
        {t('kyc.limitNote', { tier: targetTier, limit: perTransfer })}
      </div>

      <ErrorNotice message={error} />
      {done ? <div className="mp-notice mp-notice--info">{t('kyc.submitted')}</div> : null}

      <section className="mp-card mp-stack">
        <Field label={t('kyc.firstName')}>
          <input
            className="mp-input"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
          />
        </Field>
        <Field label={t('kyc.lastName')}>
          <input
            className="mp-input"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
          />
        </Field>
        <Field label={t('kyc.dateOfBirth')}>
          <input
            className="mp-input"
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
          />
        </Field>
        <Field label={t('kyc.nationality')} hint="ISO 3166-1 alpha-2">
          <input
            className="mp-input"
            maxLength={2}
            value={nationality}
            onChange={(e) => setNationality(e.target.value.toUpperCase())}
          />
        </Field>
      </section>

      {/* Only the residency's own anchors. A Ghanaian sender is never asked for
          a BVN, and a South African is never asked for a wallet we would have
          no rail to debit.

          Which anchors a residency has is decided by `anchorsFor` rather than a
          list of countries written here. The list said ['NG','GH','ZA'] while
          those were the only three with anchors, and stayed that way after
          Cameroon and Benin arrived — so a Cameroonian sender was never asked
          for the identity number or the wallet their partition has columns
          for, and their collection had nothing to debit. */}
      {anchors.shown ? (
        <section className="mp-card mp-stack">
          <h2 className="mp-card__title">
            {t('kyc.identity', { country: requirements.residencyCountry })}
          </h2>

          {requirements.residencyCountry === 'NG' ? (
            <Field label={t('kyc.bvn')} hint={t('kyc.bvnHint')}>
              <input
                className="mp-input mp-numeric"
                inputMode="numeric"
                maxLength={11}
                value={bvn}
                onChange={(e) => setBvn(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          ) : null}

          {requirements.residencyCountry === 'GH' ? (
            <Field label={t('kyc.ghanaCard')} hint={t('kyc.ghanaCardHint')}>
              <input
                className="mp-input mp-numeric"
                value={ghanaCardNo}
                onChange={(e) => setGhanaCardNo(e.target.value.toUpperCase())}
              />
            </Field>
          ) : null}

          {anchors.usesNationalId ? (
            <Field label={t('kyc.nationalId')}>
              <input
                className="mp-input"
                maxLength={20}
                value={nationalIdNo}
                onChange={(e) => setNationalIdNo(e.target.value.toUpperCase())}
              />
            </Field>
          ) : null}

          {/* The wallet a collection debits. Its network list and number format
              come from the domain, so a Kenyan sender is offered M-PESA rather
              than the Ghanaian operators this form once hardcoded. */}
          {anchors.collectsFromWallet ? (
            <>
              <Field label={t('kyc.walletNetwork')}>
                <select
                  className="mp-select"
                  value={walletNetwork}
                  onChange={(e) => setWalletNetwork(e.target.value)}
                >
                  {anchors.networks.map((network) => (
                    <option key={network} value={network}>
                      {network}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('kyc.wallet')} hint={t('kyc.walletHint')}>
                <input
                  className="mp-input mp-numeric"
                  inputMode="numeric"
                  maxLength={anchors.msisdnMaxLength}
                  placeholder={anchors.msisdnPlaceholder}
                  value={walletMsisdn}
                  onChange={(e) => setWalletMsisdn(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
            </>
          ) : null}

          {requirements.residencyCountry === 'ZA' ? (
            <>
              <Field label={t('kyc.taxReference')} hint={t('kyc.taxReferenceHint')}>
                <input
                  className="mp-input mp-numeric"
                  inputMode="numeric"
                  maxLength={10}
                  value={taxReference}
                  onChange={(e) => setTaxReference(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
              <Field label={t('kyc.exchangeControlStatus')} hint={t('kyc.exchangeControlHint')}>
                <select
                  className="mp-select"
                  value={exchangeControlStatus}
                  onChange={(e) => setExchangeControlStatus(e.target.value)}
                >
                  {(['RESIDENT', 'TEMPORARY_RESIDENT', 'NON_RESIDENT'] as const).map((status) => (
                    <option key={status} value={status}>
                      {t(`kyc.status.${status}` as TranslationKey)}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="mp-card mp-stack">
        <h2 className="mp-card__title">{t('kyc.required')}</h2>
        <ul className="mp-list">
          {requirements.requiredDocuments.map((type) => (
            <li key={type} className="mp-list__item" style={{ cursor: 'default' }}>
              <span style={{ flex: 1 }}>
                <strong>{humanise(type)}</strong>
                {requirements.alternatives[type] === undefined ? null : (
                  <>
                    <br />
                    <span className="mp-small mp-muted">
                      {t('kyc.alternatives')}:{' '}
                      {requirements.alternatives[type]?.map(humanise).join(', ')}
                    </span>
                  </>
                )}
              </span>
              <label
                className={`mp-button ${
                  attached[type] === true ? 'mp-button--secondary' : 'mp-button--primary'
                }`}
                style={{ minHeight: 40, padding: '0 16px' }}
              >
                {attached[type] === true ? t('kyc.attached') : t('kyc.upload')}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  hidden
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      setAttached((current) => ({ ...current, [type]: true }));
                    }
                  }}
                />
              </label>
            </li>
          ))}
        </ul>
      </section>

      <button
        className="mp-button mp-button--primary mp-button--block"
        onClick={submit}
        disabled={busy || !allAttached || firstName === '' || lastName === '' || dateOfBirth === ''}
      >
        {t('kyc.submit')}
      </button>
    </div>
  );
}

function humanise(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Minor units to a readable amount, at the currency's own precision.
 *
 * The decimal count comes from the server rather than being assumed to be two:
 * XAF and XOF have none, and a hardcoded two would show a Beninese sender a
 * limit a hundred times smaller than the one they actually have.
 */
function formatMinor(minorUnits: string, currency: string, decimals: number): string {
  const value = minorUnits.padStart(decimals + 1, '0');
  const whole = value.slice(0, value.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fraction = decimals === 0 ? '' : `.${value.slice(value.length - decimals)}`;
  return `${whole}${fraction} ${currency}`;
}

export default function KycPage() {
  return (
    <AppShell>
      <RequireAuth>
        <KycInner />
      </RequireAuth>
    </AppShell>
  );
}
