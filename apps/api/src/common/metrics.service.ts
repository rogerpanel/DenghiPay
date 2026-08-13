import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics (BUILD_PLAN 11.4).
 *
 * The counters below are the ones an on-call engineer needs at 3am: what is
 * stuck, what is being rejected, and whether the money still balances. Label
 * values are always bounded — never a user id, never a transfer reference.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly callbacks: Counter<'provider' | 'outcome'>;
  private readonly transfers: Counter<'corridor' | 'state'>;
  private readonly screening: Counter<'result'>;
  private readonly ledgerPostings: Counter<'reason'>;
  private readonly providerCalls: Histogram<'provider' | 'operation' | 'outcome'>;
  private readonly stuckTransfers: Gauge<'corridor'>;
  private readonly floatBalance: Gauge<'currency'>;
  private readonly openExposure: Gauge<'currency'>;
  private readonly reconciliationBreaks: Gauge<'provider'>;

  constructor() {
    this.registry.setDefaultLabels({ service: 'morapay-api' });
    collectDefaultMetrics({ register: this.registry });

    this.callbacks = new Counter({
      name: 'morapay_callbacks_total',
      help: 'Provider callbacks received, by outcome of verification',
      labelNames: ['provider', 'outcome'],
      registers: [this.registry],
    });

    this.transfers = new Counter({
      name: 'morapay_transfer_transitions_total',
      help: 'Transfer state transitions',
      labelNames: ['corridor', 'state'],
      registers: [this.registry],
    });

    this.screening = new Counter({
      name: 'morapay_screening_results_total',
      help: 'Sanctions and PEP screening results',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.ledgerPostings = new Counter({
      name: 'morapay_ledger_postings_total',
      help: 'Ledger transactions posted, by reason',
      labelNames: ['reason'],
      registers: [this.registry],
    });

    this.providerCalls = new Histogram({
      name: 'morapay_provider_call_duration_seconds',
      help: 'Outbound provider call latency',
      labelNames: ['provider', 'operation', 'outcome'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    this.stuckTransfers = new Gauge({
      name: 'morapay_stuck_transfers',
      help: 'Transfers past their expected completion window',
      labelNames: ['corridor'],
      registers: [this.registry],
    });

    this.floatBalance = new Gauge({
      name: 'morapay_float_balance_minor_units',
      help: 'Derived float balance per currency, in minor units',
      labelNames: ['currency'],
      registers: [this.registry],
    });

    this.openExposure = new Gauge({
      name: 'morapay_open_fx_exposure_minor_units',
      help: 'Unhedged FX exposure per currency, in minor units',
      labelNames: ['currency'],
      registers: [this.registry],
    });

    this.reconciliationBreaks = new Gauge({
      name: 'morapay_reconciliation_breaks',
      help: 'Unresolved reconciliation breaks from the most recent run',
      labelNames: ['provider'],
      registers: [this.registry],
    });
  }

  callbackReceived(
    provider: string,
    outcome: 'accepted' | 'rejected.stale' | 'rejected.signature' | 'duplicate' | 'malformed',
  ): void {
    this.callbacks.inc({ provider, outcome });
  }

  transferTransitioned(corridor: string, state: string): void {
    this.transfers.inc({ corridor, state });
  }

  screeningResult(result: 'clear' | 'hit' | 'error'): void {
    this.screening.inc({ result });
  }

  ledgerPosted(reason: string): void {
    this.ledgerPostings.inc({ reason });
  }

  observeProviderCall(
    provider: string,
    operation: string,
    outcome: 'ok' | 'error',
    seconds: number,
  ): void {
    this.providerCalls.observe({ provider, operation, outcome }, seconds);
  }

  setStuckTransfers(corridor: string, count: number): void {
    this.stuckTransfers.set({ corridor }, count);
  }

  setFloatBalance(currency: string, minorUnits: bigint): void {
    this.floatBalance.set({ currency }, Number(minorUnits));
  }

  setOpenExposure(currency: string, minorUnits: bigint): void {
    this.openExposure.set({ currency }, Number(minorUnits));
  }

  setReconciliationBreaks(provider: string, count: number): void {
    this.reconciliationBreaks.set({ provider }, count);
  }

  async scrape(): Promise<string> {
    return this.registry.metrics();
  }
}
