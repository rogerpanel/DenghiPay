import { describe, expect, it } from 'vitest';
import {
  Money,
  RecipientDetails,
  asCorridorId,
  asIdempotencyKey,
  asProviderRef,
} from '@morapay/domain';
import {
  PayoutSimulator,
  createBeninPayoutSimulator,
  createCameroonPayoutSimulator,
  createGhanaPayoutSimulator,
  createNigeriaPayoutSimulator,
  createSouthAfricaPayoutSimulator,
  institutionsForDestination,
} from './payout.simulator';
import {
  PayinSimulator,
  createBeninPayinSimulator,
  createCameroonPayinSimulator,
  createGhanaPayinSimulator,
  createNigeriaPayinSimulator,
  createRussiaPayinSimulator,
} from './payin.simulator';
import { MockScreeningProvider, similarity } from './screening.mock';
import { MockKycProvider } from './kyc.mock';
import { SimulatedRateSource } from './rate-source.simulated';
import { SCENARIOS, scenarioFor } from './scenarios';
import { ProviderRegistry } from '../registry';

const RU_NG = asCorridorId('RU-NG');
const RU_GH = asCorridorId('RU-GH');

function ngRecipient(accountNumber: string): RecipientDetails {
  return {
    method: 'BANK_ACCOUNT',
    country: 'NG',
    accountNumber,
    bankCode: '058',
    declaredName: 'ADEBAYO OKONKWO',
  };
}

function ghRecipient(msisdn: string): RecipientDetails {
  return {
    method: 'MOBILE_MONEY',
    country: 'GH',
    msisdn,
    network: 'MTN',
    declaredName: 'AMA MENSAH',
  };
}

async function submit(sim: PayoutSimulator, recipient: RecipientDetails, key = 'k1') {
  return sim.initiatePayout(
    {
      corridorId: RU_NG,
      recipient,
      amount: Money.fromDecimalString('1862861.55', 'NGN'),
      reference: 'MP-TEST-0001',
      narration: 'Family support',
    },
    asIdempotencyKey(key),
  );
}

describe('payout simulator — name enquiry (BUILD_PLAN 7.2)', () => {
  const sim = createNigeriaPayoutSimulator([RU_NG]);

  it('resolves a name the sender can confirm before committing', async () => {
    const result = await sim.resolveRecipient({
      corridorId: RU_NG,
      recipient: ngRecipient('0123456789'),
    });
    expect(result._tag).toBe('RESOLVED');
    if (result._tag === 'RESOLVED') {
      expect(result.resolvedName).toMatch(/^[A-Z ]+$/);
      expect(result.institution).toBe('Guaranty Trust Bank');
    }
  });

  it('is deterministic — the same account always resolves to the same person', async () => {
    const a = await sim.resolveRecipient({
      corridorId: RU_NG,
      recipient: ngRecipient('0123456789'),
    });
    const b = await sim.resolveRecipient({
      corridorId: RU_NG,
      recipient: ngRecipient('0123456789'),
    });
    expect(a).toEqual(b);
  });

  it('reports NOT_FOUND for the mistyped-account scenario', async () => {
    const result = await sim.resolveRecipient({
      corridorId: RU_NG,
      recipient: ngRecipient('0123450000'),
    });
    expect(result._tag).toBe('NOT_FOUND');
  });

  it('reports UNSUPPORTED for an unknown bank code', async () => {
    const result = await sim.resolveRecipient({
      corridorId: RU_NG,
      recipient: { ...ngRecipient('0123456789'), bankCode: '999' },
    });
    expect(result._tag).toBe('UNSUPPORTED');
  });

  it('validates Ghanaian MSISDNs and networks', async () => {
    const gh = createGhanaPayoutSimulator([RU_GH]);
    const good = await gh.resolveRecipient({
      corridorId: RU_GH,
      recipient: ghRecipient('233241234567'),
    });
    expect(good._tag).toBe('RESOLVED');

    const badNumber = await gh.resolveRecipient({
      corridorId: RU_GH,
      recipient: ghRecipient('07123456789'),
    });
    expect(badNumber._tag).toBe('NOT_FOUND');

    const badNetwork = await gh.resolveRecipient({
      corridorId: RU_GH,
      recipient: { ...ghRecipient('233241234567'), network: 'VODAFONE' as never },
    });
    expect(badNetwork._tag).toBe('UNSUPPORTED');
  });
});

