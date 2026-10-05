import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CurrencyCode, ExchangeRate, TransferPurpose, requireCurrencyCode } from '@morapay/domain';
import { ReceiptDto } from '@morapay/contracts';
import { PrismaService } from '../common/prisma.service';
import { PartitionGateway } from '../partitions/partition-gateway.service';
import { AuditService } from '../audit/audit.service';
import { moneyDtoFrom } from '../common/money.util';

/**
 * Proof of payment (BUILD_PLAN 14.2).
 *
 * People forward these to landlords, universities and immigration officers, so
 * three properties matter more than the layout:
 *
 *  - **Only for a transfer that is finished.** A receipt for a payment still in
 *    flight is a promise, and the person receiving it cannot tell the
 *    difference. Terminal states only.
 *  - **It names the payer.** A receipt with no payer on it is not evidence of
 *    anything. That name lives in the residency partition, so it is fetched
 *    through the gateway at the moment the receipt is produced and is never
 *    copied into the neutral tier.
 *  - **Issuing one is audited.** It is a read of personal data joined to a
 *    payment, which is exactly the sort of read an investigation asks about.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partitions: PartitionGateway,
    private readonly audit: AuditService,
  ) {}

  /** Terminal states a receipt may be issued for, and what it says about each. */
  private static readonly ISSUABLE: Readonly<Record<string, string>> = {
    COMPLETED: 'Delivered',
    REFUNDED: 'Refunded to the sender',
  };

  async forTransfer(userId: string, transferId: string): Promise<ReceiptDto> {
    const transfer = await this.prisma.transfer.findUnique({
      where: { id: transferId },
      include: {
        recipient: true,
        quote: true,
        corridor: true,
        exchangeControl: true,
      },
    });
    if (transfer === null || transfer.userId !== userId) {
      throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND', message: 'No such transfer' });
    }

    const status = ReceiptsService.ISSUABLE[transfer.state];
    if (status === undefined) {
      throw new BadRequestException({
        code: 'RECEIPT_NOT_AVAILABLE',
        message:
          'A receipt is issued once a transfer has finished. This one is still in progress, and ' +
          'a receipt for a payment in flight would say more than we know.',
      });
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { piiToken: true, piiPartition: true },
    });
    // The one place a payment and a payer's name come together. In memory, at
    // the moment it is asked for, and never written back.
    const senderName = await this.partitions.senderDisplayName(user.piiToken, user.piiPartition);

    const send = requireCurrencyCode(transfer.sendCurrency);
    const receive = requireCurrencyCode(transfer.recipientCurrency);

    await this.audit.record({
      actorType: 'USER',
      actorId: userId,
      action: 'RECEIPT_ISSUED',
      subjectType: 'TRANSFER',
      subjectId: transferId,
    });

    return {
      reference: transfer.reference,
      status,
      issuedAt: new Date().toISOString(),
      valueDate: transfer.createdAt.toISOString(),
      completedAt: transfer.completedAt?.toISOString() ?? null,
      senderName,
      senderCountry: transfer.corridor.sourceCountry,
      recipientName: transfer.recipient.resolvedName,
      recipientMasked: transfer.recipient.maskedAccount,
      recipientCountry: transfer.recipient.country,
      recipientMethod: transfer.recipient.method,
      corridorId: transfer.corridorId,
      purpose: transfer.purpose as TransferPurpose,
      sendAmount: moneyDtoFrom(transfer.sendMinorUnits, send),
      fee: moneyDtoFrom(transfer.feeMinorUnits, send),
      totalPaid: moneyDtoFrom(transfer.totalToPayMinorUnits, send),
      recipientAmount: moneyDtoFrom(transfer.recipientMinorUnits, receive),
      midRate: rateString(
        transfer.quote.midRateNumerator,
        transfer.quote.midRateScale,
        send,
        receive,
      ),
      effectiveRate: rateString(
        transfer.quote.effectiveRateNumerator,
        transfer.quote.effectiveRateScale,
        send,
        receive,
      ),
      fxMarginBps: transfer.quote.fxMarginBps,
      declaration:
        transfer.exchangeControl === null
          ? null
          : {
              regime: transfer.exchangeControl.regimeCountry,
              categoryCode: transfer.exchangeControl.categoryCode,
              categoryLabel: transfer.exchangeControl.categoryLabel,
              allowanceYear: transfer.exchangeControl.allowanceYear,
            },
    };
  }
}

/** The stored numerator and scale, back to the string a person reads. */
function rateString(
  numerator: bigint,
  scale: number,
  from: CurrencyCode,
  to: CurrencyCode,
): string {
  return ExchangeRate.of(from, to, numerator, scale).toDecimalString();
}
