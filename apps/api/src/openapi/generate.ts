/**
 * Generate `docs/api/openapi.json` from the shared zod contracts.
 *
 * The spec is derived from the same schemas the API validates against, so it
 * cannot drift from the implementation the way a hand-written spec does. CI
 * regenerates it and fails if the committed file differs (BUILD_PLAN 5.5 DoD).
 */
/* eslint-disable no-console -- this is a build script; its output is the point */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  apiErrorSchema,
  cancelTransferRequestSchema,
  createQuoteRequestSchema,
  createRecipientRequestSchema,
  createTransferRequestSchema,
  corridorResponseSchema,
  kycRequirementsResponseSchema,
  kycSubmitRequestSchema,
  loginRequestSchema,
  meResponseSchema,
  nameEnquiryRequestSchema,
  nameEnquiryResponseSchema,
  quoteResponseSchema,
  rateResponseSchema,
  recipientResponseSchema,
  refreshRequestSchema,
  registerRequestSchema,
  sessionResponseSchema,
  staffLoginRequestSchema,
  staffSessionResponseSchema,
  transferResponseSchema,
  verifyEmailRequestSchema,
} from '@morapay/contracts';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

const adminBearer = registry.registerComponent('securitySchemes', 'adminBearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description:
    'Back-office tokens are signed with a different key from customer tokens. ' +
    'A customer token fails signature verification here, not merely authorisation.',
});

const ErrorSchema = registry.register('ApiError', apiErrorSchema);

function json(schema: z.ZodTypeAny) {
  return { content: { 'application/json': { schema } } };
}

const errors = {
  400: { description: 'The request is not valid', ...json(ErrorSchema) },
  401: { description: 'Authentication required or invalid', ...json(ErrorSchema) },
  403: {
    description: 'Forbidden — unverified email, insufficient role, or a limit exceeded',
    ...json(ErrorSchema),
  },
  422: { description: 'A domain rule refused the request', ...json(ErrorSchema) },
  429: { description: 'Rate limited', ...json(ErrorSchema) },
};

// --------------------------------------------------------------------- auth

registry.registerPath({
  method: 'post',
  path: '/auth/register',
  tags: ['Authentication'],
  summary: 'Create an account',
  description:
    'The account starts at PENDING_VERIFICATION and KYC tier 0. Every financial ' +
    'endpoint returns 403 until the email address is confirmed.',
  request: { body: json(registerRequestSchema) },
  responses: { 201: { description: 'Created', ...json(sessionResponseSchema) }, ...errors },
});

registry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: ['Authentication'],
  summary: 'Sign in',
  request: { body: json(loginRequestSchema) },
  responses: { 200: { description: 'Signed in', ...json(sessionResponseSchema) }, ...errors },
});

registry.registerPath({
  method: 'post',
  path: '/auth/refresh',
  tags: ['Authentication'],
  summary: 'Rotate a refresh token',
  description:
    'Refresh tokens rotate on every use. Presenting one that has already been ' +
    'used revokes the entire session family — we cannot distinguish replay from theft, ' +
    'and both are handled the same way.',
  request: { body: json(refreshRequestSchema) },
  responses: { 200: { description: 'Rotated', ...json(sessionResponseSchema) }, ...errors },
});

registry.registerPath({
  method: 'post',
  path: '/auth/verify-email',
  tags: ['Authentication'],
  summary: 'Confirm an email address',
  request: { body: json(verifyEmailRequestSchema) },
  responses: {
    200: { description: 'Verified', ...json(z.object({ verified: z.literal(true) })) },
    ...errors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/auth/me',
  tags: ['Authentication'],
  summary: 'The signed-in account and what it may do',
  security: [{ [bearer.name]: [] }],
  responses: { 200: { description: 'OK', ...json(meResponseSchema) }, ...errors },
});

// ---------------------------------------------------------------------- kyc

registry.registerPath({
  method: 'get',
  path: '/kyc/requirements/{tier}',
  tags: ['KYC'],
  summary: 'Documents and limits for a tier',
  description:
    'Returns the realistic document set for the account’s residency. For a foreign ' +
    'national in Russia that is a national passport plus a migration card and a ' +
    'registration — never a Russian internal passport.',
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ tier: z.string() }) },
  responses: { 200: { description: 'OK', ...json(kycRequirementsResponseSchema) }, ...errors },
});

registry.registerPath({
  method: 'post',
  path: '/kyc/submit',
  tags: ['KYC'],
  summary: 'Submit documents for a tier upgrade',
  security: [{ [bearer.name]: [] }],
  request: { body: json(kycSubmitRequestSchema) },
  responses: {
    201: { description: 'Submitted', ...json(z.object({ id: z.string() })) },
    ...errors,
  },
});

