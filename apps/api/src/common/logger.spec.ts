import { scrub, scrubString } from './logger';

/**
 * BUILD_PLAN 11.4 DoD: "Log-scrubbing test proves no PII field can reach
 * stdout."
 *
 * The payload below is deliberately the worst case — a real-shaped transfer
 * with a sender, a recipient, documents and credentials all in one object.
 */
describe('PII log scrubber (guardrail 9)', () => {
  const payload = {
    transferId: 'tr_123',
    reference: 'MP-4F2A-91BC',
    sender: {
      email: 'chidi.okafor@example.com',
      firstName: 'Chidi',
      lastName: 'Okafor',
      dateOfBirth: '2002-05-14',
      phone: '+7 916 123 45 67',
      nationality: 'NG',
      address: { addressLine: 'ul. Tverskaya 7', city: 'Moscow', postcode: '125009' },
      passportNumber: 'A01234567',
    },
    recipient: {
      accountNumber: '0123456789',
      bankCode: '058',
      resolvedName: 'ADEBAYO OKONKWO',
      msisdn: '233241234567',
    },
    credentials: {
      password: 'hunter2-but-longer',
      // gitleaks:allow — a synthetic JWT-shaped fixture. Its whole purpose is to
      // prove the scrubber removes it; it is not a credential for anything.
      accessToken: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
      signature: 'a3f1c9',
      apiKey: 'sk_live_not_real',
    },
    amountMinorUnits: 10_015_000n,
    note: 'Contact me at chidi.okafor@example.com or +7 916 123 45 67',
  };

  const scrubbed = JSON.stringify(scrub(payload));

  it.each([
    ['email address', 'chidi.okafor@example.com'],
    ['first name', 'Chidi'],
    ['last name', 'Okafor'],
    ['date of birth', '2002-05-14'],
    ['street address', 'Tverskaya'],
    ['passport number', 'A01234567'],
    ['bank account number', '0123456789'],
    ['resolved recipient name', 'ADEBAYO OKONKWO'],
    ['mobile money number', '233241234567'],
    ['password', 'hunter2-but-longer'],
    ['access token', 'eyJhbGciOiJIUzI1NiJ9'], // gitleaks:allow — see fixture above
    ['api key', 'sk_live_not_real'],
  ])('removes the %s', (_label: string, secretValue: string) => {
    expect(scrubbed).not.toContain(secretValue);
  });

  it('keeps the non-identifying fields an operator actually needs', () => {
    expect(scrubbed).toContain('tr_123');
    expect(scrubbed).toContain('MP-4F2A-91BC');
    expect(scrubbed).toContain('10015000');
    expect(scrubbed).toContain('058');
  });

  it('catches personal data hiding under an innocent key', () => {
    // `note` is not on the redacted-key list; the value patterns catch it.
    expect(scrubbed).toContain('[redacted:email]');
  });

  it('scrubs free text', () => {
    expect(scrubString('write to a.b@c.dev')).toBe('write to [redacted:email]');
    expect(scrubString('card 4111 1111 1111 1111')).toContain('[redacted');
    expect(scrubString('nothing sensitive here')).toBe('nothing sensitive here');
  });

  it('scrubs errors without losing the diagnostic', () => {
    const error = new Error('failed for user jane@example.com');
    const result = scrub(error) as { name: string; message: string };
    expect(result.name).toBe('Error');
    expect(result.message).toBe('failed for user [redacted:email]');
  });

  it('handles arrays, buffers, dates and bigints', () => {
    const result = scrub({
      list: [{ email: 'a@b.com' }, { id: 'ok' }],
      blob: Buffer.from('secret bytes'),
      when: new Date('2026-08-13T00:00:00Z'),
      amount: 42n,
    }) as Record<string, unknown>;

    expect(JSON.stringify(result)).not.toContain('a@b.com');
    expect(result.blob).toBe('[buffer:12]');
    expect(result.when).toBe('2026-08-13T00:00:00.000Z');
    expect(result.amount).toBe('42');
  });

  it('does not recurse without bound', () => {
    const deep: Record<string, unknown> = {};
    let node = deep;
    for (let i = 0; i < 50; i += 1) {
      const next: Record<string, unknown> = {};
      node.next = next;
      node = next;
    }
    expect(() => JSON.stringify(scrub(deep))).not.toThrow();
    expect(JSON.stringify(scrub(deep))).toContain('[truncated]');
  });
});
