import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/**
 * ZA partition — South African recipient personal data. POPIA.
 *
 * There is no sender repository beside this one, and that is the design: South
 * Africa receives and does not send until SARB exchange-control reporting
 * exists, so a South African sender has nowhere to be stored.
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
