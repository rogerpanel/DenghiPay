import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/**
 * BJ partition — Beninese recipient personal data.
 *
 * Reached only through `PartitionGateway`.
 */
@Injectable()
export class RecipientProfileBjRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: {
    readonly piiToken: string;
    readonly msisdn: string;
    readonly network: string;
    readonly accountName: string;
  }): Promise<void> {
    await this.prisma.recipientProfileBj.upsert({
      where: { piiToken: input.piiToken },
      update: {
        msisdn: input.msisdn,
        network: input.network,
        accountName: input.accountName,
      },
      create: input as {
        piiToken: string;
        msisdn: string;
        network: string;
        accountName: string;
      },
    });
  }

  async find(
    piiToken: string,
  ): Promise<{ msisdn: string; network: string; accountName: string } | null> {
    return this.prisma.recipientProfileBj.findUnique({
      where: { piiToken },
      select: { msisdn: true, network: true, accountName: true },
    });
  }
}