// ------------------------------------------------------------------ quoting

registry.registerPath({
  method: 'get',
  path: '/corridors',
  tags: ['Quoting'],
  summary: 'Available corridors, limits and fees',
  responses: {
    200: { description: 'OK', ...json(z.object({ corridors: z.array(corridorResponseSchema) })) },
  },
});

registry.registerPath({
  method: 'get',
  path: '/rates',
  tags: ['Quoting'],
  summary: 'Rate feed health',
  description:
    '`usable: false` means the observation is beyond the staleness threshold and ' +
    'quoting has halted for that pair. We do not serve a rate nobody stands behind.',
  responses: {
    200: { description: 'OK', ...json(z.object({ rates: z.array(rateResponseSchema) })) },
  },
});

registry.registerPath({
  method: 'post',
  path: '/quotes',
  tags: ['Quoting'],
  summary: 'Quote a transfer',
  description:
    'Returns the full decomposition: mid-market rate, our margin in basis points and ' +
    'in money, the fixed fee, and what the recipient would receive at mid. Quotes are ' +
    'signed, single-use and short-lived.',
  security: [{ [bearer.name]: [] }],
  request: { body: json(createQuoteRequestSchema) },
  responses: { 201: { description: 'Quoted', ...json(quoteResponseSchema) }, ...errors },
});

// --------------------------------------------------------------- recipients

registry.registerPath({
  method: 'post',
  path: '/recipients/name-enquiry',
  tags: ['Recipients'],
  summary: 'Resolve the name the institution holds',
  description:
    'Called before the sender commits. Showing the resolved name back to the sender ' +
    'prevents the most common support case in this corridor: money sent to a mistyped ' +
    'account number, unrecoverable once settled.',
  security: [{ [bearer.name]: [] }],
  request: { body: json(nameEnquiryRequestSchema) },
  responses: {
    200: { description: 'Resolved or not', ...json(nameEnquiryResponseSchema) },
    ...errors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/recipients',
  tags: ['Recipients'],
  summary: 'Save a recipient',
  security: [{ [bearer.name]: [] }],
  request: { body: json(createRecipientRequestSchema) },
  responses: { 201: { description: 'Saved', ...json(recipientResponseSchema) }, ...errors },
});

registry.registerPath({
  method: 'get',
  path: '/recipients',
  tags: ['Recipients'],
  summary: 'List saved recipients',
  security: [{ [bearer.name]: [] }],
  responses: {
    200: { description: 'OK', ...json(z.object({ recipients: z.array(recipientResponseSchema) })) },
    ...errors,
  },
});

// ---------------------------------------------------------------- transfers

registry.registerPath({
  method: 'post',
  path: '/transfers',
  tags: ['Transfers'],
  summary: 'Confirm a transfer from a quote',
  description:
    'Requires an `Idempotency-Key` header. Screening runs before the transfer can ' +
    'await payment; a hit routes it to the compliance queue and no code path bypasses that.',
  security: [{ [bearer.name]: [] }],
  request: {
    headers: z.object({ 'idempotency-key': z.string().min(8) }),
    body: json(createTransferRequestSchema),
  },
  responses: { 201: { description: 'Created', ...json(transferResponseSchema) }, ...errors },
});

registry.registerPath({
  method: 'get',
  path: '/transfers',
  tags: ['Transfers'],
  summary: 'List transfers',
  security: [{ [bearer.name]: [] }],
  responses: {
    200: {
      description: 'OK',
      ...json(
        z.object({ transfers: z.array(transferResponseSchema), nextCursor: z.string().nullable() }),
      ),
    },
    ...errors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/transfers/{id}',
  tags: ['Transfers'],
  summary: 'Transfer status and timeline',
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'OK', ...json(transferResponseSchema) }, ...errors },
});

registry.registerPath({
  method: 'post',
  path: '/transfers/{id}/cancel',
  tags: ['Transfers'],
  summary: 'Cancel before payment',
  description: 'Only available before we have the sender’s money. After that it is a refund.',
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }), body: json(cancelTransferRequestSchema) },
  responses: { 200: { description: 'Cancelled', ...json(transferResponseSchema) }, ...errors },
});

// ---------------------------------------------------------------- webhooks

