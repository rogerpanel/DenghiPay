import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/**
 * ZA partition — South African-resident sender personal data. POPIA.
 *
 * Two projections leave this store and they are deliberately different sizes.
 * `screeningProjection` is the usual narrow one. `exchangeControlSubject` is
 * wider — it carries the date of birth and the tax reference — because SARB
 * exchange control genuinely needs them: the allowance depends on the sender's
 * age, and the larger allowance may not be used without a tax compliance
 * reference. Neither leaves South Africa; both are read in memory at the moment
 * a decision is made.
 *
 * Reached only through `PartitionGateway`. Nothing outside `src/partitions/za`
 * may import this file, and this file may not import from a sibling partition;
 * CI enforces both.
 */
@Injectable()
export class SenderProfileZaRepository {
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
    readonly nationalIdNo?: string;
    readonly taxReference?: string;
    readonly exchangeControlStatus?: string;
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
      nationalIdNo: input.nationalIdNo ?? null,
      taxReference: input.taxReference ?? null,
      // Residency status decides which allowances apply. Absent means unknown,
      // and unknown is refused rather than assumed to be resident.
      exchangeControlStatus: input.exchangeControlStatus ?? null,
      documents: input.documents as object[],
    };

    await this.prisma.senderProfileZa.upsert({
      where: { piiToken: input.piiToken },
      update: data,
      create: { piiToken: input.piiToken, ...data },
    });
  }

  async screeningProjection(
    piiToken: string,
  ): Promise<{ fullName: string; dateOfBirth: string; nationality: string } | null> {
    const row = await this.prisma.senderProfileZa.findUnique({
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
   * What the exchange-control gate needs, and nothing more.
   *
   * The age rather than the date of birth: the caller only ever compares it
   * against an adult threshold, and a whole number of years is a smaller thing
   * to hand across a boundary than a birthday.
   */
  async exchangeControlSubject(piiToken: string): Promise<{
    ageYears: number;
    taxReference: string | null;
    status: string | null;
  } | null> {
    const row = await this.prisma.senderProfileZa.findUnique({
      where: { piiToken },
      select: { dateOfBirth: true, taxReference: true, exchangeControlStatus: true },
    });
    if (row === null) return null;
    return {
      ageYears: wholeYearsSince(row.dateOfBirth),
      taxReference: row.taxReference,
      status: row.exchangeControlStatus,
    };
  }

  /** The identity fields an Authorised Dealer reports a payment against. */
  async reportingSubject(piiToken: string): Promise<{
    fullName: string;
    nationalIdNo: string | null;
    taxReference: string | null;
  } | null> {
    const row = await this.prisma.senderProfileZa.findUnique({
      where: { piiToken },
      select: {
        firstName: true,
        middleName: true,
        lastName: true,
        nationalIdNo: true,
        taxReference: true,
      },
    });
    if (row === null) return null;
    return {
      fullName: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(' '),
      nationalIdNo: row.nationalIdNo,
      taxReference: row.taxReference,
    };
  }

  async exists(piiToken: string): Promise<boolean> {
    return (await this.prisma.senderProfileZa.count({ where: { piiToken } })) > 0;
  }
}

/**
 * Whole years elapsed, without a date library.
 *
 * Compares the month and day so that somebody whose birthday is later this year
 * is not aged up early — the difference matters exactly once, on the threshold
 * where an allowance begins.
 */
function wholeYearsSince(from: Date, at: Date = new Date()): number {
  let years = at.getUTCFullYear() - from.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < from.getUTCMonth() ||
    (at.getUTCMonth() === from.getUTCMonth() && at.getUTCDate() < from.getUTCDate());
  if (beforeBirthday) years -= 1;
  return years;
}
