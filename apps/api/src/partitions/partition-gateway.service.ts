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
import { RecipientProfileCmRepository } from './cm/recipient-profile.repository';
import { SenderProfileCmRepository } from './cm/sender-profile.repository';
import { RecipientProfileBjRepository } from './bj/recipient-profile.repository';
import { SenderProfileBjRepository } from './bj/sender-profile.repository';

/**
 * What a partition can answer about a sender.
 *
 * `collectionWallet` is optional because not every origin has one: Nigeria
 * collects by push to a dedicated account, so there is nothing to debit and its
 * store implements no such method. Making it optional rather than requiring a
 * stub that returns null forever keeps the absence visible in the type.
 */
interface SenderStore {
  screeningProjection(
    piiToken: string,
  ): Promise<{ fullName: string; dateOfBirth: string; nationality: string } | null>;
  collectionWallet?(piiToken: string): Promise<{ msisdn: string; network: string } | null>;
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

export type RecipientProjection =
  | {
      method: 'BANK_ACCOUNT';
      country: 'NG' | 'ZA';
      accountNumber: string;
      bankCode: string;
      declaredName: string;
    }
  | {
      method: 'MOBILE_MONEY';
      country: 'GH' | 'CM' | 'BJ';
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
 * Six partitions now, and they are not symmetrical. Russia holds senders only;
 * South Africa holds recipients only, because it receives and does not send;
 * the other four hold both. Every lookup dispatches on the partition rather
 * than on the shape of the data, which is the fix for a bug the earlier version
 * carried: recipients were routed by payout **method**, so any bank account
 * landed in the Nigerian store regardless of which country it belonged to.
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
    private readonly cm: RecipientProfileCmRepository,
    private readonly cmSender: SenderProfileCmRepository,
    private readonly bj: RecipientProfileBjRepository,
    private readonly bjSender: SenderProfileBjRepository,
  ) {
    this.senderStores = {
      RU: this.ru,
      NG: this.ngSender,
      GH: this.ghSender,
      CM: this.cmSender,
      BJ: this.bjSender,
    };
    this.walletRecipients = { GH: this.gh, CM: this.cm, BJ: this.bj };
    this.bankRecipients = { NG: this.ng, ZA: this.za };
  }

  token(kind: string, value: string): string {
    return tokenise(this.config.TOKENISATION_SALT, kind, value);
  }

  // ------------------------------------------------------------------ sender

  /**
   * Senders live in five partitions, one per residency that can originate.
   *
   * The identifiers differ by jurisdiction — a passport and migration card in
   * Russia, a BVN in Nigeria, a Ghana Card in Ghana, a national identity number
   * in Cameroon and Benin — so each store keeps its own shape rather than a
   * lowest common denominator with most columns null.
   *
   * South Africa is absent and stays absent until exchange-control reporting is
   * built: a South African sender has nowhere to be stored, which is a stronger
   * guarantee than a flag.
   */
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
    readonly bvn?: string;
    readonly ghanaCardNo?: string;
    readonly nationalIdNo?: string;
    readonly walletMsisdn?: string;
    readonly walletNetwork?: string;
    readonly documents: ReadonlyArray<Record<string, unknown>>;
  }): Promise<void> {
    switch (input.partition) {
      case 'RU':
        await this.ru.upsert(input);
        return;
      case 'NG':
        await this.ngSender.upsert(input);
        return;
      case 'GH':
        await this.ghSender.upsert(input);
        return;
      case 'CM':
        await this.cmSender.upsert(input);
        return;
      case 'BJ':
        await this.bjSender.upsert(input);
        return;
      default:
        throw new Error(`No sender partition configured for ${input.partition}`);
    }
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
            country: partition as 'NG' | 'ZA',
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
            country: partition as 'GH' | 'CM' | 'BJ',
            msisdn: row.msisdn,
            network: row.network as MobileMoneyNetwork,
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
      NG: await probe(
        async () =>
          (await this.prisma.recipientProfileNg.count()) +
          (await this.prisma.senderProfileNg.count()),
      ),
      GH: await probe(
        async () =>
          (await this.prisma.recipientProfileGh.count()) +
          (await this.prisma.senderProfileGh.count()),
      ),
      ZA: await probe(() => this.prisma.recipientProfileZa.count()),
      CM: await probe(
        async () =>
          (await this.prisma.recipientProfileCm.count()) +
          (await this.prisma.senderProfileCm.count()),
      ),
      BJ: await probe(
        async () =>
          (await this.prisma.recipientProfileBj.count()) +
          (await this.prisma.senderProfileBj.count()),
      ),
    };
  }
}
