import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CurrencyCode,
  ExchangeRate,
  Money,
  QuoteBreakdown,
  RoundingMode,
  computeQuote,
  isQuoteExpired,
  quoteSigningPayload,
  requireCurrencyCode,
} from '@morapay/domain';
import { QuoteResponse } from '@morapay/contracts';
import { PrismaService } from '../common/prisma.service';
import { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/tokens';
import { CorridorsService } from './corridors.service';
import { RatesService } from './rates.service';
import { constantTimeEquals, hmacSha256 } from '../common/crypto.util';
import { toMoneyDto } from '../common/money.util';

/**
 * Quote engine (BUILD_PLAN 4.2).
 *
 * A quote is signed, short-lived and single-use. The signature covers every
 * component of the promise, so a client that edits the recipient amount before
 * confirming gets a rejection rather than a transfer.
 */
@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly corridors: CorridorsService,
    private readonly rates: RatesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(
    userId: string,
    input: { corridorId: string; sendMinorUnits: string },
    now = new Date(),
  ): Promise<QuoteResponse> {
    const corridor = await this.corridors.get(input.corridorId);
    const sendAmount = Money.fromMinorUnits(BigInt(input.sendMinorUnits), corridor.sourceCurrency);

    const { rate, observedAt, ageMs } = await this.rates.rateForQuoting(
      corridor.sourceCurrency,
      corridor.destinationCurrency,
      now,
    );

    const breakdown = computeQuote({
      corridor,
      sendAmount,
      midRate: rate,
      at: now,
      rateAgeMs: ageMs,
      maxRateAgeMs: this.config.RATE_MAX_AGE_MS,
      ttlSeconds: this.config.QUOTE_TTL_SECONDS,
    });

    const row = await this.prisma.quote.create({
      data: {
        userId,
        corridorId: corridor.id,
        sendMinorUnits: breakdown.sendAmount.minorUnits,
        sendCurrency: breakdown.sendAmount.currency,
        fixedFeeMinorUnits: breakdown.fixedFee.minorUnits,
        fxMarginMinorUnits: breakdown.fxMargin.minorUnits,
        totalToPayMinorUnits: breakdown.totalToPay.minorUnits,
        recipientMinorUnits: breakdown.recipientAmount.minorUnits,
        recipientCurrency: breakdown.recipientAmount.currency,
        midRateNumerator: breakdown.midRate.numerator,
        midRateScale: breakdown.midRate.scale,
        effectiveRateNumerator: breakdown.effectiveRate.numerator,
        effectiveRateScale: breakdown.effectiveRate.scale,
        fxMarginBps: breakdown.fxMarginBps,
        expiresAt: breakdown.expiresAt,
        // Placeholder; replaced below once the row id exists.
        signature: '',
      },
    });

    const signature = this.sign(row.id, breakdown);
    await this.prisma.quote.update({ where: { id: row.id }, data: { signature } });

    return this.toResponse(row.id, breakdown, observedAt, now);
  }

  /**
   * Load a quote for confirmation.
   *
   * Four things are checked, and all four have bitten someone before: does it
   * belong to this user, has it expired, has it already been used, and is the
   * signature still ours.
   */
  async consume(
    userId: string,
    quoteId: string,
    now = new Date(),
  ): Promise<{
    id: string;
    corridorId: string;
    sendAmount: Money;
    fixedFee: Money;
    fxMargin: Money;
    totalToPay: Money;
    recipientAmount: Money;
    effectiveRate: ExchangeRate;
    midRate: ExchangeRate;
    expiresAt: Date;
  }> {
    const row = await this.prisma.quote.findUnique({ where: { id: quoteId } });
    if (row === null || row.userId !== userId) {
      throw new NotFoundException({ code: 'QUOTE_NOT_FOUND', message: 'No such quote' });
    }
    if (row.consumedAt !== null) {
      throw new BadRequestException({
        code: 'QUOTE_ALREADY_USED',
        message: 'That quote has already been used. Request a new one.',
      });
    }
    if (isQuoteExpired({ expiresAt: row.expiresAt }, now)) {
      throw new BadRequestException({
        code: 'QUOTE_EXPIRED',
        message: 'That quote has expired. Rates move; request a new one.',
      });
    }

    const rebuilt = this.rebuild(row);
    const expected = this.sign(row.id, rebuilt);
    if (!constantTimeEquals(expected, row.signature)) {
      // The stored quote does not verify against its own contents. Either the
      // row was edited outside the application or the signing key changed.
      throw new BadRequestException({
        code: 'QUOTE_SIGNATURE_INVALID',
        message: 'That quote could not be verified. Request a new one.',
      });
    }

    return {
      id: row.id,
      corridorId: row.corridorId,
      sendAmount: rebuilt.sendAmount,
      fixedFee: rebuilt.fixedFee,
      fxMargin: rebuilt.fxMargin,
      totalToPay: rebuilt.totalToPay,
      recipientAmount: rebuilt.recipientAmount,
      effectiveRate: rebuilt.effectiveRate,
      midRate: rebuilt.midRate,
      expiresAt: row.expiresAt,
    };
  }

  /** Marks a quote used, inside the caller's transaction if one is supplied. */
  async markConsumed(quoteId: string, now = new Date()): Promise<void> {
    await this.prisma.quote.update({ where: { id: quoteId }, data: { consumedAt: now } });
  }

  private sign(quoteId: string, breakdown: QuoteBreakdown<CurrencyCode, CurrencyCode>): string {
    return hmacSha256(this.config.QUOTE_SIGNING_SECRET, quoteSigningPayload(quoteId, breakdown));
  }

  /** Rebuild the breakdown from the stored row — the DoD for step 4.2. */
  private rebuild(row: {
    corridorId: string;
    sendMinorUnits: bigint;
    sendCurrency: string;
    fixedFeeMinorUnits: bigint;
    fxMarginMinorUnits: bigint;
    totalToPayMinorUnits: bigint;
    recipientMinorUnits: bigint;
    recipientCurrency: string;
    midRateNumerator: bigint;
    midRateScale: number;
    effectiveRateNumerator: bigint;
    effectiveRateScale: number;
    fxMarginBps: number;
    createdAt: Date;
    expiresAt: Date;
  }): QuoteBreakdown<CurrencyCode, CurrencyCode> {
    const send = requireCurrencyCode(row.sendCurrency);
    const receive = requireCurrencyCode(row.recipientCurrency);
    const midRate = ExchangeRate.of(send, receive, row.midRateNumerator, row.midRateScale);
    const effectiveRate = ExchangeRate.of(
      send,
      receive,
      row.effectiveRateNumerator,
      row.effectiveRateScale,
    );

    return {
      corridorId: row.corridorId,
      sendAmount: Money.fromMinorUnits(row.sendMinorUnits, send),
      fixedFee: Money.fromMinorUnits(row.fixedFeeMinorUnits, send),
      fxMargin: Money.fromMinorUnits(row.fxMarginMinorUnits, send),
      totalToPay: Money.fromMinorUnits(row.totalToPayMinorUnits, send),
      totalCost: Money.fromMinorUnits(row.fixedFeeMinorUnits + row.fxMarginMinorUnits, send),
      midRate,
      effectiveRate,
      fxMarginBps: row.fxMarginBps,
      recipientAmount: Money.fromMinorUnits(row.recipientMinorUnits, receive),
      recipientAmountAtMid: midRate.convert(
        Money.fromMinorUnits(row.sendMinorUnits, send),
        RoundingMode.DOWN,
      ),
      quotedAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }

  private toResponse(
    id: string,
    breakdown: QuoteBreakdown<CurrencyCode, CurrencyCode>,
    rateObservedAt: Date,
    now: Date,
  ): QuoteResponse {
    return {
      id,
      corridorId: breakdown.corridorId,
      sendAmount: toMoneyDto(breakdown.sendAmount),
      fixedFee: toMoneyDto(breakdown.fixedFee),
      fxMargin: toMoneyDto(breakdown.fxMargin),
      totalToPay: toMoneyDto(breakdown.totalToPay),
      totalCost: toMoneyDto(breakdown.totalCost),
      recipientAmount: toMoneyDto(breakdown.recipientAmount),
      recipientAmountAtMid: toMoneyDto(breakdown.recipientAmountAtMid),
      midRate: breakdown.midRate.toDecimalString(),
      effectiveRate: breakdown.effectiveRate.toDecimalString(),
      fxMarginBps: breakdown.fxMarginBps,
      rateObservedAt: rateObservedAt.toISOString(),
      quotedAt: breakdown.quotedAt.toISOString(),
      expiresAt: breakdown.expiresAt.toISOString(),
      expiresInSeconds: Math.max(
        0,
        Math.round((breakdown.expiresAt.getTime() - now.getTime()) / 1000),
      ),
    };
  }
}
