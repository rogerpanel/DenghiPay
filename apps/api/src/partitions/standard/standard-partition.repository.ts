import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/**
 * The ten standard residency partitions (BUILD_PLAN 15.3).
 *
 * Congo-Kinshasa, Congo-Brazzaville, Uganda, Kenya, Tanzania, Zambia, Gambia,
 * Niger, Mali and Senegal. What makes them "standard" is narrow and worth
 * stating precisely, because the day one of them stops being standard it must
 * leave this file rather than grow a special case inside it:
 *
 *  - identity anchors on exactly one national identity number, so there is no
 *    second jurisdiction-specific column the way Russia has a migration card,
 *    Nigeria a BVN, Ghana a Ghana Card, or South Africa a tax reference;
 *  - both legs run over mobile money, so the sender has a wallet to debit and
 *    the recipient a wallet to credit.
 *
 * Six partitions were written out by hand before these arrived, one file per
 * country per subject. That was the right shape at six. At sixteen it would be
 * twenty near-identical files and a sixteen-way switch in every gateway method,
 * where the only thing a reader could usefully check — that the Kenyan row goes
 * to the Kenyan schema — is exactly what gets lost in the noise.
 *
 * So the ten share one repository and the mapping becomes a table. **The table
 * is the safety property.** Everything else here is bookkeeping; if
 * `SENDER_TABLES` or `RECIPIENT_TABLES` ever maps a country to a neighbour's
 * delegate, personal data crosses a border, and no test of a happy path would
 * notice. It is asserted directly in the spec for that reason.
 *
 * Sharing code is not sharing a jurisdiction. These are still ten separate
 * schemas, and in production ten separate instances; only the delegate lookup
 * is common.
 */
export const STANDARD_PARTITIONS = [
  'CD',
  'CG',
  'UG',
  'KE',
  'TZ',
  'ZM',
  'GM',
  'NE',
  'ML',
  'SN',
] as const;

export type StandardPartition = (typeof STANDARD_PARTITIONS)[number];

export function isStandardPartition(partition: string): partition is StandardPartition {
  return (STANDARD_PARTITIONS as readonly string[]).includes(partition);
}

/** The columns a standard sender row carries, already coerced for the driver. */
interface SenderRow {
  firstName: string;
  lastName: string;
  middleName: string | null;
  dateOfBirth: Date;
  nationality: string;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  nationalIdNo: string | null;
  walletMsisdn: string | null;
  walletNetwork: string | null;
  documents: object[];
}

interface RecipientRow {
  msisdn: string;
  network: string;
  accountName: string;
}

/**
 * The slice of a Prisma model delegate this repository uses.
 *
 * Written out structurally rather than referencing the generated delegate
 * types: the ten are identical in the operations below, and a hand-written
 * interface is what lets the table be a `Record` the compiler checks rather
 * than ten separate call sites.
 */
interface SenderDelegate {
  upsert(args: {
    where: { piiToken: string };
    update: SenderRow;
    create: SenderRow & { piiToken: string };
  }): Promise<unknown>;
  findUnique(args: {
    where: { piiToken: string };
    select: Record<string, boolean>;
  }): Promise<Record<string, unknown> | null>;
  count(args?: { where?: { piiToken?: string } }): Promise<number>;
}

interface RecipientDelegate {
  upsert(args: {
    where: { piiToken: string };
    update: RecipientRow;
    create: RecipientRow & { piiToken: string };
  }): Promise<unknown>;
  findUnique(args: {
    where: { piiToken: string };
    select: Record<string, boolean>;
  }): Promise<Record<string, unknown> | null>;
  count(args?: { where?: { piiToken?: string } }): Promise<number>;
}

/** What `PartitionGateway` expects of any sender store. */
export interface StandardSenderStore {
  upsert(input: SenderProfileInput): Promise<void>;
  screeningProjection(
    piiToken: string,
  ): Promise<{ fullName: string; dateOfBirth: string; nationality: string } | null>;
  collectionWallet(piiToken: string): Promise<{ msisdn: string; network: string } | null>;
  count(): Promise<number>;
}

/** What `PartitionGateway` expects of any wallet recipient store. */
export interface StandardRecipientStore {
  upsert(input: {
    readonly piiToken: string;
    readonly msisdn: string;
    readonly network: string;
    readonly accountName: string;
  }): Promise<void>;
  find(piiToken: string): Promise<{ msisdn: string; network: string; accountName: string } | null>;
  count(): Promise<number>;
}

