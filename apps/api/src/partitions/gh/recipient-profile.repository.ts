import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/** GH partition — Ghanaian recipient personal data and mobile-money details. */
@Injectable()
export class RecipientProfileGhRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: {
    readonly piiToken: string;
    readonly msisdn: string;
    readonly network: string;
    readonly accountName: string;
  }): Promise<void> {
    const data = {
      msisdn: input.msisdn,
      network: input.network,
      accountName: input.accountName,
    };
    await this.prisma.recipientProfileGh.upsert({
      where: { piiToken: input.piiToken },
      update: data,
      create: { piiToken: input.piiToken, ...data },
    });
  }

  async find(
    piiToken: string,
  ): Promise<{ msisdn: string; network: string; accountName: string } | null> {
    return this.prisma.recipientProfileGh.findUnique({
      where: { piiToken },
      select: { msisdn: true, network: true, accountName: true },
    });
  }
}
