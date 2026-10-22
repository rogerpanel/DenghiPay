import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Money,
  RecipientDetails,
  asCorridorId,
  asIdempotencyKey,
  asProviderRef,
} from '@morapay/domain';
import { ProviderContractViolation } from '../callback/signature';
import {
  FetchLike,
  PaycrestApiError,
  PaycrestClient,
  cleanPaycrestCredential,
  normalisePaycrestBaseUrl,
} from './client';
import { decimalToMinorUnits, fiatMinorForToken, formatMinorUnits, parseDecimal } from './decimal';
import { parseJsonExact } from './json';
import {
  PaycrestFundingInstruction,
  PaycrestFundingUnavailable,
  PaycrestOrderFunder,
  PaycrestPayoutProvider,
  PaycrestSignatureError,
  parsePaycrestInstitutions,
  verifyPaycrestSignature,
} from './paycrest.provider';

// ------------------------------------------------------------------ fakes

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Route = (call: Call) => { status?: number; body: string };

/** A Paycrest that answers from a table, and remembers everything it was asked. */
function fakePaycrest(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace('https://api.test/v2', '');
    const call: Call = {
      method: init.method,
      path,
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    };
    calls.push(call);
    const key = Object.keys(routes).find((k) => {
      const [method, prefix] = k.split(' ');
      return method === init.method && path.startsWith(prefix!);
    });
    if (key === undefined)
      return { status: 404, text: async () => '{"status":"error","message":"no route"}' };
    const { status = 200, body } = routes[key]!(call);
    return { status, text: async () => body };
  };
  return {
    calls,
    client: new PaycrestClient({ baseUrl: 'https://api.test/v2/', apiKey: 'test-key', fetch }),
  };
}

const ok = (data: string) => `{"status":"success","message":"ok","data":${data}}`;

/** A v2 off-ramp order as Paycrest returns it — every number a string. */
const order = (fields: Partial<Record<string, string>> = {}) => {
  const { institution = 'GTBINGLA', currency = 'NGN', ...top } = fields;
  return JSON.stringify({
    id: 'ord-1',
    status: 'initiated',
    amount: '12.656226',
    rate: '1580.25',
    senderFee: '0',
    transactionFee: '0.5',
    reference: 'payout:t-1',
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z',
    providerAccount: {
      network: 'base',
      receiveAddress: '0xreceive',
      validUntil: '2026-10-19T12:30:00Z',
      amountToTransfer: '13.156226',
      currency: 'USDT',
    },
    source: { type: 'crypto', currency: 'USDT', network: 'base', refundAddress: '0xrefund' },
    destination: {
      type: 'fiat',
      currency,
      recipient: {
        institution,
        accountIdentifier: '0123456789',
        accountName: 'ADA OKAFOR',
        memo: 'x',
      },
    },
    ...top,
  });
};

const INSTITUTIONS = parsePaycrestInstitutions(
  JSON.stringify({
    bank: { NG: { '058': 'GTBINGLA' } },
    mobileMoney: { KE: { MPESA: 'SAFAKEPC' }, UG: { MTN: 'TESTUGPC' } },
  }),
);

const NG_BANK: RecipientDetails = {
  method: 'BANK_ACCOUNT',
  country: 'NG',
  accountNumber: '0123456789',
  bankCode: '058',
  declaredName: 'ADA OKAFOR',
};

class RecordingFunder implements PaycrestOrderFunder {
  readonly available = true;
  readonly funded: PaycrestFundingInstruction[] = [];
  async fund(instruction: PaycrestFundingInstruction) {
    this.funded.push(instruction);
    return { txHash: '0xfund' };
  }
}

function provider(client: PaycrestClient, funder?: PaycrestOrderFunder) {
  return new PaycrestPayoutProvider({
    client,
    apiSecret: 'webhook-secret',
    token: 'USDT',
    network: 'base',
    refundAddress: '0xrefund',
    corridors: ['GH-NG', 'NG-KE', 'NG-GH', 'RU-NG', 'GH-UG', 'KE-TZ'].map(asCorridorId),
    institutions: INSTITUTIONS,
    funder,
    now: () => new Date('2026-10-19T12:00:05Z'),
  });
}

// ------------------------------------------------------------------ JSON and decimals

