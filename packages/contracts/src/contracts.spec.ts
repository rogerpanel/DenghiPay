import { describe, expect, it } from 'vitest';
import {
  createQuoteRequestSchema,
  createTransferRequestSchema,
  idempotencyKeySchema,
  moneySchema,
  passwordSchema,
  recipientDetailsSchema,
  registerRequestSchema,
  transferPurposeSchema,
} from './index';

/**
 * Contract tests.
 *
 * These schemas are the single definition of the wire format, imported by the
 * API and by both front ends. The previous generation of this product wrote
 * DTOs twice and they drifted — see ADR 0002. These tests pin the parts of the
 * shape that a well-meaning change could quietly loosen.
 */

describe('money on the wire', () => {
  it('carries minor units as a string, not a number', () => {
    const parsed = moneySchema.parse({
      amount: '1888590.00',
      currency: 'NGN',
      minorUnits: '188859000',
      formatted: '₦ 1 888 590.00',
    });
    expect(typeof parsed.minorUnits).toBe('string');
  });

  it('rejects a numeric minorUnits', () => {
    // A JSON number is a double, and a naira amount in kobo can exceed what a
    // double holds exactly (guardrail 12).
    expect(() =>
      moneySchema.parse({
        amount: '10.00',
        currency: 'NGN',
        minorUnits: 1000,
        formatted: '₦ 10.00',
      }),
    ).toThrow();
  });
});

describe('quote request', () => {
  it('accepts an integer minor-unit string', () => {
    expect(
      createQuoteRequestSchema.parse({ corridorId: 'RU-NG', sendMinorUnits: '10000000' })
        .sendMinorUnits,
    ).toBe('10000000');
  });

  it('rejects a decimal amount, so the server never has to guess precision', () => {
    expect(() =>
      createQuoteRequestSchema.parse({ corridorId: 'RU-NG', sendMinorUnits: '100000.50' }),
    ).toThrow();
    expect(() =>
      createQuoteRequestSchema.parse({ corridorId: 'RU-NG', sendMinorUnits: '-100' }),
    ).toThrow();
  });
});

describe('transfer purpose (guardrail G2)', () => {
  it('accepts only personal purposes', () => {
    for (const purpose of ['FAMILY_SUPPORT', 'EDUCATION', 'MEDICAL', 'GIFT', 'OWN_ACCOUNT']) {
      expect(transferPurposeSchema.parse(purpose)).toBe(purpose);
    }
  });

  it('has no commercial member — an invoice payment cannot be expressed', () => {
    expect(() => transferPurposeSchema.parse('INVOICE_SETTLEMENT')).toThrow();
    expect(() => transferPurposeSchema.parse('SUPPLIER_PAYMENT')).toThrow();
    expect(() => transferPurposeSchema.parse('SALARY')).toThrow();
  });
});

describe('recipient details', () => {
  it('validates a Nigerian NUBAN and bank code', () => {
    const details = recipientDetailsSchema.parse({
      method: 'BANK_ACCOUNT',
      country: 'NG',
      accountNumber: '0123456789',
      bankCode: '058',
      declaredName: 'ADEBAYO OKONKWO',
    });
    expect(details.method).toBe('BANK_ACCOUNT');
  });

  it('rejects a NUBAN that is not exactly ten digits', () => {
    const base = {
      method: 'BANK_ACCOUNT',
      country: 'NG',
      bankCode: '058',
      declaredName: 'ADEBAYO OKONKWO',
    };
    expect(() => recipientDetailsSchema.parse({ ...base, accountNumber: '012345678' })).toThrow();
    expect(() => recipientDetailsSchema.parse({ ...base, accountNumber: '01234567890' })).toThrow();
    expect(() => recipientDetailsSchema.parse({ ...base, accountNumber: 'abcdefghij' })).toThrow();
  });

  it('validates a Ghanaian MSISDN in E.164 without the plus', () => {
    expect(
      recipientDetailsSchema.parse({
        method: 'MOBILE_MONEY',
        country: 'GH',
        msisdn: '233241234567',
        network: 'MTN',
        declaredName: 'AMA MENSAH',
      }).country,
    ).toBe('GH');

    expect(() =>
      recipientDetailsSchema.parse({
        method: 'MOBILE_MONEY',
        country: 'GH',
        msisdn: '+233241234567',
        network: 'MTN',
        declaredName: 'AMA MENSAH',
      }),
    ).toThrow();
  });

  it('keeps the two shapes apart — a mobile-money recipient has no bank code', () => {
    expect(() =>
      recipientDetailsSchema.parse({
        method: 'MOBILE_MONEY',
        country: 'GH',
        accountNumber: '0123456789',
        bankCode: '058',
        declaredName: 'AMA MENSAH',
      }),
    ).toThrow();
  });
});

describe('transfer confirmation', () => {
  it('requires the confirmed recipient name', () => {
    // The sender confirms the name the institution returned, not the one they
    // typed (BUILD_PLAN 7.2).
    expect(() =>
      createTransferRequestSchema.parse({
        quoteId: 'q1',
        recipientId: 'r1',
        payinMethod: 'SBP',
        purpose: 'FAMILY_SUPPORT',
      }),
    ).toThrow();
  });
});

describe('idempotency key', () => {
  it('requires something long enough to be unique', () => {
    expect(idempotencyKeySchema.parse('a'.repeat(32))).toHaveLength(32);
    expect(() => idempotencyKeySchema.parse('short')).toThrow();
  });
});

describe('password policy', () => {
  it('requires twelve characters', () => {
    expect(() => passwordSchema.parse('short1234')).toThrow();
    expect(passwordSchema.parse('a-reasonable-passphrase')).toBeTruthy();
  });

  it('rejects the obvious ones and low-variety strings', () => {
    expect(() => passwordSchema.parse('password1234')).toThrow();
    expect(() => passwordSchema.parse('aaaaaaaaaaaaaa')).toThrow();
  });

  it('does not impose composition rules that push people to substitutions', () => {
    // NIST 800-63B: length and a rejection list beat "must contain a symbol".
    expect(passwordSchema.parse('correct horse battery staple')).toBeTruthy();
  });
});

describe('registration', () => {
  it('requires the terms to be accepted explicitly', () => {
    const base = {
      email: 'Person@Example.COM',
      password: 'a-reasonable-passphrase',
      residencyCountry: 'RU' as const,
    };
    expect(() => registerRequestSchema.parse({ ...base, acceptedTerms: false })).toThrow();
    expect(registerRequestSchema.parse({ ...base, acceptedTerms: true }).email).toBe(
      'person@example.com',
    );
  });

  it('accepts only residencies we have a data partition for', () => {
    expect(() =>
      registerRequestSchema.parse({
        email: 'a@b.com',
        password: 'a-reasonable-passphrase',
        acceptedTerms: true,
        residencyCountry: 'NG',
      }),
    ).toThrow();
  });
});
