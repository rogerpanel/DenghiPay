import { CountryCode, PayinMethod, PayoutMethod } from '../corridors/corridor';
import { CurrencyCode } from '../money/currency';
import { Money } from '../money/money';
import { TransferState } from './state-machine';

/**
 * Recipient details, discriminated by payout method.
 *
 * Nigeria settles to a bank account over NIP and needs a name enquiry before
 * the sender commits. Ghana settles to a mobile-money wallet and needs the
 * network resolved from the MSISDN. They are different shapes, so they are
 * different types rather than one type with optional fields.
 */
export type RecipientDetails =
  | {
      readonly method: 'BANK_ACCOUNT';
      readonly country: CountryCode;
      readonly accountNumber: string;
      readonly bankCode: string;
      /** Name the sender typed. Compared against the name enquiry result. */
      readonly declaredName: string;
    }
  | {
      readonly method: 'MOBILE_MONEY';
      readonly country: CountryCode;
      /** E.164 without the leading '+', e.g. 233241234567. */
      readonly msisdn: string;
      readonly network: 'MTN' | 'TELECEL' | 'AIRTELTIGO';
      readonly declaredName: string;
    };

export function recipientMethod(details: RecipientDetails): PayoutMethod {
  return details.method;
}

/** Masked for display and for anything that might reach a log. */
export function maskRecipientAccount(details: RecipientDetails): string {
  const raw = details.method === 'BANK_ACCOUNT' ? details.accountNumber : details.msisdn;
  if (raw.length <= 4) return '*'.repeat(raw.length);
  return `${'*'.repeat(raw.length - 4)}${raw.slice(-4)}`;
}

/**
 * The purpose codes we accept. Guardrail G2 — personal, non-commercial
 * remittances only. Anything commercial is rejected at the API boundary rather
 * than modelled.
 */
export const TRANSFER_PURPOSES = [
  'FAMILY_SUPPORT',
  'EDUCATION',
  'MEDICAL',
  'GIFT',
  'OWN_ACCOUNT',
] as const;

export type TransferPurpose = (typeof TRANSFER_PURPOSES)[number];

export function isPersonalPurpose(value: unknown): value is TransferPurpose {
  return typeof value === 'string' && (TRANSFER_PURPOSES as readonly string[]).includes(value);
}

export interface TransferSnapshot<
  Src extends CurrencyCode = CurrencyCode,
  Dst extends CurrencyCode = CurrencyCode,
> {
  readonly id: string;
  readonly reference: string;
  readonly senderId: string;
  readonly corridorId: string;
  readonly state: TransferState;
  readonly purpose: TransferPurpose;
  readonly sendAmount: Money<Src>;
  readonly totalToPay: Money<Src>;
  readonly recipientAmount: Money<Dst>;
  readonly recipient: RecipientDetails;
  readonly payinMethod: PayinMethod;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A human-quotable reference. Deliberately not sequential: a customer reading
 * it over the phone should not reveal our volume.
 */
export function formatTransferReference(random: string): string {
  const cleaned = random
    .replace(/[^0-9A-Z]/gi, '')
    .toUpperCase()
    .slice(0, 8)
    .padEnd(8, '0');
  return `MP-${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
}
