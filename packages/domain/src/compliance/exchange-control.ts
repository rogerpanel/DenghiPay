import { CountryCode } from '../corridors/corridor';
import { CurrencyCode } from '../money/currency';
import { Money } from '../money/money';

/**
 * Exchange control (BUILD_PLAN 4.3c, OPEN_ITEMS B8).
 *
 * Some countries permit an outward payment only when it is *declared*: the
 * payer states what the money is for under a published category, and the amount
 * counts against a personal annual allowance. South Africa is the case that
 * forced this module, but the shape is general and Nigeria and Russia both have
 * capital-control regimes of their own that may need it later — so a regime is
 * data, keyed by origin country, rather than a branch on `=== 'ZA'`.
 *
 * **This implements a control; it does not work around one.** Guardrail 4 is
 * explicit that we never design around capital controls. The whole point of
 * this file is to make an undeclared or over-allowance payment impossible to
 * express, which is the opposite exercise, and the reason the allowance check
 * fails closed on every uncertainty below.
 *
 * The honest limitation, stated once here and surfaced to the sender and to
 * compliance: **an allowance is personal and spans every provider a person
 * uses.** We can see only our own share of it. Somebody who has already sent
 * money through their bank this year has consumed allowance we cannot observe.
 * So our tally is a floor, never a ceiling; the sender declares what they have
 * used elsewhere, and the Authorised Dealer holds the complete picture. A
 * design that treated our own total as authoritative would confidently permit
 * a payment that breaches the regulation.
 */

/** A published reason code that must accompany a declared outward payment. */
export interface DeclarationCategory {
  readonly code: string;
  readonly label: string;
  /** Which allowance this category draws on. */
  readonly allowance: AllowanceKind;
}

/**
 * Which pot of allowance a payment consumes.
 *
 * `DISCRETIONARY` is the everyday one and needs no tax clearance.
 * `INVESTMENT` is larger and, in South Africa, requires a tax compliance
 * status PIN obtained from SARS before the payment may proceed — which is why
 * it is a separate kind rather than a bigger number.
 */
export type AllowanceKind = 'DISCRETIONARY' | 'INVESTMENT';

export interface AllowanceLimit {
  readonly kind: AllowanceKind;
  /** Ceiling for one calendar year, in minor units of the regime's currency. */
  readonly annualMinorUnits: bigint;
  /** Whether a tax-clearance reference must be supplied before use. */
  readonly requiresTaxClearance: boolean;
}

export interface ExchangeControlRegime {
  readonly country: CountryCode;
  /**
   * The country's name, for sentences a sender reads. An alpha-2 code is right
   * for a database column and wrong in "money leaving ZA must be declared".
   */
  readonly countryName: string;
  readonly currency: CurrencyCode;
  /** The supervisory authority, named in messages so a sender can look it up. */
  readonly authority: string;
  /** Who actually files the report. We supply the data; they file it. */
  readonly reportedBy: string;
  readonly categories: readonly DeclarationCategory[];
  readonly allowances: readonly AllowanceLimit[];
  /**
   * Minimum age for the discretionary allowance. Below it a resident has a
   * smaller allowance, which this module does not yet model — so a sender
   * under this age is refused rather than granted the adult figure.
   */
  readonly adultAgeYears: number;
}

/**
 * South Africa, under SARB exchange control.
 *
 * **Every value in here is a placeholder pending confirmation by the Authorised
 * Dealer.** The category codes and the allowance figures are published and
 * change by circular; getting one wrong produces a payment that is reported
 * under the wrong heading or permitted past a ceiling. Treat this table as
 * configuration that compliance owns and the AD signs off, not as fact
 * discovered by reading it here. What the code guarantees is the *mechanism*:
 * no declared-regime payment without a category, and none past the allowance.
 */
const SOUTH_AFRICA: ExchangeControlRegime = {
  country: 'ZA',
  countryName: 'South Africa',
  currency: 'ZAR',
  authority: 'South African Reserve Bank (Financial Surveillance)',
  reportedBy: 'the Authorised Dealer',
  adultAgeYears: 18,
  categories: [
    { code: '416', label: 'Gift', allowance: 'DISCRETIONARY' },
    { code: '417', label: 'Migrant worker remittance', allowance: 'DISCRETIONARY' },
    { code: '418', label: 'Maintenance or alimony', allowance: 'DISCRETIONARY' },
    { code: '419', label: 'Family support', allowance: 'DISCRETIONARY' },
    { code: '420', label: 'Study and education costs', allowance: 'DISCRETIONARY' },
    { code: '421', label: 'Medical costs', allowance: 'DISCRETIONARY' },
  ],
  allowances: [
    // R1 000 000 a calendar year, no tax clearance required.
    {
      kind: 'DISCRETIONARY',
      annualMinorUnits: 100_000_000n,
      requiresTaxClearance: false,
    },
    // R10 000 000 a calendar year, and only against a valid tax compliance
    // status PIN. No category above draws on it yet — it is here because the
    // distinction is real and a future corridor may need it, and because an
    // allowance that silently required no clearance would be the dangerous
    // shape to leave lying around.
    {
      kind: 'INVESTMENT',
      annualMinorUnits: 1_000_000_000n,
      requiresTaxClearance: true,
    },
  ],
};

const REGIMES: Readonly<Partial<Record<CountryCode, ExchangeControlRegime>>> = {
  ZA: SOUTH_AFRICA,
};

/** The regime governing outward payments from this country, if it has one. */
export function exchangeControlFor(country: string): ExchangeControlRegime | undefined {
  return REGIMES[country as CountryCode];
}

