import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/**
 * NG partition — Nigerian-resident sender personal data.
 *
 * CBN localisation and the NDPA 2023 both point the same way: this row stays
 * in Nigeria. Reached only through `PartitionGateway`. Nothing outside
 * `src/partitions/ng` may import this file, and this file may not import from
 * `../ru` or `../gh`; CI enforces both.
 */
@Injectable()
export class SenderProfileNgRepository {
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
    readonly bvn?: string;
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
      bvn: input.bvn ?? null,
      documents: input.documents as object[],
    };

    await this.prisma.senderProfileNg.upsert({
      where: { piiToken: input.piiToken },
      update: data,
      create: { piiToken: input.piiToken, ...data },
    });
  }

  /** Name, date of birth, nationality. Never the BVN — screening has no use for it. */
  async screeningProjection(
    piiToken: string,
  ): Promise<{ fullName: string; dateOfBirth: string; nationality: string } | null> {
    const row = await this.prisma.senderProfileNg.findUnique({
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

  async exists(piiToken: string): Promise<boolean> {
    return (await this.prisma.senderProfileNg.count({ where: { piiToken } })) > 0;
  }
}
