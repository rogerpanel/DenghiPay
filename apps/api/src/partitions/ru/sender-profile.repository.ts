import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/**
 * RU partition — Russian-resident sender personal data (152-FZ).
 *
 * Reached only through `PartitionGateway`. Nothing outside `src/partitions/ru`
 * may import this file, and this file may not import from `../ng` or `../gh`;
 * CI enforces both.
 */
@Injectable()
export class SenderProfileRuRepository {
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
    readonly postcode?: string;
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
      postcode: input.postcode ?? null,
      documents: input.documents as object[],
    };

    await this.prisma.senderProfileRu.upsert({
      where: { piiToken: input.piiToken },
      update: data,
      create: { piiToken: input.piiToken, ...data },
    });
  }

  /**
   * The narrowest projection screening can work with: a name, a date of birth
   * and a nationality. No address, no document numbers, no contact details.
   */
  async screeningProjection(
    piiToken: string,
  ): Promise<{ fullName: string; dateOfBirth: string; nationality: string } | null> {
    const row = await this.prisma.senderProfileRu.findUnique({
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
    return (await this.prisma.senderProfileRu.count({ where: { piiToken } })) > 0;
  }
}
