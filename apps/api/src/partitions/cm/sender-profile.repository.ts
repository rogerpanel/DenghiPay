import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/**
 * CM partition — Cameroonian-resident sender personal data.
 *
 * CEMAC/BEAC, and Law 2024/017 on personal data protection.
 *
 * Reached only through `PartitionGateway`. Nothing outside `src/partitions/cm`
 * may import this file, and this file may not import from a sibling partition;
 * CI enforces both.
 */
@Injectable()
export class SenderProfileCmRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: {
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
  }): Promise<void> {
    const data = {
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

    await this.prisma.senderProfileCm.upsert({
      where: { piiToken: input.piiToken },
      update: data,
      create: { piiToken: input.piiToken, ...data },
    });
  }

  /** Name, date of birth, nationality. Never the national identifier. */
  async screeningProjection(
    piiToken: string,
  ): Promise<{ fullName: string; dateOfBirth: string; nationality: string } | null> {
    const row = await this.prisma.senderProfileCm.findUnique({
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
      fullName: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(' '),
      dateOfBirth: row.dateOfBirth.toISOString().slice(0, 10),
      nationality: row.nationality,
    };
  }

  /**
   * The wallet a collection debits. A number and a network, no name attached:
   * it goes straight into the outbound provider request and is never persisted
   * in the neutral tier.
   */
  async collectionWallet(piiToken: string): Promise<{ msisdn: string; network: string } | null> {
    const row = await this.prisma.senderProfileCm.findUnique({
      where: { piiToken },
      select: { walletMsisdn: true, walletNetwork: true },
    });
    if (row?.walletMsisdn == null || row.walletNetwork == null) return null;
    return { msisdn: row.walletMsisdn, network: row.walletNetwork };
  }

  async exists(piiToken: string): Promise<boolean> {
    return (await this.prisma.senderProfileCm.count({ where: { piiToken } })) > 0;
  }
}