registry.registerPath({
  method: 'post',
  path: '/webhooks/{providerId}/callback',
  tags: ['Webhooks'],
  summary: 'Provider callback',
  description:
    'Verifies an HMAC-SHA256 signature over `timestamp + "." + raw_body` in constant ' +
    'time, rejects anything outside a 300-second window, deduplicates by event id, and ' +
    'enqueues a status poll. It writes nothing financial: a forged or replayed callback ' +
    'achieves nothing beyond a poll we would have made anyway.',
  request: {
    params: z.object({ providerId: z.string() }),
    headers: z.object({ 'x-signature': z.string(), 'x-timestamp': z.string() }),
  },
  responses: {
    200: { description: 'Accepted or a duplicate. Empty body.' },
    401: { description: 'Stale, forged, malformed, or an unknown provider' },
  },
});

// ------------------------------------------------------------------- admin

registry.registerPath({
  method: 'post',
  path: '/admin/auth/login',
  tags: ['Back office'],
  summary: 'Staff sign in',
  request: { body: json(staffLoginRequestSchema) },
  responses: { 200: { description: 'Signed in', ...json(staffSessionResponseSchema) }, ...errors },
});

for (const [path, summary, roles] of [
  ['/admin/compliance/cases', 'Compliance review queue', 'COMPLIANCE_OFFICER, SUPPORT, ADMIN'],
  [
    '/admin/transfers',
    'Operational transfer search',
    'SUPPORT, COMPLIANCE_OFFICER, ADMIN, TREASURY_OPERATOR',
  ],
  ['/admin/treasury/positions', 'Float positions and open FX exposure', 'TREASURY_OPERATOR, ADMIN'],
  ['/admin/treasury/prefunding', 'Prefunding requests and approvals', 'TREASURY_OPERATOR, ADMIN'],
  [
    '/admin/reconciliation/runs',
    'Reconciliation runs and breaks',
    'TREASURY_OPERATOR, ADMIN, SUPPORT',
  ],
  ['/admin/reports/volumes', 'Volume by corridor', 'ADMIN, COMPLIANCE_OFFICER, TREASURY_OPERATOR'],
  ['/admin/audit', 'Audit trail', 'ADMIN, COMPLIANCE_OFFICER'],
  ['/admin/audit/verify', 'Verify the audit hash chain', 'ADMIN, COMPLIANCE_OFFICER'],
] as const) {
  registry.registerPath({
    method: 'get',
    path,
    tags: ['Back office'],
    summary,
    description: `Requires one of: ${roles}.`,
    security: [{ [adminBearer.name]: [] }],
    responses: { 200: { description: 'OK' }, ...errors },
  });
}

// ------------------------------------------------------------------ health

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['Operations'],
  summary: 'Liveness, and whether live funds are enabled',
  responses: {
    200: {
      description: 'OK',
      ...json(
        z.object({
          status: z.literal('ok'),
          liveFundsEnabled: z.boolean(),
          environment: z.string(),
        }),
      ),
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/health/ledger',
  tags: ['Operations'],
  summary: 'The ledger invariant',
  description:
    'Debits minus credits, per currency, across every account. Anything other than ' +
    'zero means money has been created or destroyed — stop the world.',
  responses: { 200: { description: 'OK' } },
});

const generator = new OpenApiGeneratorV3(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'MoraPay API',
    version: '0.1.0',
    description: [
      'Cross-border remittance platform. Russia/CIS → Nigeria & Ghana.',
      '',
      '**No live funds.** `LIVE_FUNDS_ENABLED` defaults to false and every provider',
      'runs against a simulator until partner agreements and written legal opinions',
      'are in place.',
      '',
      'Two conventions that differ from most payment APIs, and both are deliberate:',
      '',
      '1. **Money is never a JSON number.** Amounts carry `minorUnits` as a string,',
      '   which is the authoritative field. A JSON number is a double, and a double',
      '   is not a currency.',
      '2. **An acknowledgement is not a settlement.** A provider that accepts a',
      '   submission has moved no money. Only a status poll or the T+1 statement',
      '   produces an outcome, and only an outcome posts to the ledger.',
    ].join('\n'),
    license: { name: 'Proprietary' },
  },
  servers: [
    { url: 'http://localhost:4000', description: 'Local development' },
    { url: 'https://api.staging.morapay.example', description: 'Staging' },
  ],
  tags: [
    { name: 'Authentication' },
    { name: 'KYC' },
    { name: 'Quoting' },
    { name: 'Recipients' },
    { name: 'Transfers' },
    { name: 'Webhooks' },
    { name: 'Back office' },
    { name: 'Operations' },
  ],
});

const output = resolve(__dirname, '../../../../docs/api/openapi.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
console.log(`OpenAPI written to ${output}`);
console.log(`  ${Object.keys(document.paths ?? {}).length} paths`);
