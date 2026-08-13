import { LoggerService } from '@nestjs/common';
import pino, { Logger } from 'pino';

/**
 * Structured logging with a PII scrubber (BUILD_PLAN 11.4, guardrail 9).
 *
 * "No PII in logs" is not achievable by asking people to be careful. The
 * scrubber is applied to every log call, recursively, by key name and by value
 * shape, and there is a test that proves a payload full of personal data
 * reaches stdout with none of it intact.
 */

/** Key names whose values are replaced wholesale. Matched case-insensitively. */
const REDACTED_KEYS = new Set(
  [
    'password',
    'passwordhash',
    'passwordconfirmation',
    'token',
    'tokenhash',
    'accesstoken',
    'refreshtoken',
    'authorization',
    'cookie',
    'setcookie',
    'secret',
    'apikey',
    'signature',
    'signingsecret',
    'pin',
    'otp',
    'email',
    'phone',
    'msisdn',
    'firstname',
    'lastname',
    'middlename',
    'fullname',
    'name',
    'resolvedname',
    'declaredname',
    'accountname',
    'dateofbirth',
    'dob',
    'address',
    'addressline',
    'postcode',
    'passportnumber',
    'documentnumber',
    'accountnumber',
    'iban',
    'cardnumber',
    'pan',
    'nationality',
    'ip',
    'ipaddress',
    'useragent',
  ].map((k) => k.toLowerCase()),
);

const REDACTION = '[redacted]';

/** Value-shaped detection, for personal data that arrives under an innocent key. */
const VALUE_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  // Letters-only TLD, so an npm path like "@nestjs/core@11.0.1" in a stack
  // trace is not mistaken for an address and redacted into uselessness.
  { pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-zA-Z]{2,24}\b/g, label: '[redacted:email]' },
  // E.164-ish: 10-15 digits, optionally prefixed, not part of a longer token.
  { pattern: /(?<![\w-])\+?\d[\d\s-]{8,17}\d(?![\w-])/g, label: '[redacted:phone-or-account]' },
  // Payment card PANs.
  { pattern: /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g, label: '[redacted:pan]' },
];

const MAX_DEPTH = 8;

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';

  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      stack: value.stack === undefined ? undefined : scrubString(value.stack),
    };
  }
  if (Buffer.isBuffer(value)) return `[buffer:${value.length}]`;

  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTION : scrub(item, depth + 1);
    }
    return output;
  }

  return '[unserialisable]';
}

export function scrubString(value: string): string {
  let output = value;
  for (const { pattern, label } of VALUE_PATTERNS) {
    output = output.replace(pattern, label);
  }
  return output;
}

export function createRootLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    base: { service: 'morapay-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    // Belt and braces: pino's own redaction on the well-known paths, in
    // addition to the recursive scrubber applied to every message.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.passwordHash',
        '*.email',
      ],
      censor: REDACTION,
    },
    ...(pretty ? { transport: { target: 'pino/file', options: { destination: 1 } } } : {}),
  });
}

/**
 * Nest logger adapter. Everything the framework logs goes through the same
 * scrubber as application logs — an unhandled exception containing an email
 * address is exactly the case people forget.
 */
export class ScrubbingLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  private write(
    level: 'info' | 'error' | 'warn' | 'debug' | 'trace',
    message: unknown,
    context?: unknown,
    extra?: unknown,
  ): void {
    this.logger[level](
      {
        context: typeof context === 'string' ? context : scrub(context),
        ...(extra === undefined ? {} : { detail: scrub(extra) }),
      },
      typeof message === 'string' ? scrubString(message) : JSON.stringify(scrub(message)),
    );
  }

  log(message: unknown, context?: unknown): void {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: unknown, context?: unknown): void {
    this.write('error', message, context, trace);
  }

  warn(message: unknown, context?: unknown): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: unknown): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: unknown): void {
    this.write('trace', message, context);
  }

  /** Structured application logging with a correlation id. */
  event(name: string, payload: Record<string, unknown>): void {
    this.logger.info({ event: name, ...(scrub(payload) as Record<string, unknown>) }, name);
  }
}
