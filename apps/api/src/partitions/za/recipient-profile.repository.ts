import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/**
 * ZA partition — South African recipient personal data. POPIA.
 *
 * Its sender counterpart is `sender-profile.repository.ts`, added when South
 * Africa became an origin: a ZA sender's row carries an identity number and an
 * exchange-control status, because a declaration cannot be decided without
 * them.
 *
 * Reached only through `PartitionGateway`.
 */
@Injectable()
export class RecipientProfileZaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: {
    readonly piiToken: string;
    readonly accountNumber: string;
    readonly bankCode: string;
    readonly accountName: string;
  }): Promise<void> {
    await this.prisma.recipientProfileZa.upsert({
      where: { piiToken: input.piiToken },
      update: {
        accountNumber: input.accountNumber,
        bankCode: input.bankCode,
        accountName: input.accountName,
      },
      create: input as {
        piiToken: string;
        accountNumber: string;
        bankCode: string;
        accountName: string;
      },
    });
  }

  async find(
    piiToken: string,
  ): Promise<{ accountNumber: string; bankCode: string; accountName: string } | null> {
    return this.prisma.recipientProfileZa.findUnique({
      where: { piiToken },
      select: { accountNumber: true, bankCode: true, accountName: true },
    });
  }
}
