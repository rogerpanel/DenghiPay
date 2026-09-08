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

interface RateAlert {
  id: string;
  corridorId: string;
  direction: 'ABOVE' | 'BELOW';
  thresholdRate: string;
  currentRate: string | null;
  active: boolean;
  triggeredAt: string | null;
  triggeredRate: string | null;
  createdAt: string;
}

interface Corridor {
  id: string;
  sourceCountry: string;
  destinationCountry: string;
  sourceCurrency: string;
  destinationCurrency: string;
  minSend: MoneyDto;
  enabled: boolean;
}

function AlertsInner() {
  const { t, account } = useApp();
  const [alerts, setAlerts] = useState<RateAlert[] | null>(null);
  const [corridors, setCorridors] = useState<Corridor[]>([]);
  const [corridorId, setCorridorId] = useState('');
  const [direction, setDirection] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const [threshold, setThreshold] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const residency = account?.residencyCountry ?? null;

  const load = useCallback(async () => {
    try {
      const [alertList, corridorList] = await Promise.all([
        api<{ alerts: RateAlert[] }>('/rate-alerts'),
        api<{ corridors: Corridor[] }>('/corridors'),
      ]);
      setAlerts(alertList.alerts);
      const usable = corridorList.corridors.filter(
        (c) => c.enabled && (residency === null || c.sourceCountry === residency),
      );
      setCorridors(usable);
      setCorridorId((current) => (current === '' ? (usable[0]?.id ?? '') : current));
    } catch {
      setError(t('error.generic'));
      setAlerts([]);
    }
  }, [t, residency]);

  useEffect(() => {
    void load();
  }, [load]);

  const corridor = corridors.find((c) => c.id === corridorId) ?? null;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api('/rate-alerts', {
        method: 'POST',
        body: { corridorId, direction, thresholdRate: threshold },
      });
      setThreshold('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api(`/rate-alerts/${id}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (alerts === null) return <LoadingCard />;

  return (
    <div className="mp-stack">
      <h1>{t('alerts.title')}</h1>
      <p className="mp-muted mp-small" style={{ marginTop: 0 }}>
        {t('alerts.explain')}
      </p>

      <ErrorNotice message={error} />

      {alerts.length > 0 ? (
        <section className="mp-card mp-stack">
          <h2 className="mp-card__title">{t('alerts.yours')}</h2>
          {alerts.map((alert) => (
            <div key={alert.id} className="mp-card mp-card--flat mp-stack mp-stack--tight">
              <div className="mp-row">
                <div>
                  <strong className="mp-numeric">
                    {alert.corridorId} {alert.direction === 'ABOVE' ? '≥' : '≤'}{' '}
                    {alert.thresholdRate}
                  </strong>
                  <br />
                  <span className="mp-small mp-muted mp-numeric">
                    {alert.currentRate === null
                      ? t('alerts.rateUnavailable')
                      : t('alerts.currently', { rate: alert.currentRate })}
                  </span>
                </div>
                <span
                  className={`mp-badge ${alert.active ? 'mp-badge--progress' : 'mp-badge--success'}`}
                >
                  {alert.active ? t('alerts.watching') : t('alerts.fired')}
                </span>
              </div>

              {alert.triggeredAt === null ? null : (
                <div className="mp-small mp-muted">
                  {t('alerts.firedAt', {
                    rate: alert.triggeredRate ?? '',
                    at: new Date(alert.triggeredAt).toLocaleString(),
                  })}
                </div>
              )}

              <button
                className="mp-button mp-button--ghost"
                disabled={busy}
                onClick={() => void remove(alert.id)}
              >
                {t('alerts.remove')}
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <section className="mp-card mp-stack">
        <h2 className="mp-card__title">{t('alerts.new')}</h2>

        <Field label={t('send.amount.corridor')}>
          <select
            className="mp-select"
            value={corridorId}
            onChange={(e) => setCorridorId(e.target.value)}
          >
            {corridors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.sourceCountry} → {c.destinationCountry} ({c.destinationCurrency})
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('alerts.when')}>
          <select
            className="mp-select"
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'ABOVE' | 'BELOW')}
          >
            <option value="ABOVE">{t('alerts.above')}</option>
            <option value="BELOW">{t('alerts.below')}</option>
          </select>
        </Field>

        <Field
          label={t('alerts.threshold')}
          hint={
            corridor === null
              ? undefined
              : t('alerts.thresholdHint', {
                  from: corridor.sourceCurrency,
                  to: corridor.destinationCurrency,
                })
          }
        >
          <input
            className="mp-input mp-numeric"
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </Field>

        <button
          className="mp-button mp-button--primary mp-button--block"
          disabled={busy || threshold === '' || corridorId === ''}
          onClick={create}
        >
          {t('alerts.create')}
        </button>

        {/* The honest caveat. An alert is news, not an offer. */}
        <p className="mp-small mp-muted">{t('alerts.notHeld')}</p>
      </section>
    </div>
  );
}

export default function AlertsPage() {
  return (
    <AppShell>
      <RequireAuth>
        <AlertsInner />
      </RequireAuth>
    </AppShell>
  );
}