describe('parseJsonExact', () => {
  it('turns every number into the exact text the provider sent', () => {
    const parsed = parseJsonExact('{"a":0.1,"b":-12.50,"c":[1e3,7],"d":"0.3","e":true,"f":null}');
    expect(parsed).toEqual({ a: '0.1', b: '-12.50', c: ['1e3', '7'], d: '0.3', e: true, f: null });
  });

  it('leaves digits inside strings alone, including after escaped quotes', () => {
    expect(parseJsonExact('{"memo":"ref \\"42\\" 7.5","n":3}')).toEqual({
      memo: 'ref "42" 7.5',
      n: '3',
    });
  });
});

describe('Paycrest decimals', () => {
  it('converts exact decimals to minor units and refuses to round', () => {
    expect(decimalToMinorUnits('12.5', 2)).toBe(1250n);
    expect(decimalToMinorUnits('12.500', 2)).toBe(1250n);
    expect(decimalToMinorUnits('7', 6)).toBe(7_000_000n);
    expect(() => decimalToMinorUnits('12.505', 2)).toThrow(ProviderContractViolation);
    expect(() => decimalToMinorUnits('1e3', 2)).toThrow(ProviderContractViolation);
  });

  it('formats minor units with the currency’s own number of places', () => {
    expect(formatMinorUnits(12_661_000n, 6)).toBe('12.661000');
    expect(formatMinorUnits(5n, 2)).toBe('0.05');
    expect(formatMinorUnits(25_000n, 0)).toBe('25000');
  });

  it('recomputes delivered fiat from token and rate, rounding down', () => {
    // 12.656226 USDT at 1580.25 is ₦20,000.0011…, so ₦20,000.00.
    expect(fiatMinorForToken(12_656_226n, 6, parseDecimal('1580.25'), 2)).toBe(2_000_000n);
    // A zero-decimal currency counts whole shillings: 270.270271 USDT at 3,700 is USh 1,000,000.
    expect(fiatMinorForToken(270_270_271n, 6, parseDecimal('3700'), 0)).toBe(1_000_000n);
  });
});

// ------------------------------------------------------------------ client

