import { z } from 'zod';
import { countryCodeSchema, localeSchema } from './common';

/**
 * Password policy.
 *
 * Length first, composition rules second. NIST 800-63B is explicit that
 * arbitrary composition rules push people toward predictable substitutions;
 * a 12-character minimum with a rejection list does more work than requiring a
 * punctuation mark.
 */
const COMMON_PASSWORDS = new Set([
  'password1234',
  '123456789012',
  'qwertyuiop12',
  'letmein12345',
  'morapay12345',
  'administrator',
]);

export const passwordSchema = z
  .string()
  .min(12, 'must be at least 12 characters')
  .max(200, 'must be at most 200 characters')
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), {
    message: 'this password is too common',
  })
  .refine((value) => new Set(value).size > 4, {
    message: 'this password repeats too few distinct characters',
  });

export const emailSchema = z.string().email().max(254).toLowerCase().trim();

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  locale: localeSchema.default('ru'),
  /**
   * Residency drives which data partition holds this person's details, and
   * which corridors they can send on. Nigeria and Ghana are here because the
   * intra-African corridors put a sender inside those countries; their personal
   * data goes to the NG and GH partitions and never leaves them.
   */
  residencyCountry: z.enum(['RU', 'BY', 'NG', 'GH']).default('RU'),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'the terms must be accepted' }),
  }),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const verifyEmailRequestSchema = z.object({
  token: z.string().min(16).max(256),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(16).max(512),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const userStatusSchema = z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'CLOSED']);

export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresInSeconds: z.number().int(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    status: userStatusSchema,
    kycTier: z.number().int().min(0).max(3),
    locale: localeSchema,
    emailVerified: z.boolean(),
  }),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const meResponseSchema = sessionResponseSchema.shape.user.extend({
  /**
   * Where this sender lives. The app needs it to show only the corridors that
   * start where they are — a Lagos resident has no way to hand over rubles.
   */
  residencyCountry: countryCodeSchema,
  /** What this account may do right now, so the UI does not have to infer it. */
  capabilities: z.object({
    canQuote: z.boolean(),
    canTransfer: z.boolean(),
    nextKycTier: z.number().int().min(0).max(3).nullable(),
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// ---------------------------------------------------------------------------
// Back office. Separate schemas because it is a separate application with a
// separate session — never share one with the customer app (Phase 9).
// ---------------------------------------------------------------------------

export const staffRoleSchema = z.enum([
  'SUPPORT',
  'COMPLIANCE_OFFICER',
  'TREASURY_OPERATOR',
  'ADMIN',
]);
export type StaffRoleDto = z.infer<typeof staffRoleSchema>;

export const staffLoginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type StaffLoginRequest = z.infer<typeof staffLoginRequestSchema>;

export const staffSessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresInSeconds: z.number().int(),
  staff: z.object({
    id: z.string(),
    email: z.string(),
    displayName: z.string(),
    roles: z.array(staffRoleSchema),
  }),
});
export type StaffSessionResponse = z.infer<typeof staffSessionResponseSchema>;
