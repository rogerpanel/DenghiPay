import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/**
 * NG partition — Nigerian recipient personal data and payment details.
 *
 * CBN data localisation applies from 1 January 2027; the separation exists now
 * so that meeting it is a deployment change rather than a migration.
 */
@Injectable()
export class RecipientProfileNgRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: {
    readonly piiToken: string;
    readonly accountNumber: string;
    readonly bankCode: string;
    readonly accountName: string;
    readonly phone?: string;
  }): Promise<void> {
    const data = {
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
      accountName: input.accountName,
      phone: input.phone ?? null,
    };
    await this.prisma.recipientProfileNg.upsert({
      where: { piiToken: input.piiToken },
      update: data,
      create: { piiToken: input.piiToken, ...data },
    });
  }

  async find(
    piiToken: string,
  ): Promise<{ accountNumber: string; bankCode: string; accountName: string } | null> {
    return this.prisma.recipientProfileNg.findUnique({
      where: { piiToken },
      select: { accountNumber: true, bankCode: true, accountName: true },
    });
  }
}