describe('payout simulator — the FreshPay failure catalogue', () => {
  it('acknowledges without settling anything', async () => {
    const sim = createNigeriaPayoutSimulator([RU_NG]);
    const ack = await submit(sim, ngRecipient('0123456789'));
    expect(ack._tag).toBe('ACKNOWLEDGED');
    // The type system already prevents this being mistaken for an outcome;
    // this asserts the runtime shape matches.
    expect(ack).not.toHaveProperty('settledAt');
  });

  it('acknowledges, then fails — the Status/Trans_Status pair', async () => {
    const sim = createNigeriaPayoutSimulator([RU_NG]);
    const ack = await submit(sim, ngRecipient('0123451111'));
    expect(ack._tag).toBe('ACKNOWLEDGED');

    const outcome = await sim.getStatus(ack.providerRef);
    expect(outcome._tag).toBe('FAILED');
    if (outcome._tag === 'FAILED') {
      expect(outcome.retryable).toBe(false);
      expect(outcome.code).toBe('DEBIT_FAILED');
    }
  });

  it('stays pending across several polls before settling', async () => {
    const sim = createNigeriaPayoutSimulator([RU_NG]);
    const ack = await submit(sim, ngRecipient('0123452222'));
    expect((await sim.getStatus(ack.providerRef))._tag).toBe('PENDING');
    expect((await sim.getStatus(ack.providerRef))._tag).toBe('PENDING');
    expect((await sim.getStatus(ack.providerRef))._tag).toBe('SETTLED');
  });

  it('refuses a float amount at the boundary instead of propagating it', async () => {
    const sim = createNigeriaPayoutSimulator([RU_NG]);
    const ack = await submit(sim, ngRecipient('0123455555'));
    const outcome = await sim.getStatus(ack.providerRef);
    expect(outcome._tag).toBe('FAILED');
    if (outcome._tag === 'FAILED') expect(outcome.code).toBe('PROVIDER_CONTRACT');
  });

  it('fails terminally on a closed account', async () => {
    const sim = createNigeriaPayoutSimulator([RU_NG]);
    const ack = await submit(sim, ngRecipient('0123456666'));
    const outcome = await sim.getStatus(ack.providerRef);
    expect(outcome._tag).toBe('FAILED');
    if (outcome._tag === 'FAILED') expect(outcome.retryable).toBe(false);
  });

  it('plans duplicate, out-of-order deliveries for the duplicate scenario', async () => {
    const sim = createNigeriaPayoutSimulator([RU_NG]);
    const ack = await submit(sim, ngRecipient('0123453333'));
    expect(sim.callbackPlanFor(ack.providerRef)).toEqual({ deliveries: 3, outOfOrder: true });
  });

  it('sends no callback at all for the dropped-webhook scenario', async () => {
    const sim = createNigeriaPayoutSimulator([RU_NG]);
    const ack = await submit(sim, ngRecipient('0123454444'));
    expect(sim.callbackPlanFor(ack.providerRef).deliveries).toBe(0);
    // ...and the transfer still reaches a terminal state through polling alone.
    expect((await sim.getStatus(ack.providerRef))._tag).toBe('SETTLED');
  });

  it('is idempotent: the same key never creates a second payout', async () => {
    const sim = createNigeriaPayoutSimulator([RU_NG]);
    const first = await submit(sim, ngRecipient('0123456789'), 'same-key');
    const second = await submit(sim, ngRecipient('0123456789'), 'same-key');
    expect(second.providerRef).toBe(first.providerRef);
  });

  it('returns FAILED for an unknown reference rather than throwing', async () => {
    const sim = createNigeriaPayoutSimulator([RU_NG]);
    const outcome = await sim.getStatus(asProviderRef('NOPE'));
    expect(outcome._tag).toBe('FAILED');
  });

  it('parses a callback into a trigger and ignores both status fields', async () => {
    const sim = createNigeriaPayoutSimulator([RU_NG]);
    const ack = await submit(sim, ngRecipient('0123451111'));
    await sim.getStatus(ack.providerRef); // make it fail
    const { body, eventId } = sim.buildCallbackBody(ack.providerRef);

    // The body says Status: Success and Trans_Status: Failed, exactly as
    // FreshPay's §6.2 example does.
    expect(body).toContain('"Status":"Success"');
    expect(body).toContain('"Trans_Status":"Failed"');

    const trigger = await sim.parseCallback({
      rawBody: Buffer.from(body),
      timestamp: '1786579200',
      headers: {},
    });
    expect(trigger._tag).toBe('TRIGGER');
    expect(trigger.eventId).toBe(eventId);
    expect(trigger).not.toHaveProperty('status');
  });

  it('refuses a callback with no event id — it could not be replay-protected', async () => {
    const sim = createNigeriaPayoutSimulator([RU_NG]);
    await expect(
      sim.parseCallback({
        rawBody: Buffer.from(JSON.stringify({ provider_ref: 'X' })),
        timestamp: '1786579200',
        headers: {},
      }),
    ).rejects.toThrow(/event id/);
  });

  it('reports settled payouts on the statement', async () => {
    const sim = createNigeriaPayoutSimulator([RU_NG]);
    const ack = await submit(sim, ngRecipient('0123456789'));
    await sim.getStatus(ack.providerRef);
    const lines = await sim.fetchStatement({
      start: new Date(Date.now() - 60_000),
      end: new Date(Date.now() + 60_000),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.providerRef).toBe(ack.providerRef);
  });
});

describe('scenario selection', () => {
  it('maps identifier suffixes to scenarios', () => {
    expect(scenarioFor('0123456789')).toBe(SCENARIOS.HAPPY);
    expect(scenarioFor('0123450000')).toBe(SCENARIOS.NAME_NOT_FOUND);
    expect(scenarioFor('233241234567')).toBe(SCENARIOS.HAPPY);
    expect(scenarioFor('233241111111')).toBe(SCENARIOS.ACK_THEN_FAIL);
  });
});

describe('pay-in simulator', () => {
  const corridors = [RU_NG];

  async function initiate(
    sim: PayinSimulator,
    method: 'SBP' | 'QR' | 'VIRTUAL_ACCOUNT' | 'CARD' = 'SBP',
  ) {
    return sim.initiatePayin(
      {
        corridorId: RU_NG,
        method,
        amount: Money.fromDecimalString('100150.00', 'RUB'),
        reference: 'MP-TEST-0001',
        senderToken: 'tok_sender_1',
      },
      asIdempotencyKey(`payin-${method}`),
    );
  }

  it('returns instructions the sender can act on, and no receipt of funds', async () => {
    const sim = createRussiaPayinSimulator(corridors, { autoConfirmAfterSeconds: null });
    const ack = await initiate(sim);
    expect(ack._tag).toBe('ACKNOWLEDGED');
    expect(ack.instructions.kind).toBe('SBP');
    if (ack.instructions.kind === 'SBP') {
      expect(ack.instructions.deepLink).toContain('qr.nspk.ru');
    }
    expect((await sim.getStatus(ack.providerRef))._tag).toBe('PENDING');
  });

  it('models every pay-in method', async () => {
    const sim = createRussiaPayinSimulator(corridors, { autoConfirmAfterSeconds: null });
    expect((await initiate(sim, 'QR')).instructions.kind).toBe('QR');
    expect((await initiate(sim, 'CARD')).instructions.kind).toBe('CARD');
    expect((await initiate(sim, 'VIRTUAL_ACCOUNT')).instructions.kind).toBe('VIRTUAL_ACCOUNT');
  });

  it('settles once the sender pays, reporting the amount received', async () => {
    const sim = createRussiaPayinSimulator(corridors, { autoConfirmAfterSeconds: null });
    const ack = await initiate(sim);
    expect(sim.markPaid(ack.providerRef)).toBe(true);

    const outcome = await sim.getStatus(ack.providerRef);
    expect(outcome._tag).toBe('SETTLED');
    if (outcome._tag === 'SETTLED') {
      expect(outcome.receivedMinorUnits).toBe(10_015_000n);
      expect(outcome.institutionRef).toMatch(/^SBP-/);
    }
  });

  it('does not settle twice', async () => {
    const sim = createRussiaPayinSimulator(corridors, { autoConfirmAfterSeconds: null });
    const ack = await initiate(sim);
    expect(sim.markPaid(ack.providerRef)).toBe(true);
    expect(sim.markPaid(ack.providerRef)).toBe(false);
  });

  it('models a declined pay-in', async () => {
    const sim = createRussiaPayinSimulator(corridors, { autoConfirmAfterSeconds: null });
    const ack = await initiate(sim);
    expect(sim.markFailed(ack.providerRef)).toBe(true);
    const outcome = await sim.getStatus(ack.providerRef);
    expect(outcome._tag).toBe('FAILED');
    if (outcome._tag === 'FAILED') expect(outcome.retryable).toBe(true);
  });

  it('is idempotent under a repeated key', async () => {
    const sim = createRussiaPayinSimulator(corridors, { autoConfirmAfterSeconds: null });
    const a = await initiate(sim);
    const b = await initiate(sim);
    expect(b.providerRef).toBe(a.providerRef);
  });
});

/**
 * The collection side of the intra-African corridors. Nigeria and Ghana collect
 * by different mechanisms — one waits to be pushed to, the other asks to pull —
 * and the difference is visible in what the sender is told to do.
 */
describe('pay-in simulator, intra-African markets', () => {
  const NG_GH = asCorridorId('NG-GH');
  const GH_NG = asCorridorId('GH-NG');

  it('gives a Nigerian sender a ten-digit NUBAN to push to', async () => {
    const sim = createNigeriaPayinSimulator([NG_GH], { autoConfirmAfterSeconds: null });
    const ack = await sim.initiatePayin(
      {
        corridorId: NG_GH,
        method: 'VIRTUAL_ACCOUNT',
        amount: Money.fromDecimalString('50000.00', 'NGN'),
        reference: 'MP-TEST-NGGH',
        senderToken: 'tok_sender_ng',
      },
      asIdempotencyKey('payin-ng-1'),
    );
    expect(ack.instructions.kind).toBe('VIRTUAL_ACCOUNT');
    if (ack.instructions.kind === 'VIRTUAL_ACCOUNT') {
      expect(ack.instructions.accountNumber).toMatch(/^\d{10}$/);
    }

    sim.markPaid(ack.providerRef);
    const outcome = await sim.getStatus(ack.providerRef);
    expect(outcome._tag).toBe('SETTLED');
    if (outcome._tag === 'SETTLED') expect(outcome.institutionRef).toMatch(/^NIP-/);
  });

  it('sends a Ghanaian sender an approval prompt, with a USSD fallback', async () => {
    const sim = createGhanaPayinSimulator([GH_NG], { autoConfirmAfterSeconds: null });
    const ack = await sim.initiatePayin(
      {
        corridorId: GH_NG,
        method: 'MOBILE_MONEY',
        amount: Money.fromDecimalString('1000.00', 'GHS'),
        reference: 'MP-TEST-GHNG',
        senderToken: 'tok_sender_gh',
        payer: { method: 'MOBILE_MONEY', msisdn: '233241234567', network: 'MTN' },
      },
      asIdempotencyKey('payin-gh-1'),
    );
    expect(ack.instructions.kind).toBe('MOBILE_MONEY');
    if (ack.instructions.kind === 'MOBILE_MONEY') {
      expect(ack.instructions.msisdn).toBe('233241234567');
      expect(ack.instructions.ussdFallback).toBe('*170#');
    }

    sim.markPaid(ack.providerRef);
    const outcome = await sim.getStatus(ack.providerRef);
    expect(outcome._tag).toBe('SETTLED');
    if (outcome._tag === 'SETTLED') expect(outcome.institutionRef).toMatch(/^GHIPSS-/);
  });

  it('refuses a mobile-money pay-in with no wallet to debit', async () => {
    const sim = createGhanaPayinSimulator([GH_NG], { autoConfirmAfterSeconds: null });
    await expect(
      sim.initiatePayin(
        {
          corridorId: GH_NG,
          method: 'MOBILE_MONEY',
          amount: Money.fromDecimalString('100.00', 'GHS'),
          reference: 'MP-TEST-NOWALLET',
          senderToken: 'tok_sender_gh',
        },
        asIdempotencyKey('payin-gh-2'),
      ),
    ).rejects.toThrow(/needs the payer wallet/);
  });

  /**
   * Each market offers the rails it actually has. A Ghanaian collection cannot
   * be asked for over SBP, and saying so at the adapter boundary is cheaper
   * than discovering it as a provider error in production.
   */
  it('refuses a method its market does not run', async () => {
    const sim = createNigeriaPayinSimulator([NG_GH], { autoConfirmAfterSeconds: null });
    expect(sim.supportedMethods).toEqual(['VIRTUAL_ACCOUNT']);
    await expect(
      sim.initiatePayin(
        {
          corridorId: NG_GH,
          method: 'SBP',
          amount: Money.fromDecimalString('1000.00', 'NGN'),
          reference: 'MP-TEST-WRONGRAIL',
          senderToken: 'tok_sender_ng',
        },
        asIdempotencyKey('payin-ng-wrong'),
      ),
    ).rejects.toThrow(/does not support SBP/);
  });
});

describe('screening (guardrail G3)', () => {
  const provider = new MockScreeningProvider();

  it('clears an ordinary sender', async () => {
    const result = await provider.screen({
      kind: 'SENDER',
      subjectRef: 'tok_1',
      fullName: 'Amina Diallo',
      nationality: 'SN',
    });
    expect(result._tag).toBe('CLEAR');
  });

  it('hits on a designated person and reports the programme', async () => {
    const result = await provider.screen({
      kind: 'SENDER',
      subjectRef: 'tok_2',
      fullName: 'Viktor Alekseyevich Sokolov',
    });
    expect(result._tag).toBe('HIT');
    if (result._tag === 'HIT') {
      expect(result.topScore).toBeGreaterThanOrEqual(85);
      expect(result.matches[0]?.programme).toBe('RUSSIA-EO14024');
      expect(result.matches[0]?.list).toBe('OFAC_SDN');
    }
  });

  it('hits on a designated on-chain address (guardrail G4)', async () => {
    const result = await provider.screen({
      kind: 'COUNTERPARTY',
      subjectRef: 'tok_wallet',
      fullName: 'Liquidity provider wallet',
      accountIdentifier: '0x000000000000000000000000000000000000dEaD',
    });
    expect(result._tag).toBe('HIT');
  });

  it('lowers the score when the date of birth disagrees, without clearing the name', async () => {
    const result = await provider.screen({
      kind: 'SENDER',
      subjectRef: 'tok_3',
      fullName: 'Viktor Alekseyevich Sokolov',
      dateOfBirth: '1990-01-01',
    });
    expect(result._tag).toBe('HIT');
    if (result._tag === 'HIT') expect(result.topScore).toBeLessThan(85);
  });

  it('does not hit on a single shared forename', async () => {
    const result = await provider.screen({
      kind: 'SENDER',
      subjectRef: 'tok_4',
      fullName: 'Viktor Nnamdi Eze',
    });
    expect(result._tag).toBe('CLEAR');
  });

  it('records the list version on every result', async () => {
    const result = await provider.screen({ kind: 'SENDER', subjectRef: 't', fullName: 'Jane Doe' });
    expect(result.listVersion).toBe(await provider.listVersion());
  });

  it('scores name similarity sensibly', () => {
    expect(similarity('JOHN SMITH', 'JOHN SMITH')).toBe(100);
    expect(similarity('JOHN SMITH', 'JANE DOE')).toBe(0);
    expect(similarity('', 'JOHN')).toBe(0);
  });
});

describe('KYC (BUILD_PLAN 3.1, 3.3)', () => {
  const provider = new MockKycProvider();

  it('never asks a foreign national in Russia for an internal passport', () => {
    const tier2 = provider.requiredDocuments(2, 'RU');
    expect(tier2).toContain('PASSPORT');
    expect(tier2).toContain('MIGRATION_CARD');
    expect(tier2).toContain('RESIDENCE_REGISTRATION');
    expect(tier2).not.toContain('NATIONAL_ID');
  });

  it('asks for source of funds only at tier 3', () => {
    expect(provider.requiredDocuments(2, 'RU')).not.toContain('SOURCE_OF_FUNDS');
    expect(provider.requiredDocuments(3, 'RU')).toContain('SOURCE_OF_FUNDS');
  });

  it('requires nothing at tier 0', () => {
    expect(provider.requiredDocuments(0, 'RU')).toHaveLength(0);
  });

  it('completes onboarding with a non-Russian document set (DoD 3.3)', async () => {
    const decision = await provider.submit({
      subjectToken: 'tok_student',
      targetTier: 2,
      person: {
        firstName: 'Chidi',
        lastName: 'Okafor',
        dateOfBirth: '2002-05-14',
        nationality: 'NG',
      },
      documents: [
        { type: 'PASSPORT', storageKey: 's3://kyc/passport', issuingCountry: 'NG' },
        { type: 'MIGRATION_CARD', storageKey: 's3://kyc/migration' },
        { type: 'RESIDENCE_REGISTRATION', storageKey: 's3://kyc/registration' },
        { type: 'SELFIE', storageKey: 's3://kyc/selfie' },
      ],
    });
    expect(decision._tag).toBe('APPROVED');
    if (decision._tag === 'APPROVED') expect(decision.grantedTier).toBe(2);
  });

  it('accepts a student visa in place of a work permit at tier 3', async () => {
    const decision = await provider.submit({
      subjectToken: 'tok_student_3',
      targetTier: 3,
      person: {
        firstName: 'Chidi',
        lastName: 'Okafor',
        dateOfBirth: '2002-05-14',
        nationality: 'NG',
      },
      documents: [
        { type: 'PASSPORT', storageKey: 'k' },
        { type: 'MIGRATION_CARD', storageKey: 'k' },
        { type: 'RESIDENCE_REGISTRATION', storageKey: 'k' },
        { type: 'STUDENT_VISA', storageKey: 'k' },
        { type: 'SELFIE', storageKey: 'k' },
        { type: 'SOURCE_OF_FUNDS', storageKey: 'k' },
      ],
    });
    expect(decision._tag).toBe('APPROVED');
  });

  it('rejects an incomplete submission and names what is missing', async () => {
    const decision = await provider.submit({
      subjectToken: 'tok_incomplete',
      targetTier: 2,
      person: { firstName: 'A', lastName: 'B', dateOfBirth: '2000-01-01', nationality: 'GH' },
      documents: [{ type: 'PASSPORT', storageKey: 'k' }],
    });
    expect(decision._tag).toBe('REJECTED');
    if (decision._tag === 'REJECTED') {
      expect(decision.code).toBe('MISSING_DOCUMENTS');
      expect(decision.reason).toContain('MIGRATION_CARD');
    }
  });

  it('holds a case for manual review and lets an officer decide it', async () => {
    const decision = await provider.submit({
      subjectToken: 'tok_review',
      targetTier: 1,
      person: {
        firstName: 'Ada',
        lastName: 'Review',
        dateOfBirth: '1995-02-02',
        nationality: 'NG',
      },
      documents: [{ type: 'PASSPORT', storageKey: 'k' }],
    });
    expect(decision._tag).toBe('PENDING');
    const resolved = provider.resolvePending(decision.providerRef, true, 1);
    expect(resolved._tag).toBe('APPROVED');
    expect((await provider.getDecision(decision.providerRef))._tag).toBe('APPROVED');
  });

  it('returns a rejection for an unknown reference', async () => {
    expect((await provider.getDecision('nope'))._tag).toBe('REJECTED');
  });
});

describe('rate source', () => {
  it('reports a rate anchored to the reference deck numbers', async () => {
    const source = new SimulatedRateSource({ wobbleBps: 0 });
    const observation = await source.fetch('RUB', 'NGN');
    expect(observation.rate.toDecimalString()).toBe('18.9123');
    expect(observation.source).toBe('simulated');
  });

  it('can report a pair as stale so the quoting halt is demonstrable', async () => {
    const source = new SimulatedRateSource({ stalePairs: ['RUB:NGN'], staleAgeMs: 600_000 });
    const observation = await source.fetch('RUB', 'NGN');
    expect(Date.now() - observation.observedAt.getTime()).toBeGreaterThan(300_000);
  });

  it('throws for a pair it does not carry, rather than inventing one', async () => {
    const source = new SimulatedRateSource();
    await expect(source.fetch('GHS', 'RUB')).rejects.toThrow(/no rate/i);
  });

  it('keeps the wobble deterministic within a minute', async () => {
    const source = new SimulatedRateSource({ wobbleBps: 10 });
    const a = await source.fetch('RUB', 'NGN');
    const b = await source.fetch('RUB', 'NGN');
    expect(a.rate.equals(b.rate)).toBe(true);
  });

  it('carries the intra-African pair in both directions', async () => {
    const source = new SimulatedRateSource({ wobbleBps: 0 });
    const out = await source.fetch('NGN', 'GHS');
    const back = await source.fetch('GHS', 'NGN');
    expect(out.rate.toDecimalString()).toBe('0.007134021');
    expect(back.rate.toDecimalString()).toBe('140.1734');
  });

  /**
   * Sixteen ordered pairs are generated from one dollar-anchor table. If a
   * corridor exists with no rate behind it, quoting halts — so this asserts
   * coverage rather than any particular number.
   */
  it('quotes every intra-African corridor pair', async () => {
    const source = new SimulatedRateSource({ wobbleBps: 0 });
    const origins = ['NGN', 'GHS', 'XAF', 'XOF'] as const;
    const destinations = ['NGN', 'GHS', 'ZAR', 'XAF', 'XOF'] as const;
    let pairs = 0;
    for (const from of origins) {
      for (const to of destinations) {
        if (from === to) continue;
        const observation = await source.fetch(from, to);
        expect(observation.rate.numerator > 0n).toBe(true);
        pairs += 1;
      }
    }
    expect(pairs).toBe(16);
  });

  /**
   * XAF and XOF share the euro peg, so the cross is exactly one. That is a fact
   * about the peg and not a licence to treat the two as one currency — the
   * rate exists precisely so the conversion is an explicit, auditable step.
   */
  it('crosses the two CFA francs at par, in both directions', async () => {
    const source = new SimulatedRateSource({ wobbleBps: 0 });
    expect((await source.fetch('XAF', 'XOF')).rate.toDecimalString()).toBe('1.000000');
    expect((await source.fetch('XOF', 'XAF')).rate.toDecimalString()).toBe('1.000000');
  });

  /**
   * South Africa was receive-only when it was first added, so this asserted the
   * absence of a rate out of it. Exchange control (4.3c) made it an origin, so
   * the assertion is inverted: the rate must exist, in both directions, and a
   * currency that is genuinely not an origin must still be refused rather than
   * invented.
   */
  it('prices out of South Africa now that it is an origin, and still refuses one that is not', async () => {
    const source = new SimulatedRateSource({ wobbleBps: 0 });
    expect(Number((await source.fetch('ZAR', 'NGN')).rate.toDecimalString())).toBeGreaterThan(0);
    expect(Number((await source.fetch('NGN', 'ZAR')).rate.toDecimalString())).toBeGreaterThan(0);
    // The ruble is a send currency but not an intra-African one, and USDT is a
    // treasury instrument. Neither has a cross in this table.
    await expect(source.fetch('ZAR', 'USDT')).rejects.toThrow(/no rate/i);
  });

  /**
   * The two directions are separate observations, not one rate and its
   * reciprocal, because that is how they will arrive from a real feed — each
   * with its own spread. They should still round-trip to roughly the amount
   * you started with, or one of them is wrong by more than a spread.
   */
  it('round-trips a naira amount through a cedi and back, to within a percent', async () => {
    const source = new SimulatedRateSource({ wobbleBps: 0 });
    const out = await source.fetch('NGN', 'GHS');
    const back = await source.fetch('GHS', 'NGN');
    const start = Money.fromDecimalString('1000000.00', 'NGN');
    const returned = back.rate.convert(out.rate.convert(start, 'DOWN'), 'DOWN');
    const drift = start.minorUnits - returned.minorUnits;
    expect(drift >= 0n).toBe(true);
    expect(drift * 100n < start.minorUnits).toBe(true);
  });
});

describe('provider registry', () => {
  it('selects by corridor, then priority, and fails over when unhealthy', () => {
    const primary = createNigeriaPayoutSimulator([RU_NG]);
    const secondary = new PayoutSimulator('payout-ng-alt', [RU_NG], 'NG');
    const registry = new ProviderRegistry()
      .registerPayout({ provider: primary, priority: 10, enabled: true })
      .registerPayout({ provider: secondary, priority: 20, enabled: true });

    expect(registry.selectPayout(RU_NG)?.id).toBe(primary.id);
    registry.markUnhealthy(primary.id);
    expect(registry.selectPayout(RU_NG)?.id).toBe(secondary.id);
    registry.markHealthy(primary.id);
    expect(registry.selectPayout(RU_NG)?.id).toBe(primary.id);
  });

  it('keeps a disabled rail out of routing (guardrail G1)', () => {
    const contracted = createNigeriaPayoutSimulator([RU_NG]);
    const registry = new ProviderRegistry().registerPayout({
      provider: contracted,
      priority: 1,
      enabled: false,
    });
    expect(registry.selectPayout(RU_NG)).toBeNull();
  });

  it('resolves a provider by id, not by what routing would pick today', () => {
    const primary = createNigeriaPayoutSimulator([RU_NG]);
    const secondary = new PayoutSimulator('payout-ng-alt', [RU_NG], 'NG');
    const registry = new ProviderRegistry()
      .registerPayout({ provider: primary, priority: 10, enabled: true })
      .registerPayout({ provider: secondary, priority: 20, enabled: true });
    expect(registry.payoutById('payout-ng-alt')?.id).toBe(secondary.id);
    expect(registry.payoutById('nope')).toBeNull();
  });

  it('selects and describes pay-in providers too', () => {
    const payin = createRussiaPayinSimulator([RU_NG]);
    const registry = new ProviderRegistry().registerPayin({
      provider: payin,
      priority: 1,
      enabled: true,
    });
    expect(registry.selectPayin(RU_NG)?.id).toBe(payin.id);
    expect(registry.payinById(payin.id)?.id).toBe(payin.id);
    expect(registry.describe()).toHaveLength(1);
    expect(registry.selectPayin(asCorridorId('BY-GH'))).toBeNull();
  });
});

/**
 * The three markets added alongside the francophone corridors. What is being
 * checked is mostly that each market is treated as its own jurisdiction — its
 * own institutions, its own number format, its own switch — rather than as a
 * variation on Nigeria.
 */
describe('payout simulator — South Africa, Cameroon and Benin', () => {
  const NG_ZA = asCorridorId('NG-ZA');
  const NG_CM = asCorridorId('NG-CM');
  const NG_BJ = asCorridorId('NG-BJ');

  it('credits a South African bank by universal branch code', async () => {
    const za = createSouthAfricaPayoutSimulator([NG_ZA]);
    const result = await za.resolveRecipient({
      corridorId: NG_ZA,
      recipient: {
        method: 'BANK_ACCOUNT',
        country: 'ZA',
        accountNumber: '1234567890',
        bankCode: '470010',
        declaredName: 'THABO MOLEFE',
      },
    });
    expect(result._tag).toBe('RESOLVED');
    if (result._tag === 'RESOLVED') expect(result.institution).toBe('Capitec Bank');
  });

  it('rejects a Nigerian bank code presented to the South African rail', async () => {
    const za = createSouthAfricaPayoutSimulator([NG_ZA]);
    const result = await za.resolveRecipient({
      corridorId: NG_ZA,
      recipient: {
        method: 'BANK_ACCOUNT',
        country: 'ZA',
        accountNumber: '1234567890',
        bankCode: '058',
        declaredName: 'THABO MOLEFE',
      },
    });
    expect(result._tag).toBe('UNSUPPORTED');
  });

  it('resolves Cameroonian and Beninese wallets on their own operators', async () => {
    const cm = createCameroonPayoutSimulator([NG_CM]);
    const orange = await cm.resolveRecipient({
      corridorId: NG_CM,
      recipient: {
        method: 'MOBILE_MONEY',
        country: 'CM',
        msisdn: '237671234567',
        network: 'ORANGE',
        declaredName: 'MARIE NGONO',
      },
    });
    expect(orange._tag).toBe('RESOLVED');

    const bj = createBeninPayoutSimulator([NG_BJ]);
    const moov = await bj.resolveRecipient({
      corridorId: NG_BJ,
      recipient: {
        method: 'MOBILE_MONEY',
        country: 'BJ',
        msisdn: '22997123456',
        network: 'MOOV',
        declaredName: 'KOSSI DOSSOU',
      },
    });
    expect(moov._tag).toBe('RESOLVED');
  });

  /**
   * The same brand is a different licensee in each country. Telecel operates in
   * Ghana and not in Benin, and accepting it there would produce a payout that
   * is acknowledged and never arrives.
   */
  it('refuses a network that does not operate in the destination', async () => {
    const bj = createBeninPayoutSimulator([NG_BJ]);
    const result = await bj.resolveRecipient({
      corridorId: NG_BJ,
      recipient: {
        method: 'MOBILE_MONEY',
        country: 'BJ',
        msisdn: '22997123456',
        network: 'TELECEL' as never,
        declaredName: 'KOSSI DOSSOU',
      },
    });
    expect(result._tag).toBe('UNSUPPORTED');
    if (result._tag === 'UNSUPPORTED') expect(result.reason).toMatch(/does not operate in BJ/);
  });

  it('refuses a Ghanaian number presented to the Cameroonian rail', async () => {
    const cm = createCameroonPayoutSimulator([NG_CM]);
    const result = await cm.resolveRecipient({
      corridorId: NG_CM,
      recipient: {
        method: 'MOBILE_MONEY',
        country: 'CM',
        msisdn: '233241234567',
        network: 'MTN',
        declaredName: 'MARIE NGONO',
      },
    });
    expect(result._tag).toBe('NOT_FOUND');
  });

  it('serves the institutions of one destination at a time', () => {
    expect(institutionsForDestination('ZA').banks.map((b) => b.code)).toContain('470010');
    expect(institutionsForDestination('ZA').networks).toHaveLength(0);
    expect(institutionsForDestination('BJ').networks.map((n) => n.code)).toEqual([
      'MTN',
      'MOOV',
      'CELTIIS',
    ]);
    expect(institutionsForDestination('BJ').banks).toHaveLength(0);
  });

  it('stamps each market with its own switch reference on settlement', async () => {
    const cm = createCameroonPayoutSimulator([NG_CM]);
    const ack = await cm.initiatePayout(
      {
        corridorId: NG_CM,
        recipient: {
          method: 'MOBILE_MONEY',
          country: 'CM',
          msisdn: '237671234567',
          network: 'MTN',
          declaredName: 'MARIE NGONO',
        },
        amount: Money.fromDecimalString('50000', 'XAF'),
        reference: 'MP-TEST-NGCM',
        narration: 'Family support',
      },
      asIdempotencyKey('cm-1'),
    );
    const outcome = await cm.getStatus(ack.providerRef);
    expect(outcome._tag).toBe('SETTLED');
    if (outcome._tag === 'SETTLED') expect(outcome.institutionRef).toMatch(/^GIMAC-/);
  });
});

describe('pay-in simulator — the francophone markets', () => {
  const CM_NG = asCorridorId('CM-NG');
  const BJ_GH = asCorridorId('BJ-GH');

  it('collects whole CFA francs against a wallet prompt', async () => {
    const cm = createCameroonPayinSimulator([CM_NG], { autoConfirmAfterSeconds: null });
    const ack = await cm.initiatePayin(
      {
        corridorId: CM_NG,
        method: 'MOBILE_MONEY',
        amount: Money.fromDecimalString('50000', 'XAF'),
        reference: 'MP-TEST-CMNG',
        senderToken: 'tok_sender_cm',
        payer: { method: 'MOBILE_MONEY', msisdn: '237671234567', network: 'ORANGE' },
      },
      asIdempotencyKey('payin-cm-1'),
    );
    expect(ack.instructions.kind).toBe('MOBILE_MONEY');
    if (ack.instructions.kind === 'MOBILE_MONEY') {
      expect(ack.instructions.ussdFallback).toBe('#150#');
    }

    cm.markPaid(ack.providerRef);
    const outcome = await cm.getStatus(ack.providerRef);
    expect(outcome._tag).toBe('SETTLED');
    if (outcome._tag === 'SETTLED') {
      // Whole francs: 50 000 XAF is 50 000 minor units, not 5 000 000.
      expect(outcome.receivedMinorUnits).toBe(50_000n);
      expect(outcome.institutionRef).toMatch(/^GIMAC-/);
    }
  });

  it('gives each Beninese operator its own recovery code', async () => {
    const bj = createBeninPayinSimulator([BJ_GH], { autoConfirmAfterSeconds: null });
    const ack = await bj.initiatePayin(
      {
        corridorId: BJ_GH,
        method: 'MOBILE_MONEY',
        amount: Money.fromDecimalString('25000', 'XOF'),
        reference: 'MP-TEST-BJGH',
        senderToken: 'tok_sender_bj',
        payer: { method: 'MOBILE_MONEY', msisdn: '22997123456', network: 'MOOV' },
      },
      asIdempotencyKey('payin-bj-1'),
    );
    if (ack.instructions.kind === 'MOBILE_MONEY') {
      expect(ack.instructions.ussdFallback).toBe('*855#');
    }
  });
});

describe('provider registry — routing by destination', () => {
  /**
   * Name enquiry runs before a corridor is chosen, so it has to find a provider
   * by where the money is going. This is the replacement for the old trick of
   * inventing an RU corridor from the recipient's country.
   */
  it('finds the provider that serves a destination, whatever the origin', () => {
    const registry = new ProviderRegistry()
      .registerPayout({
        provider: createCameroonPayoutSimulator([asCorridorId('NG-CM'), asCorridorId('BJ-CM')]),
        priority: 100,
        enabled: true,
      })
      .registerPayout({
        provider: createSouthAfricaPayoutSimulator([asCorridorId('NG-ZA')]),
        priority: 100,
        enabled: true,
      });

    expect(String(registry.selectPayoutForDestination('CM')?.id)).toBe('payout-cm-sim');
    expect(String(registry.selectPayoutForDestination('ZA')?.id)).toBe('payout-za-sim');
    expect(registry.selectPayoutForDestination('GH')).toBeNull();
  });

  it('will not route to a rail that is registered but disabled', () => {
    const registry = new ProviderRegistry().registerPayout({
      provider: createBeninPayoutSimulator([asCorridorId('NG-BJ')]),
      priority: 100,
      enabled: false,
    });
    expect(registry.selectPayoutForDestination('BJ')).toBeNull();
  });
});
