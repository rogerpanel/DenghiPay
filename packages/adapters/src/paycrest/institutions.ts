import { PaycrestInstitutionMap, parsePaycrestInstitutions } from './paycrest.provider';

/**
 * Paycrest institution codes for the banks and wallets MoraPay offers, as
 * Paycrest's own `GET /institutions/{currency}` returned them on 22 October 2026
 * (the probe, run on the server with the live key). Not guessed and not from
 * memory: every right-hand value was read off that output.
 *
 * Public reference data, not a secret, so it lives here rather than in a .env
 * line somebody has to type through a web console. `PAYCREST_INSTITUTIONS`
 * still replaces it entirely when set.
 *
 * Gaps, each refused as UNSUPPORTED rather than guessed:
 *   - First Bank (011) and UBA (033): not yet read from Paycrest's NGN list.
 *   - Tanzania M-Pesa: Paycrest lists no M-Pesa institution for TZS.
 */
export const PAYCREST_CONFIRMED_INSTITUTIONS: PaycrestInstitutionMap = {
  bank: {
    NG: {
      '044': 'ABNGNGLA', // Access Bank
      '070': 'FIDTNGLA', // Fidelity Bank
      '058': 'GTBINGLA', // Guaranty Trust Bank
      '057': 'ZEIBNGLA', // Zenith Bank
      '221': 'SBICNGLX', // Stanbic IBTC Bank
    },
  },
  mobileMoney: {
    KE: { MPESA: 'SAFAKEPC', AIRTEL: 'AIRTKEPC' },
    UG: { MTN: 'MOMOUGPC', AIRTEL: 'AIRTUGPC' },
    TZ: { TIGO: 'TIGOTZPC', AIRTEL: 'AIRTTZPC', HALOPESA: 'HALOTZPC' },
  },
};

/**
 * The institution table a deployment uses: the confirmed table above when
 * `PAYCREST_INSTITUTIONS` is blank, otherwise exactly what it says (so `{}`
 * deliberately maps nothing).
 */
export function paycrestInstitutionsFromConfig(value: string | undefined): PaycrestInstitutionMap {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? PAYCREST_CONFIRMED_INSTITUTIONS : parsePaycrestInstitutions(trimmed);
}
