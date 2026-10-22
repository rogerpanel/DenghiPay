import { loadConfig } from './config';

/**
 * Paycrest has no sandbox: every key it issues is a live key. These tests pin
 * the rules that keep a half-configured Paycrest from booting — and keep the
 * flag-off default exactly as inert as it was before the adapter existed.
 */

const BASE: Record<string, string> = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  ADMIN_JWT_ACCESS_SECRET: 'b'.repeat(32),
  QUOTE_SIGNING_SECRET: 'c'.repeat(32),
  FIELD_ENCRYPTION_KEY: 'd'.repeat(32),
  TOKENISATION_SALT: 'e'.repeat(32),
};

function load(overrides: Record<string, string>) {
  const saved = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) {
      if (/^(PAYCREST_|LIVE_FUNDS_|MAIL_)/.test(key) || key === 'NODE_ENV') delete process.env[key];
    }
    Object.assign(process.env, BASE, overrides);
    return loadConfig();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

const ENABLED = {
  PAYCREST_ENABLED: 'true',
  PAYCREST_API_KEY: 'k'.repeat(36),
  PAYCREST_API_SECRET: 's'.repeat(40),
  PAYCREST_REFUND_ADDRESS: '0x0000000000000000000000000000000000000001',
};

describe('Paycrest configuration', () => {
  it('is off, on v2, USDT on Base, with an empty institution table by default', () => {
    const config = load({});
    expect(config.PAYCREST_ENABLED).toBe(false);
    expect(config.PAYCREST_BASE_URL).toBe('https://api.paycrest.io/v2');
    expect(config.PAYCREST_TOKEN).toBe('USDT');
    expect(config.PAYCREST_NETWORK).toBe('base');
    // Blank: the confirmed table in adapters/paycrest/institutions.ts applies.
    expect(config.PAYCREST_INSTITUTIONS).toBe('');
  });

  it('cleans a base URL pasted with an invisible byte-order mark', () => {
    expect(load({ PAYCREST_BASE_URL: '\ufeffhttps://api.paycrest.io/v2' }).PAYCREST_BASE_URL).toBe(
      'https://api.paycrest.io/v2',
    );
  });

  it('refuses to boot on a base URL that is not https', () => {
    expect(() => load({ PAYCREST_BASE_URL: 'http://api.paycrest.io/v2' })).toThrow(
      /PAYCREST_BASE_URL/,
    );
  });

  it('treats the blank base URL in .env.example as the default', () => {
    expect(load({ PAYCREST_BASE_URL: '' }).PAYCREST_BASE_URL).toBe('https://api.paycrest.io/v2');
  });

  it('boots with the flag on when key, secret and refund address are all set', () => {
    expect(load(ENABLED).PAYCREST_ENABLED).toBe(true);
  });

  it.each(['PAYCREST_API_KEY', 'PAYCREST_API_SECRET', 'PAYCREST_REFUND_ADDRESS'])(
    'refuses to boot with the flag on and %s missing',
    (key) => {
      expect(() => load({ ...ENABLED, [key]: '' })).toThrow(new RegExp(key));
    },
  );

  it('treats the .env.example placeholder as missing', () => {
    expect(() => load({ ...ENABLED, PAYCREST_API_KEY: 'replace-in-vault' })).toThrow(
      /PAYCREST_API_KEY/,
    );
  });

  it('rejects a token or network Paycrest does not offer', () => {
    expect(() => load({ PAYCREST_TOKEN: 'DAI' })).toThrow(/PAYCREST_TOKEN/);
    expect(() => load({ PAYCREST_NETWORK: 'base-sepolia' })).toThrow(/PAYCREST_NETWORK/);
  });

  it('boots with a broken institution table while the flag is off, and refuses once it is on', () => {
    const warn = jest.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    try {
      expect(load({ PAYCREST_INSTITUTIONS: '{"bank":' }).PAYCREST_ENABLED).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not valid JSON.*Ignored/));
      expect(() => load({ ...ENABLED, PAYCREST_INSTITUTIONS: '{"bank":' })).toThrow(
        /not valid JSON/,
      );
      expect(() =>
        load({ ...ENABLED, PAYCREST_INSTITUTIONS: '{"bank":{"GH":{"1":"X"}}}' }),
      ).toThrow(/does not pay out/);
    } finally {
      warn.mockRestore();
    }
    expect(
      load({ PAYCREST_INSTITUTIONS: '{"bank":{"NG":{"058":"GTBINGLA"}}}' }).PAYCREST_INSTITUTIONS,
    ).toContain('GTBINGLA');
  });
});
