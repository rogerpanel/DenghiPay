'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/app/providers';
import { ApiError, api } from '@/lib/api';
import {
  AppShell,
  ErrorNotice,
  Field,
  LoadingCard,
  MoneyDto,
  RequireAuth,
} from '@/components/shell';
import type { TranslationKey } from '@/lib/i18n';

interface Schedule {
  id: string;
  corridorId: string;
  recipientId: string;
  recipientName: string | null;
  recipientMasked: string;
  amount: MoneyDto;
  payinMethod: string;
  purpose: string;
  frequency: 'WEEKLY' | 'MONTHLY';
  dayOfPeriod: number;
  nextRunAt: string;
  lastRunAt: string | null;
  lastFailure: string | null;
  occurrences: number;
  active: boolean;
}

interface Corridor {
  id: string;
  sourceCountry: string;
  destinationCountry: string;
  destinationCurrency: string;
  payinMethods: string[];
  minSend: MoneyDto;
  enabled: boolean;
}

interface Recipient {
  id: string;
  country: string;
  maskedAccount: string;
  resolvedName: string | null;
}

const PURPOSES = ['FAMILY_SUPPORT', 'EDUCATION', 'MEDICAL', 'GIFT', 'OWN_ACCOUNT'] as const;

function SchedulesInner() {
  const { t, account } = useApp();
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [corridors, setCorridors] = useState<Corridor[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [corridorId, setCorridorId] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [amountText, setAmountText] = useState('');
  const [frequency, setFrequency] = useState<'WEEKLY' | 'MONTHLY'>('MONTHLY');
  const [dayOfPeriod, setDayOfPeriod] = useState(1);
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]>('FAMILY_SUPPORT');

  const residency = account?.residencyCountry ?? null;

  const load = useCallback(async () => {
    try {
      const [scheduleList, corridorList, recipientList] = await Promise.all([
        api<{ schedules: Schedule[] }>('/schedules'),
        api<{ corridors: Corridor[] }>('/corridors'),
        api<{ recipients: Recipient[] }>('/recipients'),
      ]);
      setSchedules(scheduleList.schedules);
      const usable = corridorList.corridors.filter(
        (c) => c.enabled && (residency === null || c.sourceCountry === residency),
      );
      setCorridors(usable);
      setRecipients(recipientList.recipients);
      setCorridorId((current) => (current === '' ? (usable[0]?.id ?? '') : current));
    } catch {
      setError(t('error.generic'));
      setSchedules([]);
    }
  }, [t, residency]);

  useEffect(() => {
    void load();
  }, [load]);

  const corridor = corridors.find((c) => c.id === corridorId) ?? null;
  const eligible = recipients.filter((r) => r.country === corridor?.destinationCountry);
  const decimals = corridor?.minSend.amount.split('.')[1]?.length ?? 2;

  async function create() {
    if (corridor === null || recipientId === '') return;
    setBusy(true);
    setError(null);
    try {
      await api('/schedules', {
        method: 'POST',
        body: {
          corridorId,
          recipientId,
          sendMinorUnits: toMinorUnits(amountText, decimals),
          payinMethod: corridor.payinMethods[0],
          purpose,
          frequency,
          dayOfPeriod,
        },
      });
      setAmountText('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(schedule: Schedule) {
    setBusy(true);
    try {
      await api(`/schedules/${schedule.id}/${schedule.active ? 'pause' : 'resume'}`, {
        method: 'POST',
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (schedules === null) return <LoadingCard />;

  return (
    <div className="mp-stack">
      <h1>{t('schedules.title')}</h1>

      {/* Said plainly, because the alternative is somebody believing money
          leaves their account by itself and finding out otherwise. */}
      <div className="mp-notice mp-notice--info">{t('schedules.explain')}</div>

      <ErrorNotice message={error} />

      {schedules.length > 0 ? (
        <section className="mp-card mp-stack">
          <h2 className="mp-card__title">{t('schedules.yours')}</h2>
          {schedules.map((schedule) => (
            <div key={schedule.id} className="mp-card mp-card--flat mp-stack mp-stack--tight">
              <div className="mp-row">
                <div>
                  <strong>{schedule.amount.formatted}</strong>{' '}
                  <span className="mp-muted">{t('schedules.to')}</span>{' '}
                  <strong>{schedule.recipientName ?? schedule.recipientMasked}</strong>
                  <br />
                  <span className="mp-small mp-muted">
                    {schedule.corridorId} ·{' '}
                    {schedule.frequency === 'MONTHLY'
                      ? t('schedules.monthlyOn', { day: schedule.dayOfPeriod })
                      : t('schedules.weeklyOn', { day: schedule.dayOfPeriod })}
                  </span>
                </div>
                <span
                  className={`mp-badge ${schedule.active ? 'mp-badge--progress' : 'mp-badge--warning'}`}
                >
                  {schedule.active ? t('schedules.active') : t('schedules.paused')}
                </span>
              </div>

              <div className="mp-small mp-muted mp-numeric">
                {t('schedules.next')}: {new Date(schedule.nextRunAt).toLocaleDateString()} ·{' '}
                {t('schedules.prepared', { count: schedule.occurrences })}
              </div>

              {schedule.lastFailure === null ? null : (
                <div className="mp-notice mp-notice--warning mp-small">
                  {t('schedules.lastFailed')}: {schedule.lastFailure}
                </div>
              )}

              <button
                className="mp-button mp-button--ghost"
                disabled={busy}
                onClick={() => void toggle(schedule)}
              >
                {schedule.active ? t('schedules.pause') : t('schedules.resume')}
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <section className="mp-card mp-stack">
        <h2 className="mp-card__title">{t('schedules.new')}</h2>

        <Field label={t('send.amount.corridor')}>
          <select
            className="mp-select"
            value={corridorId}
            onChange={(e) => {
              setCorridorId(e.target.value);
              setRecipientId('');
            }}
          >
            {corridors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.sourceCountry} → {c.destinationCountry} ({c.destinationCurrency})
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('transfer.recipient')}>
          <select
            className="mp-select"
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
          >
            <option value="">{t('schedules.chooseRecipient')}</option>
            {eligible.map((r) => (
              <option key={r.id} value={r.id}>
                {r.resolvedName ?? r.maskedAccount}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('send.amount.youSend')}>
          <input
            className="mp-input mp-numeric"
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </Field>

        <Field label={t('schedules.frequency')}>
          <select
            className="mp-select"
            value={frequency}
            onChange={(e) => {
              const value = e.target.value as 'WEEKLY' | 'MONTHLY';
              setFrequency(value);
              setDayOfPeriod(1);
            }}
          >
            <option value="MONTHLY">{t('schedules.monthly')}</option>
            <option value="WEEKLY">{t('schedules.weekly')}</option>
          </select>
        </Field>

        <Field
          label={frequency === 'MONTHLY' ? t('schedules.dayOfMonth') : t('schedules.dayOfWeek')}
          hint={frequency === 'MONTHLY' ? t('schedules.dayCap') : undefined}
        >
          <select
            className="mp-select"
            value={dayOfPeriod}
            onChange={(e) => setDayOfPeriod(Number(e.target.value))}
          >
            {(frequency === 'MONTHLY'
              ? Array.from({ length: 28 }, (_, i) => i + 1)
              : [1, 2, 3, 4, 5, 6, 7]
            ).map((day) => (
              <option key={day} value={day}>
                {frequency === 'MONTHLY' ? day : t(`weekday.${day}` as TranslationKey)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('send.review.purpose')}>
          <select
            className="mp-select"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as (typeof PURPOSES)[number])}
          >
            {PURPOSES.map((value) => (
              <option key={value} value={value}>
                {t(`purpose.${value}` as TranslationKey)}
              </option>
            ))}
          </select>
        </Field>

        <button
          className="mp-button mp-button--primary mp-button--block"
          disabled={busy || recipientId === '' || amountText === ''}
          onClick={create}
        >
          {t('schedules.create')}
        </button>
      </section>
    </div>
  );
}

/** Same rule as the send flow: the currency's own precision, never a float. */
function toMinorUnits(input: string, decimals: number): string {
  const [whole = '0', fraction = ''] = input.split('.');
  const scaled =
    decimals === 0
      ? whole || '0'
      : `${whole || '0'}${fraction.padEnd(decimals, '0').slice(0, decimals)}`;
  return scaled.replace(/^0+(?=\d)/, '');
}

export default function SchedulesPage() {
  return (
    <AppShell>
      <RequireAuth>
        <SchedulesInner />
      </RequireAuth>
    </AppShell>
  );
}