export function requiresDeclaration(country: string): boolean {
  return exchangeControlFor(country) !== undefined;
}

export function categoryIn(
  regime: ExchangeControlRegime,
  code: string,
): DeclarationCategory | undefined {
  return regime.categories.find((c) => c.code === code);
}

export function allowanceIn(
  regime: ExchangeControlRegime,
  kind: AllowanceKind,
): AllowanceLimit | undefined {
  return regime.allowances.find((a) => a.kind === kind);
}

/**
 * What a sender has already consumed of an allowance this calendar year.
 *
 * Two numbers, deliberately kept apart. `throughUsMinorUnits` is what we have
 * observed and can prove; `declaredElsewhereMinorUnits` is what the sender told
 * us they have spent through other providers, which we cannot verify and must
 * not ignore. Adding them at the point of storage would lose the distinction
 * that matters when a discrepancy is investigated.
 */
export interface AllowanceUsage {
  readonly throughUsMinorUnits: bigint;
  readonly declaredElsewhereMinorUnits: bigint;
}

export function totalUsed(usage: AllowanceUsage): bigint {
  return usage.throughUsMinorUnits + usage.declaredElsewhereMinorUnits;
}

export type DeclarationDecision =
  | {
      readonly allowed: true;
      readonly category: DeclarationCategory;
      readonly remainingMinorUnits: bigint;
    }
  | {
      readonly allowed: false;
      readonly reason:
        | 'CATEGORY_REQUIRED'
        | 'CATEGORY_UNKNOWN'
        | 'ALLOWANCE_NOT_CONFIGURED'
        | 'ALLOWANCE_EXCEEDED'
        | 'TAX_CLEARANCE_REQUIRED'
        | 'UNDER_AGE'
        | 'CURRENCY_MISMATCH';
      readonly message: string;
      /** Present when the refusal is an allowance ceiling rather than a missing field. */
      readonly remainingMinorUnits?: bigint;
    };

export interface DeclarationInput {
  readonly regime: ExchangeControlRegime;
  readonly amount: Money<CurrencyCode>;
  readonly categoryCode: string | null;
  readonly usage: AllowanceUsage;
  /** Tax compliance reference, where the allowance requires one. */
  readonly taxClearanceRef?: string | null;
  /** The sender's age in whole years, for the adult-allowance test. */
  readonly senderAgeYears?: number | null;
}

/**
 * The gate.
 *
 * Fails closed on every branch: a missing category, an unknown code, an
 * unconfigured allowance, a missing tax clearance and an unknown age are all
 * refusals rather than defaults. The one thing it will not do is approve a
 * payment because our own records happen to look clear.
 */
export function checkDeclaration(input: DeclarationInput): DeclarationDecision {
  const { regime, amount, categoryCode, usage } = input;

  if (amount.currency !== regime.currency) {
    return {
      allowed: false,
      reason: 'CURRENCY_MISMATCH',
      message: `${regime.country} exchange control governs ${regime.currency}, not ${amount.currency}`,
    };
  }

  if (categoryCode === null || categoryCode.trim() === '') {
    return {
      allowed: false,
      reason: 'CATEGORY_REQUIRED',
      message: `A payment from ${regime.countryName} must state its reason under a ${regime.authority} category`,
    };
  }

  const category = categoryIn(regime, categoryCode);
  if (category === undefined) {
    return {
      allowed: false,
      reason: 'CATEGORY_UNKNOWN',
      message: `${categoryCode} is not a category this regime publishes`,
    };
  }

  // An age we were not given is not an age that passes. A minor's allowance is
  // lower and is not modelled here, so the safe answer is to refuse rather than
  // to grant the adult figure to somebody whose age we never captured.
  const age = input.senderAgeYears;
  if (age === null || age === undefined || age < regime.adultAgeYears) {
    return {
      allowed: false,
      reason: 'UNDER_AGE',
      message:
        `The ${category.allowance.toLowerCase()} allowance applies from age ` +
        `${regime.adultAgeYears}. A lower allowance exists and is not yet supported.`,
    };
  }

  const allowance = allowanceIn(regime, category.allowance);
  if (allowance === undefined) {
    return {
      allowed: false,
      reason: 'ALLOWANCE_NOT_CONFIGURED',
      message: `No ${category.allowance} allowance is configured for ${regime.country}`,
    };
  }

  if (allowance.requiresTaxClearance) {
    const ref = input.taxClearanceRef;
    if (ref === null || ref === undefined || ref.trim() === '') {
      return {
        allowed: false,
        reason: 'TAX_CLEARANCE_REQUIRED',
        message: 'This allowance requires a valid tax compliance status reference',
      };
    }
  }

  const used = totalUsed(usage);
  const remaining = allowance.annualMinorUnits - used;
  if (amount.minorUnits > remaining) {
    return {
      allowed: false,
      reason: 'ALLOWANCE_EXCEEDED',
      message:
        `This payment would exceed the ${category.allowance.toLowerCase()} allowance for the ` +
        'calendar year. The allowance is personal and counts payments made through every ' +
        'provider, not only this one.',
      remainingMinorUnits: remaining > 0n ? remaining : 0n,
    };
  }

  return { allowed: true, category, remainingMinorUnits: remaining - amount.minorUnits };
}

/**
 * The calendar year an allowance is measured over, in UTC.
 *
 * A calendar year and not a rolling window: that is how the allowance is
 * published, and a rolling twelve months would be the more generous reading in
 * December and the stricter one in January — wrong in both directions.
 */
export function allowanceYearBounds(at: Date): { start: Date; end: Date } {
  const year = at.getUTCFullYear();
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  };
}
