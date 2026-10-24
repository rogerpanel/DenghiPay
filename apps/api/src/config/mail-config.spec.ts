import { loadConfig } from './config';

/**
 * Mail configuration is a money-safety concern, not a convenience.
 *
 * A deployment that accepts registrations and never sends a confirmation link
 * looks exactly like a healthy one: the request returns 201, the outbox row is
 * written, and nothing anywhere says the customer is stranded. That is the state
 * the demonstration server was in, and these tests pin the two rules that make
 * it impossible to reach by accident with real money involved.
 */

/** The secrets that have no defaults, because a weak secret must never be one. */
const BASE: Record<string, string> = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  ADMIN_JWT_ACCESS_SECRET: 'b'.repeat(32),
  QUOTE_SIGNING_SECRET: 'c'.repeat(32),
  FIELD_ENCRYPTION_KEY: 'd'.repeat(32),
  TOKENISATION_SALT: 'e'.repeat(32),
};

function withEnv(overrides: Record<string, string | undefined>): () => unknown {
  return () => {
    const saved = { ...process.env };
    try {
      // A clean slate: the developer's own .env must not decide the outcome.
      for (const key of Object.keys(process.env)) {
        if (/^(MAIL_|SMTP_|LIVE_FUNDS_)/.test(key) || key === 'NODE_ENV') delete process.env[key];
      }
      Object.assign(process.env, BASE, overrides);
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete process.env[key];
      }
      return loadConfig();
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  };
}

const SMTP = {
  MAIL_TRANSPORT: 'smtp',
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'user',
  SMTP_PASSWORD: 'password',
  MAIL_FROM: 'MoraPay <no-reply@morapay.test>',
};

/**
 * Live funds are only reachable in production — guardrail G1 refuses them
 * anywhere else, and that check runs before this one. So every case here sets
 * NODE_ENV too; without it the test would pass for the wrong reason.
 */
const LIVE = { LIVE_FUNDS_ENABLED: 'true', NODE_ENV: 'production' };

describe('live funds require deliverable mail', () => {
  it('refuses to boot with live funds on and nothing delivering', () => {
    expect(withEnv({ ...LIVE, MAIL_TRANSPORT: 'outbox' })).toThrow(/MAIL_TRANSPORT=outbox/);
  });

  it('refuses when the transport is simply absent', () => {
    // The default is `outbox`, so omitting it entirely is the same failure and
    // is the more likely way to reach it.
    expect(withEnv(LIVE)).toThrow(/MAIL_TRANSPORT=outbox/);
  });

  it('boots with live funds on when SMTP is configured', () => {
    expect(withEnv({ ...LIVE, ...SMTP })).not.toThrow();
  });

  it('still refuses live funds outside production, mail or no mail', () => {
    // G1 first. A deliverable mailbox is not a licence to move money.
    expect(withEnv({ LIVE_FUNDS_ENABLED: 'true', ...SMTP })).toThrow(/outside production/);
  });

  /**
   * A production demonstration with no mail provider is legitimate, which is
   * why the rule is tied to the funds gate and not to NODE_ENV. Getting this
   * backwards would make the demo unrunnable for no safety gain.
   */
  it('allows a production demonstration with no mail provider', () => {
    expect(withEnv({ NODE_ENV: 'production', MAIL_TRANSPORT: 'outbox' })).not.toThrow();
  });
});

describe('a transport pointed at nowhere is refused', () => {
  it.each(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'])('refuses smtp with no %s', (missing) => {
    expect(withEnv({ ...SMTP, [missing]: '' })).toThrow(new RegExp(missing));
  });

  it('refuses the placeholder From address', () => {
    // Mail from example.invalid is rejected or filed as spam by every receiver,
    // so it is worse than not sending: it looks like it worked.
    expect(withEnv({ ...SMTP, MAIL_FROM: 'no-reply@example.invalid' })).toThrow(/MAIL_FROM/);
  });
});
