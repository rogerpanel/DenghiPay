import { CurrencyCode, ExchangeRate } from '@morapay/domain';

/**
 * Rate ingestion port (BUILD_PLAN 4.1).
 *
 * A source reports when it observed a rate. It does not report freshness — the
 * quote engine decides that, because the threshold is a business rule and the
 * feed does not get to grade its own homework.
 */
export interface RateObservation<
  From extends CurrencyCode = CurrencyCode,
  To extends CurrencyCode = CurrencyCode,
> {
  readonly rate: ExchangeRate<From, To>;
  readonly observedAt: Date;
  readonly source: string;
}

export interface RateSource {
  readonly id: string;
  readonly pairs: readonly (readonly [CurrencyCode, CurrencyCode])[];
  fetch<From extends CurrencyCode, To extends CurrencyCode>(
    from: From,
    to: To,
  ): Promise<RateObservation<From, To>>;
}