describe('PaycrestClient', () => {
  it('authenticates with the API-Key header and reads the off-ramp side of a v2 quote', async () => {
    const { calls, client } = fakePaycrest({
      'GET /rates/': () => ({ body: ok('{"sell":{"rate":"1580.25","providerIds":["AbCdEfGh"]}}') }),
    });
    await expect(client.sellRate('base', 'USDT', '10', 'NGN')).resolves.toBe('1580.25');
    expect(calls[0]!.headers['API-Key']).toBe('test-key');
    expect(calls[0]!.path).toBe('/rates/base/USDT/10/NGN?side=sell');
  });

  it('reports no rate when nobody is quoting the off-ramp side', async () => {
    const { client } = fakePaycrest({
      'GET /rates/': () => ({ body: ok('{"buy":{"rate":"1600"}}') }),
    });
    await expect(client.sellRate('base', 'USDT', '10', 'NGN')).resolves.toBeNull();
  });

  it('reads Paycrest’s own decimal places for each currency', async () => {
    const { client } = fakePaycrest({
      'GET /currencies': () => ({
        body: ok('[{"code":"UGX","name":"Ugandan Shilling","decimals":0}]'),
      }),
    });
    await expect(client.currencies()).resolves.toEqual([
      { code: 'UGX', name: 'Ugandan Shilling', decimals: '0' },
    ]);
  });

  it('turns an error envelope into a PaycrestApiError without echoing it in the message', async () => {
    const { client } = fakePaycrest({
      'GET /sender/orders/': () => ({
        status: 404,
        body: '{"status":"error","message":"Order ADA OKAFOR not found"}',
      }),
    });
    const error = await client.getOrder('x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaycrestApiError);
    expect((error as PaycrestApiError).httpStatus).toBe(404);
    expect((error as Error).message).not.toContain('ADA');
  });

  it('rejects a body that is not JSON', async () => {
    const { client } = fakePaycrest({ 'GET /currencies': () => ({ status: 502, body: '<html>' }) });
    await expect(client.currencies()).rejects.toBeInstanceOf(PaycrestApiError);
  });

  it('lists institutions', async () => {
    const { client } = fakePaycrest({
      'GET /institutions/NGN': () => ({
        body: ok('[{"code":"GTBINGLA","name":"GTBank","type":"bank"}]'),
      }),
    });
    await expect(client.institutions('NGN')).resolves.toEqual([
      { code: 'GTBINGLA', name: 'GTBank', type: 'bank' },
    ]);
  });
});

// ------------------------------------------------------------------ provider

describe('PaycrestPayoutProvider — routing', () => {
  it('serves only corridors into the four Paycrest countries', () => {
    const { client } = fakePaycrest({});
    expect(provider(client).supportedCorridors.map(String)).toEqual([
      'GH-NG',
      'NG-KE',
      'RU-NG',
      'GH-UG',
      'KE-TZ',
    ]);
  });

  it('reports whether payouts can be funded', () => {
    const { client } = fakePaycrest({});
    expect(provider(client).canFundPayouts).toBe(false);
    expect(provider(client, new RecordingFunder()).canFundPayouts).toBe(true);
  });
});

describe('PaycrestPayoutProvider — resolveRecipient', () => {
  it('refuses an unmapped bank before asking Paycrest anything', async () => {
    const { calls, client } = fakePaycrest({});
    const result = await provider(client).resolveRecipient({
      corridorId: asCorridorId('GH-NG'),
      recipient: { ...NG_BANK, bankCode: '999' },
    });
    expect(result._tag).toBe('UNSUPPORTED');
    expect(calls).toHaveLength(0);
  });

  it('returns the name the institution holds', async () => {
    const { calls, client } = fakePaycrest({
      'POST /verify-account': () => ({ body: ok('"ADAEZE OKAFOR"') }),
    });
    const result = await provider(client).resolveRecipient({
      corridorId: asCorridorId('GH-NG'),
      recipient: NG_BANK,
    });
    expect(result).toEqual({
      _tag: 'RESOLVED',
      resolvedName: 'ADAEZE OKAFOR',
      institution: 'GTBINGLA',
    });
    expect(calls[0]!.body).toEqual({ institution: 'GTBINGLA', accountIdentifier: '0123456789' });
  });

  it('does not invent a name when Paycrest only says OK', async () => {
    const { client } = fakePaycrest({ 'POST /verify-account': () => ({ body: ok('"OK"') }) });
    const result = await provider(client).resolveRecipient({
      corridorId: asCorridorId('NG-KE'),
      recipient: {
        method: 'MOBILE_MONEY',
        country: 'KE',
        msisdn: '254712345678',
        network: 'MPESA' as never,
        declaredName: 'X',
      },
    });
    expect(result._tag).toBe('UNSUPPORTED');
  });

  it('maps a 4xx to NOT_FOUND and lets a 5xx propagate', async () => {
    const notFound = fakePaycrest({
      'POST /verify-account': () => ({ status: 400, body: '{"status":"error","message":"x"}' }),
    });
    expect(
      (
        await provider(notFound.client).resolveRecipient({
          corridorId: asCorridorId('GH-NG'),
          recipient: NG_BANK,
        })
      )._tag,
    ).toBe('NOT_FOUND');
    const down = fakePaycrest({
      'POST /verify-account': () => ({ status: 503, body: '{"status":"error","message":"x"}' }),
    });
    await expect(
      provider(down.client).resolveRecipient({
        corridorId: asCorridorId('GH-NG'),
        recipient: NG_BANK,
      }),
    ).rejects.toBeInstanceOf(PaycrestApiError);
  });
});

describe('PaycrestPayoutProvider — initiatePayout', () => {
  const request = {
    corridorId: asCorridorId('GH-NG'),
    recipient: NG_BANK,
    amount: Money.fromMinorUnits(2_000_000n, 'NGN'),
    reference: 'MP-1',
    narration: 'MoraPay MP-1',
  };

  it('refuses without a funding source, before sending anything', async () => {
    const { calls, client } = fakePaycrest({});
    await expect(
      provider(client).initiatePayout(request, asIdempotencyKey('payout:t-1')),
    ).rejects.toBeInstanceOf(PaycrestFundingUnavailable);
    expect(calls).toHaveLength(0);
  });

  it('creates one fiat-denominated order, funds exactly what Paycrest asks, and returns only an acknowledgement', async () => {
    const funder = new RecordingFunder();
    const { calls, client } = fakePaycrest({
      'GET /sender/orders?': () => ({ body: ok('{"total":0,"page":1,"pageSize":50,"orders":[]}') }),
      'POST /sender/orders': () => ({ body: ok(order()) }),
    });

    const ack = await provider(client, funder).initiatePayout(
      request,
      asIdempotencyKey('payout:t-1'),
    );

    expect(ack).toEqual({
      _tag: 'ACKNOWLEDGED',
      providerRef: 'ord-1',
      receivedAt: new Date('2026-10-19T12:00:05Z'),
    });
    // No rate lookup: the order is stated in naira and Paycrest converts.
    expect(calls.map((c) => `${c.method} ${c.path.split('?')[0]}`)).toEqual([
      'GET /sender/orders',
      'POST /sender/orders',
    ]);
    expect(calls[1]!.body).toEqual({
      amount: '20000.00',
      amountIn: 'fiat',
      reference: 'payout:t-1',
      source: { type: 'crypto', currency: 'USDT', network: 'base', refundAddress: '0xrefund' },
      destination: {
        type: 'fiat',
        currency: 'NGN',
        recipient: {
          institution: 'GTBINGLA',
          accountIdentifier: '0123456789',
          accountName: 'ADA OKAFOR',
          memo: 'MoraPay MP-1',
        },
      },
    });
    expect(funder.funded).toEqual([
      {
        orderId: 'ord-1',
        receiveAddress: '0xreceive',
        network: 'base',
        token: 'USDT',
        amountToTransfer: '13.156226',
        amountMinor: 13_156_226n,
        memo: null,
        validUntil: new Date('2026-10-19T12:30:00Z'),
      },
    ]);
  });

  it('states a zero-decimal currency in whole units', async () => {
    const { calls, client } = fakePaycrest({
      'GET /sender/orders?': () => ({ body: ok('{"orders":[]}') }),
      'POST /sender/orders': () => ({ body: ok(order({ currency: 'UGX' })) }),
    });
    await provider(client, new RecordingFunder()).initiatePayout(
      {
        ...request,
        corridorId: asCorridorId('GH-UG'),
        recipient: {
          method: 'MOBILE_MONEY',
          country: 'UG',
          msisdn: '256772123456',
          network: 'MTN',
          declaredName: 'X',
        },
        amount: Money.fromMinorUnits(1_000_000n, 'UGX'),
      },
      asIdempotencyKey('payout:t-3'),
    );
    const body = calls.find((c) => c.method === 'POST')!.body as {
      amount: string;
      destination: { currency: string };
    };
    // USh 1,000,000 — not 10,000.00, which is what a two-decimal assumption would send.
    expect(body.amount).toBe('1000000');
    expect(body.destination.currency).toBe('UGX');
  });

  it('refuses an unmapped network before asking Paycrest to create anything', async () => {
    const { calls, client } = fakePaycrest({
      'GET /sender/orders?': () => ({ body: ok('{"orders":[]}') }),
    });
    await expect(
      provider(client, new RecordingFunder()).initiatePayout(
        {
          ...request,
          corridorId: asCorridorId('NG-KE'),
          recipient: {
            method: 'MOBILE_MONEY',
            country: 'KE',
            msisdn: '254712345678',
            network: 'AIRTEL' as never,
            declaredName: 'X',
          },
          amount: Money.fromMinorUnits(100_000n, 'KES'),
        },
        asIdempotencyKey('payout:t-5'),
      ),
    ).rejects.toBeInstanceOf(ProviderContractViolation);
    expect(calls).toHaveLength(0);
  });

  it('refuses an order Paycrest returns without a receive address', async () => {
    const { client } = fakePaycrest({
      'GET /sender/orders?': () => ({ body: ok('{"orders":[]}') }),
      'POST /sender/orders': () => ({ body: ok(order({ providerAccount: undefined as never })) }),
    });
    await expect(
      provider(client, new RecordingFunder()).initiatePayout(
        request,
        asIdempotencyKey('payout:t-4'),
      ),
    ).rejects.toBeInstanceOf(ProviderContractViolation);
  });

  it('finds the existing order on a retry and neither creates nor funds another', async () => {
    const funder = new RecordingFunder();
    const { calls, client } = fakePaycrest({
      'GET /sender/orders?': () => ({ body: ok(`{"orders":[${order()}]}`) }),
    });
    const ack = await provider(client, funder).initiatePayout(
      request,
      asIdempotencyKey('payout:t-1'),
    );
    expect(String(ack.providerRef)).toBe('ord-1');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(funder.funded).toHaveLength(0);
  });

  it('refuses a payout in the wrong currency for the country', async () => {
    const { client } = fakePaycrest({});
    await expect(
      provider(client, new RecordingFunder()).initiatePayout(
        { ...request, amount: Money.fromMinorUnits(100n, 'GHS') },
        asIdempotencyKey('payout:t-2'),
      ),
    ).rejects.toBeInstanceOf(ProviderContractViolation);
  });
});

describe('PaycrestPayoutProvider — getStatus', () => {
  const statusOf = async (status: string) => {
    const { client } = fakePaycrest({
      'GET /sender/orders/': () => ({ body: ok(order({ status, txHash: '0xsettle' })) }),
    });
    return provider(client).getStatus(asProviderRef('ord-1'));
  };

  it('is SETTLED from the moment Paycrest confirms the recipient was paid', async () => {
    expect(await statusOf('validated')).toEqual({
      _tag: 'SETTLED',
      providerRef: 'ord-1',
      institutionRef: '0xsettle',
      settledAt: new Date('2026-10-19T12:00:00Z'),
    });
    expect((await statusOf('settling'))._tag).toBe('SETTLED');
    expect((await statusOf('settled'))._tag).toBe('SETTLED');
  });

  it('treats a provider’s claim to have paid as still pending', async () => {
    expect((await statusOf('fulfilled'))._tag).toBe('PENDING');
    expect((await statusOf('pending'))._tag).toBe('PENDING');
    expect((await statusOf('fulfilling'))._tag).toBe('PENDING');
  });

  it('waits for a refund to land before calling the payout failed', async () => {
    expect((await statusOf('refunding'))._tag).toBe('PENDING');
  });

  it('fails expired and refunded orders without retry', async () => {
    expect(await statusOf('expired')).toMatchObject({
      _tag: 'FAILED',
      code: 'PAYCREST_EXPIRED',
      retryable: false,
    });
    expect(await statusOf('REFUNDED')).toMatchObject({ _tag: 'FAILED', code: 'PAYCREST_REFUNDED' });
  });

  it('refuses to guess at a status it does not know', async () => {
    await expect(statusOf('teleported')).rejects.toBeInstanceOf(ProviderContractViolation);
  });
});

describe('PaycrestPayoutProvider — parseCallback', () => {
  const body = Buffer.from(
    '{"event":"payment_order.validated","webhookVersion":"2","data":{"id":"ord-1","status":"validated","amount":"12.5"}}',
  );
  const sign = (raw: Buffer) => createHmac('sha256', 'webhook-secret').update(raw).digest('hex');

  it('verifies the signature over the raw body and returns a trigger, never an outcome', async () => {
    const { client } = fakePaycrest({});
    const trigger = await provider(client).parseCallback({
      rawBody: body,
      timestamp: '',
      headers: { 'x-paycrest-signature': sign(body) },
    });
    expect(trigger).toEqual({
      _tag: 'TRIGGER',
      providerRef: 'ord-1',
      eventId: 'ord-1:payment_order.validated',
      observedAt: new Date('2026-10-19T12:00:05Z'),
    });
  });

  it('rejects a missing or altered signature', async () => {
    const { client } = fakePaycrest({});
    const p = provider(client);
    await expect(
      p.parseCallback({ rawBody: body, timestamp: '', headers: {} }),
    ).rejects.toBeInstanceOf(PaycrestSignatureError);
    const tampered = Buffer.from(body.toString().replace('12.5', '99.5'));
    await expect(
      p.parseCallback({
        rawBody: tampered,
        timestamp: '',
        headers: { 'X-Paycrest-Signature': sign(body) },
      }),
    ).rejects.toBeInstanceOf(PaycrestSignatureError);
  });

  it('accepts the header in upper case or with whitespace, as Paycrest’s guide requires', async () => {
    const { client } = fakePaycrest({});
    const trigger = await provider(client).parseCallback({
      rawBody: body,
      timestamp: '',
      headers: { 'X-Paycrest-Signature': ` ${sign(body).toUpperCase()} ` },
    });
    expect(String(trigger.providerRef)).toBe('ord-1');
  });

  it('compares signatures of any length without throwing', () => {
    expect(verifyPaycrestSignature('s', body, 'abcd')).toBe(false);
    expect(verifyPaycrestSignature('s', body, 'not hex')).toBe(false);
  });

  it('refuses a signed body with no order in it', async () => {
    const { client } = fakePaycrest({});
    const empty = Buffer.from('{"event":"ping"}');
    await expect(
      provider(client).parseCallback({
        rawBody: empty,
        timestamp: '',
        headers: { 'x-paycrest-signature': sign(empty) },
      }),
    ).rejects.toBeInstanceOf(ProviderContractViolation);
  });
});

describe('PaycrestPayoutProvider — fetchStatement', () => {
  it('lists settled orders in the window at the fiat they delivered, rounded down', async () => {
    const { client } = fakePaycrest({
      'GET /sender/orders?': () => ({
        body: ok(
          `{"orders":[${[
            order({
              id: 'in',
              status: 'validated',
              updatedAt: '2026-10-18T10:00:00Z',
              txHash: '0xa',
            }),
            order({ id: 'pending', status: 'pending', updatedAt: '2026-10-18T11:00:00Z' }),
            order({ id: 'late', status: 'settled', updatedAt: '2026-10-19T01:00:00Z' }),
          ].join(',')}]}`,
        ),
      }),
    });
    const lines = await provider(client).fetchStatement({
      start: new Date('2026-10-18T00:00:00Z'),
      end: new Date('2026-10-19T00:00:00Z'),
    });
    expect(lines).toHaveLength(1);
    expect(String(lines[0]!.providerRef)).toBe('in');
    expect(lines[0]!.amount.currency).toBe('NGN');
    expect(lines[0]!.amount.minorUnits).toBe(2_000_000n);
    expect(lines[0]!.institutionRef).toBe('0xa');
  });

  it('refuses to report an order paid out in a currency it does not serve', async () => {
    const { client } = fakePaycrest({
      'GET /sender/orders?': () => ({
        body: ok(
          `{"orders":[${order({ status: 'validated', updatedAt: '2026-10-18T10:00:00Z', currency: 'GHS' })}]}`,
        ),
      }),
    });
    await expect(
      provider(client).fetchStatement({
        start: new Date('2026-10-18T00:00:00Z'),
        end: new Date('2026-10-19T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(ProviderContractViolation);
  });
});

describe('parsePaycrestInstitutions', () => {
  it('accepts an empty table', () => {
    expect(parsePaycrestInstitutions('')).toEqual({ bank: {}, mobileMoney: {} });
  });

  it('refuses malformed or out-of-coverage entries at boot', () => {
    expect(() => parsePaycrestInstitutions('{')).toThrow(/not valid JSON/);
    expect(() => parsePaycrestInstitutions('{"banks":{}}')).toThrow(/unknown key/);
    expect(() => parsePaycrestInstitutions('{"bank":{"GH":{"1":"X"}}}')).toThrow(
      /does not pay out/,
    );
    expect(() => parsePaycrestInstitutions('{"bank":{"NG":{"058":""}}}')).toThrow(/Paycrest code/);
  });
});

describe('normalisePaycrestBaseUrl', () => {
  it('uses the v2 default when the value is blank or missing', () => {
    expect(normalisePaycrestBaseUrl(undefined)).toBe('https://api.paycrest.io/v2');
    expect(normalisePaycrestBaseUrl('')).toBe('https://api.paycrest.io/v2');
  });

  it('strips what a console paste leaves behind and nobody can see', () => {
    const clean = 'https://api.paycrest.io/v2';
    for (const pasted of [
      '\ufeffhttps://api.paycrest.io/v2',
      'https://api.paycrest.io/v2\r',
      '"https://api.paycrest.io/v2"',
      'https://api.paycrest\u00a0.io/v2/',
      'https://api.paycrest.io\u200b/v2 ',
    ]) {
      expect(normalisePaycrestBaseUrl(pasted)).toBe(clean);
    }
  });

  it('refuses anything that is not an https URL, showing the hidden characters', () => {
    expect(() => normalisePaycrestBaseUrl('http://api.paycrest.io/v2')).toThrow(/https/);
    expect(() => normalisePaycrestBaseUrl('https\uff1a//api.paycrest.io/v2')).toThrow(/\\uff1a|：/);
  });
});

describe('cleanPaycrestCredential', () => {
  it('drops what a console paste adds to a key, and nothing else', () => {
    expect(cleanPaycrestCredential('\ufeff79711dc9-4680\u200b-412a\r\n')).toBe(
      '79711dc9-4680-412a',
    );
    expect(cleanPaycrestCredential('"abc_DEF-123="')).toBe('abc_DEF-123=');
  });

  it('is what the client sends and what the webhook check signs with', async () => {
    const { calls, client } = (() => {
      const seen: Record<string, string>[] = [];
      const c = new PaycrestClient({
        apiKey: ' key-1\u200b\r',
        fetch: async (_url, init) => {
          seen.push(init.headers);
          return { status: 200, text: async () => ok('[]') };
        },
      });
      return { calls: seen, client: c };
    })();
    await client.currencies();
    expect(calls[0]!['API-Key']).toBe('key-1');
    const body = Buffer.from('{}');
    const sig = createHmac('sha256', 'secret').update(body).digest('hex');
    expect(verifyPaycrestSignature('\ufeffsecret\r', body, sig)).toBe(true);
  });
});
