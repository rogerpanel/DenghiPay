import { Inject, Injectable } from '@nestjs/common';
import { MobileMoneyNetwork } from '@morapay/domain';
import { PrismaService } from '../common/prisma.service';
import { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/tokens';
import { tokenise } from '../common/crypto.util';
import { SenderProfileRuRepository } from './ru/sender-profile.repository';
import { RecipientProfileNgRepository } from './ng/recipient-profile.repository';
import { SenderProfileNgRepository } from './ng/sender-profile.repository';
import { RecipientProfileGhRepository } from './gh/recipient-profile.repository';
import { SenderProfileGhRepository } from './gh/sender-profile.repository';
import { RecipientProfileZaRepository } from './za/recipient-profile.repository';
import { SenderProfileZaRepository } from './za/sender-profile.repository';
import { RecipientProfileCmRepository } from './cm/recipient-profile.repository';
import { SenderProfileCmRepository } from './cm/sender-profile.repository';
import { RecipientProfileBjRepository } from './bj/recipient-profile.repository';
import { SenderProfileBjRepository } from './bj/sender-profile.repository';
import {
  STANDARD_PARTITIONS,
  StandardPartition,
  StandardPartitionRepository,
} from './standard/standard-partition.repository';

/**
 * What a partition can answer about a sender.
 *
 * `collectionWallet` is optional because not every origin has one: Nigeria
 * collects by push to a dedicated account, so there is nothing to debit and its
 * store implements no such method. Making it optional rather than requiring a
 * stub that returns null forever keeps the absence visible in the type.
 */
interface SenderStore {
  upsert(input: SenderProfileInput): Promise<void>;
  screeningProjection(
    piiToken: string,
  ): Promise<{ fullName: string; dateOfBirth: string; nationality: string } | null>;
  collectionWallet?(piiToken: string): Promise<{ msisdn: string; network: string } | null>;
}

/**
 * The union of every sender field any partition keeps.
 *
 * A store takes this whole shape and persists the subset its jurisdiction
 * defines — Nigeria reads `bvn` and ignores `taxReference`, South Africa the
 * reverse. The alternative, a per-partition input type reaching the caller,
 * would put the shape of Nigerian identity documents in the registration
 * controller, which is precisely what the gateway exists to prevent.
 */
interface SenderProfileInput {
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
  readonly bvn?: string;
  readonly ghanaCardNo?: string;
  readonly nationalIdNo?: string;
  readonly taxReference?: string;
  readonly exchangeControlStatus?: string;
  readonly walletMsisdn?: string;
  readonly walletNetwork?: string;
  readonly documents: ReadonlyArray<Record<string, unknown>>;
}

/** What a wallet-based partition can answer about a recipient. */
interface WalletRecipientStore {
  upsert(input: {
    readonly piiToken: string;
    readonly msisdn: string;
    readonly network: string;
    readonly accountName: string;
  }): Promise<void>;
  find(piiToken: string): Promise<{ msisdn: string; network: string; accountName: string } | null>;
}

interface BankRecipientStore {
  upsert(input: {
    readonly piiToken: string;
    readonly accountNumber: string;
    readonly bankCode: string;
    readonly accountName: string;
  }): Promise<void>;
  find(
    piiToken: string,
  ): Promise<{ accountNumber: string; bankCode: string; accountName: string } | null>;
}

/** Destinations credited by bank transfer. Two, and unlikely to grow quickly. */
type BankRecipientCountry = 'NG' | 'ZA';

/**
 * Destinations credited to a wallet. Thirteen: the three hand-written ones and
 * the ten standard partitions, which are wallet-only by definition.
 */
type WalletRecipientCountry = 'GH' | 'CM' | 'BJ' | StandardPartition;

export type RecipientProjection =
  | {
      method: 'BANK_ACCOUNT';
      country: BankRecipientCountry;
      accountNumber: string;
      bankCode: string;
      declaredName: string;
    }
  | {
      method: 'MOBILE_MONEY';
      country: WalletRecipientCountry;
      msisdn: string;
      network: MobileMoneyNetwork;
      declaredName: string;
    };

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
 *
 * Sixteen partitions, and they are not symmetrical: Russia holds senders only,
 * the other fifteen hold both. Every lookup dispatches on the partition rather
 * than on the shape of the data, which is the fix for a bug an earlier version
 * carried — recipients were routed by payout **method**, so any bank account
 * landed in the Nigerian store regardless of which country it belonged to.
 *
 * Six partitions have a repository of their own because their jurisdiction
 * demands fields nobody else has. The other ten are served by
 * `StandardPartitionRepository`, which keeps their schemas separate but their
 * code common. From here that distinction is invisible: both kinds arrive in
 * the same three maps and every method below dispatches on a lookup, not a
 * switch.
 */
@Injectable()
export class PartitionGateway {
  private readonly senderStores: Readonly<Record<string, SenderStore | undefined>>;
  private readonly walletRecipients: Readonly<Record<string, WalletRecipientStore | undefined>>;
  private readonly bankRecipients: Readonly<Record<string, BankRecipientStore | undefined>>;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly ru: SenderProfileRuRepository,
    private readonly ng: RecipientProfileNgRepository,
    private readonly gh: RecipientProfileGhRepository,
    private readonly ngSender: SenderProfileNgRepository,
    private readonly ghSender: SenderProfileGhRepository,
    private readonly za: RecipientProfileZaRepository,
    private readonly zaSender: SenderProfileZaRepository,
    private readonly cm: RecipientProfileCmRepository,
    private readonly cmSender: SenderProfileCmRepository,
    private readonly bj: RecipientProfileBjRepository,
    private readonly bjSender: SenderProfileBjRepository,
    private readonly standard: StandardPartitionRepository,
  ) {
    const senderStores: Record<string, SenderStore> = {
      RU: this.ru,
      NG: this.ngSender,
      GH: this.ghSender,
      ZA: this.zaSender,
      CM: this.cmSender,
      BJ: this.bjSender,
    };
    const walletRecipients: Record<string, WalletRecipientStore> = {
      GH: this.gh,
      CM: this.cm,
      BJ: this.bj,
    };
    for (const partition of STANDARD_PARTITIONS) {
      senderStores[partition] = this.standard.senderStore(partition);
      walletRecipients[partition] = this.standard.recipientStore(partition);
    }

    this.senderStores = senderStores;
    this.walletRecipients = walletRecipients;
    this.bankRecipients = { NG: this.ng, ZA: this.za };
  }

  token(kind: string, value: string): string {
    return tokenise(this.config.TOKENISATION_SALT, kind, value);
  }

  // ------------------------------------------------------------------ sender

  /**
   * Senders live in sixteen partitions, one per residency that can originate.
   *
   * The identifiers differ by jurisdiction — a passport and migration card in
   * Russia, a BVN in Nigeria, a Ghana Card in Ghana, a South African identity
   * number and tax reference, and a single national identity number in the
   * other twelve — so each store keeps its own shape rather than a lowest
   * common denominator with most columns null. The caller passes every field
   * it holds and the store persists what its jurisdiction defines.
   *
   * Throwing on an unconfigured partition is the point of the last branch. A
   * residency we cannot store personal data for must not silently acquire a
   * profile that exists nowhere; the registration fails and is visible.
   */
  async upsertSenderProfile(input: SenderProfileInput): Promise<void> {
    const store = this.senderStores[input.partition];
    if (store === undefined) {
      throw new Error(`No sender partition configured for ${input.partition}`);
    }
    await store.upsert(input);
  }

  /**
   * The screening projection.
   *
   * Screening needs a name and a date of birth and nothing else, so that is all
   * that crosses the boundary — and it crosses in memory, to a service that
   * writes only a tokenised subject reference back.
   *
   * Returning null here is not a soft failure. The compliance gate treats an
   * absent subject as unscreenable and refuses the transfer, so a residency
   * with no store behind it fails closed (guardrail G3).
   */
  async screeningSubject(
    piiToken: string,
    partition: string,
  ): Promise<{ fullName: string; dateOfBirth: string; nationality: string } | null> {
    return (await this.senderStores[partition]?.screeningProjection(piiToken)) ?? null;
  }

  /** Display projection for the sender's own profile screen. */
  async senderDisplayName(piiToken: string, partition: string): Promise<string | null> {
    return (await this.screeningSubject(piiToken, partition))?.fullName ?? null;
  }

  /**
   * The account a pull-based collection rail debits.
   *
   * Ghana, Cameroon and Benin have one: mobile-money collection debits the
   * sender's own wallet, so the number has to reach the provider. Russia and
   * Nigeria are push rails — the sender originates the payment — and there is
   * nothing to return, which is why null is the ordinary answer rather than an
   * error.
   */
  async senderCollectionAccount(
    piiToken: string,
    partition: string,
  ): Promise<{ method: 'MOBILE_MONEY'; msisdn: string; network: string } | null> {
    const store = this.senderStores[partition];
    const wallet = (await store?.collectionWallet?.(piiToken)) ?? null;
    return wallet === null ? null : { method: 'MOBILE_MONEY', ...wallet };
  }

  // --------------------------------------------------------------- recipient

  /**
   * Store a recipient in the partition of the country they live in.
   *
   * Dispatch is on **country**, not on payout method. Method alone was enough
   * while Nigeria was the only bank destination and Ghana the only wallet one;
   * with South Africa also crediting bank accounts and three countries
   * crediting wallets, dispatching on method would file a Johannesburg account
   * in the Nigerian store — a data-residency breach that no test of the happy
   * path would notice.
   */
  async storeRecipient(input: {
    readonly piiToken: string;
    readonly country: string;
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
      const store = this.bankRecipients[input.country];
      if (store === undefined) {
        throw new Error(`No bank recipient partition configured for ${input.country}`);
      }
      await store.upsert({
        piiToken: input.piiToken,
        accountNumber: input.details.accountNumber,
        bankCode: input.details.bankCode,
        accountName: input.details.declaredName,
      });
      return;
    }

    const store = this.walletRecipients[input.country];
    if (store === undefined) {
      throw new Error(`No wallet recipient partition configured for ${input.country}`);
    }
    await store.upsert({
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
  async recipientDetails(piiToken: string, partition: string): Promise<RecipientProjection | null> {
    const bank = this.bankRecipients[partition];
    if (bank !== undefined) {
      const row = await bank.find(piiToken);
      return row === null
        ? null
        : {
            method: 'BANK_ACCOUNT',
            country: partition as BankRecipientCountry,
            accountNumber: row.accountNumber,
            bankCode: row.bankCode,
            declaredName: row.accountName,
          };
    }

    const wallet = this.walletRecipients[partition];
    if (wallet !== undefined) {
      const row = await wallet.find(piiToken);
      return row === null
        ? null
        : {
            method: 'MOBILE_MONEY',
            country: partition as WalletRecipientCountry,
            msisdn: row.msisdn,
            network: row.network as MobileMoneyNetwork,
            declaredName: row.accountName,
          };
    }

    return null;
  }

  /**
   * What the exchange-control gate needs about a sender.
   *
   * Only South Africa answers this today, because only South Africa has a
   * regime. Null for everyone else, and the caller reads null as "no regime
   * applies" rather than as a failure.
   */
  async exchangeControlSubject(
    piiToken: string,
    partition: string,
  ): Promise<{ ageYears: number; taxReference: string | null; status: string | null } | null> {
    if (partition !== 'ZA') return null;
    return this.zaSender.exchangeControlSubject(piiToken);
  }

  /**
   * The identity fields an Authorised Dealer reports a payment against.
   *
   * The widest projection in this file, and the only one carrying a name and a
   * national identity number together. It exists because the reporting
   * obligation genuinely requires them, it is read at the moment a report is
   * produced, and it is never persisted in the neutral tier.
   */
  async reportingSubject(
    piiToken: string,
    partition: string,
  ): Promise<{
    fullName: string;
    nationalIdNo: string | null;
    taxReference: string | null;
  } | null> {
    if (partition !== 'ZA') return null;
    return this.zaSender.reportingSubject(piiToken);
  }

  /**
   * Health of each partition store, for the readiness endpoint.
   *
   * A partition is healthy when both of its tables answer. Counting is the
   * cheapest query that proves the schema exists and is reachable — which is
   * the thing that actually breaks when a residency is misconfigured, and it
   * reads no personal data to find out.
   */
  async health(): Promise<Record<string, boolean>> {
    const probe = async (fn: () => Promise<unknown>): Promise<boolean> => {
      try {
        await fn();
        return true;
      } catch {
        return false;
      }
    };

    // The six hand-written partitions are probed one by one: each pair of
    // delegates is a distinct generated type, so a loop over them would only
    // buy repetition back as casts.
    const result: Record<string, boolean> = {
      RU: await probe(() => this.prisma.senderProfileRu.count()),
      NG: await probe(
        async () =>
          (await this.prisma.senderProfileNg.count()) +
          (await this.prisma.recipientProfileNg.count()),
      ),
      GH: await probe(
        async () =>
          (await this.prisma.senderProfileGh.count()) +
          (await this.prisma.recipientProfileGh.count()),
      ),
      ZA: await probe(
        async () =>
          (await this.prisma.senderProfileZa.count()) +
          (await this.prisma.recipientProfileZa.count()),
      ),
      CM: await probe(
        async () =>
          (await this.prisma.senderProfileCm.count()) +
          (await this.prisma.recipientProfileCm.count()),
      ),
      BJ: await probe(
        async () =>
          (await this.prisma.senderProfileBj.count()) +
          (await this.prisma.recipientProfileBj.count()),
      ),
    };

    for (const partition of STANDARD_PARTITIONS) {
      result[partition] = await probe(
        async () =>
          (await this.standard.senderStore(partition).count()) +
          (await this.standard.recipientStore(partition).count()),
      );
    }
    return result;
  }
}
