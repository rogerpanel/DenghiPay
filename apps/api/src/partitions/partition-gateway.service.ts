import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/tokens';
import { tokenise } from '../common/crypto.util';
import { SenderProfileRuRepository } from './ru/sender-profile.repository';
import { RecipientProfileNgRepository } from './ng/recipient-profile.repository';
import { RecipientProfileGhRepository } from './gh/recipient-profile.repository';

/**
 * The only door between the neutral tier and the residency partitions
 * (BUILD_PLAN 12.1, guardrail G8).
 *
 * Everything outside `src/partitions/` addresses personal data through this
 * service and receives back either a token or a deliberately narrow projection.
 * A CI check (infra/scripts/check-partition-boundaries.sh) fails the build if
 * anything imports a partition repository directly, and the partitions do not
 * import each other.
 *
 * Locally the partitions are schemas in one database. In production they are
 * separate instances in separate jurisdictions, and only the connection string
 * changes.
 */
@Injectable()
export class PartitionGateway {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly ru: SenderProfileRuRepository,
    private readonly ng: RecipientProfileNgRepository,
    private readonly gh: RecipientProfileGhRepository,
  ) {}

  token(kind: string, value: string): string {
    return tokenise(this.config.TOKENISATION_SALT, kind, value);
  }

  // ------------------------------------------------------------------ sender

  async upsertSenderProfile(input: {
    readonly piiToken: string;
    readonly partition: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly middleName?: string;
    readonly dateOfBirth: string;
    readonly nationality: string;
    readonly phone?: string;
    readonly addressLine?: string;
    readonly city?: string;
    readonly postcode?: string;
    readonly documents: ReadonlyArray<Record<string, unknown>>;
  }): Promise<void> {
    if (input.partition !== 'RU') {
      throw new Error(`No sender partition configured for ${input.partition}`);
    }
    await this.ru.upsert(input);
  }

  /**
   * The screening projection.
   *
   * Screening needs a name and a date of birth and nothing else, so that is all
   * that crosses the boundary — and it crosses in memory, to a service that
   * writes only a tokenised subject reference back.
   */
  async screeningSubject(
    piiToken: string,
    partition: string,
  ): Promise<{ fullName: string; dateOfBirth: string; nationality: string } | null> {
    if (partition !== 'RU') return null;
    return this.ru.screeningProjection(piiToken);
  }

  /** Display projection for the sender's own profile screen. */
  async senderDisplayName(piiToken: string, partition: string): Promise<string | null> {
    if (partition !== 'RU') return null;
    const projection = await this.ru.screeningProjection(piiToken);
    return projection?.fullName ?? null;
  }

  // --------------------------------------------------------------- recipient

  async storeRecipient(input: {
    readonly piiToken: string;
    readonly details:
      | {
          readonly method: 'BANK_ACCOUNT';
          readonly accountNumber: string;
          readonly bankCode: string;
          readonly declaredName: string;
        }
      | {
          readonly method: 'MOBILE_MONEY';
          readonly msisdn: string;
          readonly network: string;
          readonly declaredName: string;
        };
  }): Promise<void> {
    if (input.details.method === 'BANK_ACCOUNT') {
      await this.ng.upsert({
        piiToken: input.piiToken,
        accountNumber: input.details.accountNumber,
        bankCode: input.details.bankCode,
        accountName: input.details.declaredName,
      });
      return;
    }
    await this.gh.upsert({
      piiToken: input.piiToken,
      msisdn: input.details.msisdn,
      network: input.details.network,
      accountName: input.details.declaredName,
    });
  }

  /**
   * Rehydrate recipient details for a payout call.
   *
   * This is the one place the full account number leaves its partition, and it
   * goes straight into an outbound provider request without being persisted in
   * the neutral tier.
   */
  async recipientDetails(
    piiToken: string,
    partition: string,
  ): Promise<
    | {
        method: 'BANK_ACCOUNT';
        country: 'NG';
        accountNumber: string;
        bankCode: string;
        declaredName: string;
      }
    | {
        method: 'MOBILE_MONEY';
        country: 'GH';
        msisdn: string;
        network: 'MTN' | 'TELECEL' | 'AIRTELTIGO';
        declaredName: string;
      }
    | null
  > {
    if (partition === 'NG') {
      const row = await this.ng.find(piiToken);
      return row === null
        ? null
        : {
            method: 'BANK_ACCOUNT',
            country: 'NG',
            accountNumber: row.accountNumber,
            bankCode: row.bankCode,
            declaredName: row.accountName,
          };
    }
    if (partition === 'GH') {
      const row = await this.gh.find(piiToken);
      return row === null
        ? null
        : {
            method: 'MOBILE_MONEY',
            country: 'GH',
            msisdn: row.msisdn,
            network: row.network as 'MTN' | 'TELECEL' | 'AIRTELTIGO',
            declaredName: row.accountName,
          };
    }
    return null;
  }

  /** Health of each partition store, for the readiness endpoint. */
  async health(): Promise<Record<string, boolean>> {
    const probe = async (fn: () => Promise<unknown>): Promise<boolean> => {
      try {
        await fn();
        return true;
      } catch {
        return false;
      }
    };
    return {
      RU: await probe(() => this.prisma.senderProfileRu.count()),
      NG: await probe(() => this.prisma.recipientProfileNg.count()),
      GH: await probe(() => this.prisma.recipientProfileGh.count()),
    };
  }
}
