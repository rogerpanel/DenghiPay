/* eslint-disable no-console -- a command-line tool: the terminal is its only output. */
/**
 * Read-only Paycrest probe, for running on the server with the real key.
 *
 *   node /app/packages/adapters/dist/paycrest/probe.js   (inside the API container)
 *   node /app/packages/adapters/dist/paycrest/probe.js verify <INSTITUTION> <ACCOUNT>
 *
 * Reads PAYCREST_API_KEY, and optionally PAYCREST_BASE_URL, PAYCREST_TOKEN and
 * PAYCREST_NETWORK, from the environment. It **never creates an order** — and
 * that matters, because Paycrest has no sandbox: every key is a live key. It
 * lists currencies (with Paycrest's own decimal places, checked against ours),
 * institutions and off-ramp rates for the four countries, and can run one name
 * enquiry. That proves the key works, shows which countries are live for it, and
 * produces the PAYCREST_INSTITUTIONS skeleton from Paycrest's real codes.
 *
 * It prints no key and no secret. A name enquiry prints the resolved name to the
 * terminal and nowhere else — do not paste that output into a ticket or chat.
 */
import { getCurrency } from '@morapay/domain';
import { PAYCREST_DEFAULT_BASE_URL, PaycrestApiError, PaycrestClient } from './client';
import { PAYCREST_PAYOUT_CURRENCIES } from './paycrest.provider';

async function main(): Promise<void> {
  const apiKey = process.env.PAYCREST_API_KEY ?? '';
  if (apiKey === '' || apiKey === 'replace-in-vault') {
    console.error(
      'PAYCREST_API_KEY is not set. Load the server .env first:  set -a; . ./.env; set +a',
    );
    process.exit(2);
  }
  const baseUrl = process.env.PAYCREST_BASE_URL || PAYCREST_DEFAULT_BASE_URL;
  const token = process.env.PAYCREST_TOKEN || 'USDT';
  const network = process.env.PAYCREST_NETWORK || 'base';
  const client = new PaycrestClient({ baseUrl, apiKey });

  const [command, institution, account] = process.argv.slice(2);
  if (command === 'verify') {
    if (institution === undefined || account === undefined) {
      console.error('usage: probe.js verify <INSTITUTION_CODE> <ACCOUNT_OR_WALLET>');
      process.exit(2);
    }
    const name = await client.verifyAccount(institution, account);
    console.log(
      name === null ? 'Account accepted; Paycrest gives no name for it.' : `Resolved: ${name}`,
    );
    return;
  }

  console.log(
    `Paycrest probe — ${baseUrl}, ${token} on ${network} (read-only; no order is created)\n`,
  );

  const currencies = await client.currencies();
  console.log(`Currencies visible to this key: ${currencies.map((c) => c.code).join(', ')}\n`);

  const skeleton: Record<'bank' | 'mobileMoney', Record<string, Record<string, string>>> = {
    bank: {},
    mobileMoney: {},
  };

  for (const [country, currency] of Object.entries(PAYCREST_PAYOUT_CURRENCIES)) {
    console.log(`── ${country} / ${currency}`);
    const listed = currencies.find((c) => c.code === currency);
    const ours = getCurrency(currency).exponent;
    if (listed === undefined) {
      console.log('   not listed by Paycrest for this key');
    } else {
      const agrees = listed.decimals === null || listed.decimals === String(ours);
      console.log(
        `   decimals: Paycrest ${listed.decimals ?? '?'}, MoraPay ${ours}${agrees ? '' : '   ← MISMATCH: stop and resolve before any order'}`,
      );
    }
    try {
      const rate = await client.sellRate(network, token, '10', currency);
      console.log(
        `   off-ramp rate for 10 ${token}: ${rate ?? 'no provider quoting'}${rate ? ` ${currency} per ${token}` : ''}`,
      );
    } catch (error) {
      console.log(`   rate: unavailable (${describe(error)})`);
    }
    try {
      const list = await client.institutions(currency);
      console.log(`   ${list.length} institutions`);
      for (const inst of list) {
        console.log(`     ${inst.code.padEnd(12)} ${inst.type.padEnd(14)} ${inst.name}`);
        const bucket = inst.type.toLowerCase().includes('mobile')
          ? skeleton.mobileMoney
          : skeleton.bank;
        (bucket[country] ??= {})[`<our code for ${inst.name}>`] = inst.code;
      }
    } catch (error) {
      console.log(`   institutions: unavailable (${describe(error)})`);
    }
    console.log('');
  }

  console.log('Skeleton for PAYCREST_INSTITUTIONS. Replace each "<our code …>" key with the');
  console.log('NIP bank code (Nigeria) or network code (MPESA, MTN, AIRTEL, …) MoraPay stores,');
  console.log('delete the rows you do not need, and put the result on one line in .env:\n');
  console.log(JSON.stringify(skeleton, null, 2));
}

function describe(error: unknown): string {
  if (error instanceof PaycrestApiError) return `HTTP ${error.httpStatus}`;
  return error instanceof Error ? error.name : 'error';
}

main().catch((error: unknown) => {
  console.error(`Probe failed: ${describe(error)}`);
  process.exit(1);
});