export interface SenderProfileInput {
  readonly piiToken: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly middleName?: string;
  readonly dateOfBirth: string;
  readonly nationality: string;
  readonly phone?: string;
  readonly addressLine?: string;
  readonly city?: string;
  readonly nationalIdNo?: string;
  readonly walletMsisdn?: string;
  readonly walletNetwork?: string;
  readonly documents: ReadonlyArray<Record<string, unknown>>;
}

@Injectable()
export class StandardPartitionRepository {
  private readonly senderTables: Readonly<Record<StandardPartition, SenderDelegate>>;
  private readonly recipientTables: Readonly<Record<StandardPartition, RecipientDelegate>>;

  constructor(private readonly prisma: PrismaService) {
    // The load-bearing lines in this file. One country, one schema, no
    // neighbours. `Record<StandardPartition, …>` means a country added to
    // STANDARD_PARTITIONS without a table here fails to compile rather than
    // failing closed at runtime — but only the spec can tell CD from CG.
    this.senderTables = {
      CD: prisma.senderProfileCd,
      CG: prisma.senderProfileCg,
      UG: prisma.senderProfileUg,
      KE: prisma.senderProfileKe,
      TZ: prisma.senderProfileTz,
      ZM: prisma.senderProfileZm,
      GM: prisma.senderProfileGm,
      NE: prisma.senderProfileNe,
      ML: prisma.senderProfileMl,
      SN: prisma.senderProfileSn,
    };
    this.recipientTables = {
      CD: prisma.recipientProfileCd,
      CG: prisma.recipientProfileCg,
      UG: prisma.recipientProfileUg,
      KE: prisma.recipientProfileKe,
      TZ: prisma.recipientProfileTz,
      ZM: prisma.recipientProfileZm,
      GM: prisma.recipientProfileGm,
      NE: prisma.recipientProfileNe,
      ML: prisma.recipientProfileMl,
      SN: prisma.recipientProfileSn,
    };
  }

  /** The sender store for one partition, in the shape the gateway consumes. */
  senderStore(partition: StandardPartition): StandardSenderStore {
    const table = this.senderTables[partition];
    return {
      upsert: async (input) => {
        const data: SenderRow = {
          firstName: input.firstName,
          lastName: input.lastName,
          middleName: input.middleName ?? null,
          dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00Z`),
          nationality: input.nationality,
          phone: input.phone ?? null,
          addressLine: input.addressLine ?? null,
          city: input.city ?? null,
          nationalIdNo: input.nationalIdNo ?? null,
          walletMsisdn: input.walletMsisdn ?? null,
          walletNetwork: input.walletNetwork ?? null,
          documents: input.documents as object[],
        };
        await table.upsert({
          where: { piiToken: input.piiToken },
          update: data,
          create: { piiToken: input.piiToken, ...data },
        });
      },

      // Name, date of birth, nationality. Never the national identifier.
      screeningProjection: async (piiToken) => {
        const row = await table.findUnique({
          where: { piiToken },
          select: {
            firstName: true,
            middleName: true,
            lastName: true,
            dateOfBirth: true,
            nationality: true,
          },
        });
        if (row === null) return null;
        return {
          fullName: [row.firstName, row.middleName, row.lastName]
            .filter((part): part is string => typeof part === 'string' && part.length > 0)
            .join(' '),
          dateOfBirth: (row.dateOfBirth as Date).toISOString().slice(0, 10),
          nationality: row.nationality as string,
        };
      },

      // A number and a network, no name attached: it goes straight into the
      // outbound provider request and is never persisted in the neutral tier.
      collectionWallet: async (piiToken) => {
        const row = await table.findUnique({
          where: { piiToken },
          select: { walletMsisdn: true, walletNetwork: true },
        });
        const msisdn = row?.walletMsisdn;
        const network = row?.walletNetwork;
        if (typeof msisdn !== 'string' || typeof network !== 'string') return null;
        return { msisdn, network };
      },

      count: () => table.count(),
    };
  }

  /** The recipient store for one partition. */
  recipientStore(partition: StandardPartition): StandardRecipientStore {
    const table = this.recipientTables[partition];
    return {
      upsert: async (input) => {
        const data: RecipientRow = {
          msisdn: input.msisdn,
          network: input.network,
          accountName: input.accountName,
        };
        await table.upsert({
          where: { piiToken: input.piiToken },
          update: data,
          create: { piiToken: input.piiToken, ...data },
        });
      },

      find: async (piiToken) => {
        const row = await table.findUnique({
          where: { piiToken },
          select: { msisdn: true, network: true, accountName: true },
        });
        if (row === null) return null;
        return {
          msisdn: row.msisdn as string,
          network: row.network as string,
          accountName: row.accountName as string,
        };
      },

      count: () => table.count(),
    };
  }
}
