import { CorridorId, ProviderId } from '@morapay/domain';
import { PayoutProvider } from './ports/payout-provider';
import { PayinProvider } from './ports/payin-provider';

/**
 * Provider registry.
 *
 * Answers open question 3 in the Technical Architecture — the dual-rail routing
 * policy — with the simplest thing that is honest: select by corridor, then by
 * declared priority, skipping anything currently unhealthy. Cost-based routing
 * is a comparator swap, not a rewrite.
 */

export interface RegisteredPayout {
  readonly provider: PayoutProvider;
  /** Lower runs first. */
  readonly priority: number;
  /** False keeps a contracted-but-unproven rail out of routing (guardrail G1). */
  readonly enabled: boolean;
}

export interface RegisteredPayin {
  readonly provider: PayinProvider;
  readonly priority: number;
  readonly enabled: boolean;
}

export class ProviderRegistry {
  private readonly payouts: RegisteredPayout[] = [];
  private readonly payins: RegisteredPayin[] = [];
  private readonly unhealthy = new Set<string>();

  registerPayout(entry: RegisteredPayout): this {
    this.payouts.push(entry);
    return this;
  }

  registerPayin(entry: RegisteredPayin): this {
    this.payins.push(entry);
    return this;
  }

  /** The provider that should handle a new payout on this corridor. */
  selectPayout(corridorId: CorridorId): PayoutProvider | null {
    const candidates = this.payouts
      .filter((e) => e.enabled)
      .filter((e) => e.provider.supportedCorridors.includes(corridorId))
      .filter((e) => !this.unhealthy.has(String(e.provider.id)))
      .sort((a, b) => a.priority - b.priority);
    return candidates[0]?.provider ?? null;
  }

  /**
   * The provider that can resolve or credit an account in a given country,
   * whatever corridor the money eventually travels on.
   *
   * Name enquiry needs this. It happens before a corridor is chosen — the
   * sender is still deciding who to pay — so asking "which provider serves this
   * corridor" has no answer yet. The API used to fabricate one, mapping a
   * Nigerian recipient to `RU-NG` and everyone else to `RU-GH`, which worked
   * only while those were the sole destinations and silently sent a Cameroonian
   * wallet to the Ghanaian rail the moment they were not.
   *
   * Destination countries are derived from each provider's registered
   * corridors, so nothing has to be declared twice.
   */
  selectPayoutForDestination(country: string): PayoutProvider | null {
    const suffix = `-${country}`;
    const candidates = this.payouts
      .filter((e) => e.enabled)
      .filter((e) => e.provider.supportedCorridors.some((id) => String(id).endsWith(suffix)))
      .filter((e) => !this.unhealthy.has(String(e.provider.id)))
      .sort((a, b) => a.priority - b.priority);
    return candidates[0]?.provider ?? null;
  }

  selectPayin(corridorId: CorridorId): PayinProvider | null {
    const candidates = this.payins
      .filter((e) => e.enabled)
      .filter((e) => e.provider.supportedCorridors.includes(corridorId))
      .filter((e) => !this.unhealthy.has(String(e.provider.id)))
      .sort((a, b) => a.priority - b.priority);
    return candidates[0]?.provider ?? null;
  }

  /**
   * Look a provider up by id.
   *
   * Status polls and callbacks must reach the provider that has the reference,
   * never whichever one routing would pick today. Dual-sourcing makes those two
   * different answers.
   */
  payoutById(id: ProviderId | string): PayoutProvider | null {
    return this.payouts.find((e) => String(e.provider.id) === String(id))?.provider ?? null;
  }

  payinById(id: ProviderId | string): PayinProvider | null {
    return this.payins.find((e) => String(e.provider.id) === String(id))?.provider ?? null;
  }

  markUnhealthy(id: ProviderId | string): void {
    this.unhealthy.add(String(id));
  }

  markHealthy(id: ProviderId | string): void {
    this.unhealthy.delete(String(id));
  }

  isHealthy(id: ProviderId | string): boolean {
    return !this.unhealthy.has(String(id));
  }

  describe(): ReadonlyArray<{
    readonly id: string;
    readonly kind: 'PAYIN' | 'PAYOUT';
    readonly corridors: readonly string[];
    readonly enabled: boolean;
    readonly healthy: boolean;
    readonly priority: number;
  }> {
    return [
      ...this.payins.map((e) => ({
        id: String(e.provider.id),
        kind: 'PAYIN' as const,
        corridors: e.provider.supportedCorridors.map(String),
        enabled: e.enabled,
        healthy: this.isHealthy(e.provider.id),
        priority: e.priority,
      })),
      ...this.payouts.map((e) => ({
        id: String(e.provider.id),
        kind: 'PAYOUT' as const,
        corridors: e.provider.supportedCorridors.map(String),
        enabled: e.enabled,
        healthy: this.isHealthy(e.provider.id),
        priority: e.priority,
      })),
    ];
  }
}
