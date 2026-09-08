import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { requireCurrencyCode, residencyPermitsOrigin } from '@morapay/domain';
import {
  CreateScheduleRequest,
  ScheduleDto,
  ScheduleFrequency,
  TransferPurposeDto,
} from '@morapay/contracts';
import { PrismaService } from '../common/prisma.service';
import { CorridorsService } from '../quoting/corridors.service';
import { QuotesService } from '../quoting/quotes.service';
import { TransfersService } from './transfers.service';
import { ExchangeControlService } from '../compliance/exchange-control.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { moneyDtoFrom } from '../common/money.util';

/**
 * Standing instructions (BUILD_PLAN 14.4).
 *
 * The load-bearing sentence: **a schedule prepares a transfer; it does not
 * authorise one.** Every occurrence takes a fresh quote at the rate of the day,
 * runs screening again, and is judged against the sender's limits again. None
 * of that is inherited from the day the schedule was created, because a
 * schedule that carried its own authorisation forward would be a way to make a
 * payment today under the checks of six months ago.
 *
 * It also does not pay. There is no direct-debit mandate behind this, so an
 * occurrence produces a transfer awaiting the sender's payment and a
 * notification telling them so. That is the honest shape of the feature, and
 * the UI says it in those words rather than implying money moves by itself.
 */
@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly corridors: CorridorsService,
    private readonly quotes: QuotesService,
    private readonly transfers: TransfersService,
    private readonly exchangeControl: ExchangeControlService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, input: CreateScheduleRequest): Promise<ScheduleDto> {
    const corridor = await this.corridors.get(input.corridorId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (!residencyPermitsOrigin(user.piiPartition, corridor.sourceCountry)) {
      throw new ForbiddenException({
        code: 'CORRIDOR_RESIDENCY_MISMATCH',
        message: 'That corridor is not available from your country of residence',
      });
    }

    /**
     * A declaration is an affirmation the sender makes about a specific
     * payment, at the moment they make it. Recording one today and replaying it
     * against payments for the next year is not a declaration, it is a
     * signature we forged on their behalf — so corridors under exchange control
     * cannot be scheduled at all.
     */
    if (this.exchangeControl.regimeFor(corridor.sourceCountry) !== undefined) {
      throw new BadRequestException({
        code: 'SCHEDULE_REQUIRES_DECLARATION',
        message:
          'Payments from this country must be declared under an exchange-control category each ' +
          'time they are sent, so they cannot be scheduled. Send them one at a time.',
      });
    }

    if (!corridor.enabled) {
      throw new BadRequestException({
        code: 'CORRIDOR_DISABLED',
        message: 'That corridor is not open',
      });
    }

    const recipient = await this.prisma.recipient.findUnique({
      where: { id: input.recipientId },
    });
    if (recipient === null || recipient.userId !== userId || recipient.archivedAt !== null) {
      throw new NotFoundException({ code: 'RECIPIENT_NOT_FOUND', message: 'No such recipient' });
    }
    if (recipient.country !== corridor.destinationCountry) {
      throw new BadRequestException({
        code: 'RECIPIENT_CORRIDOR_MISMATCH',
        message: 'That recipient is not in this corridor’s destination country',
      });
    }
    if (!corridor.payinMethods.includes(input.payinMethod)) {
      throw new BadRequestException({
        code: 'PAYIN_METHOD_UNAVAILABLE',
        message: 'That corridor does not collect by that method',
      });
    }

    const amount = BigInt(input.sendMinorUnits);
    if (amount < corridor.limits.minSendMinorUnits || amount > corridor.limits.maxSendMinorUnits) {
      throw new BadRequestException({
        code: 'AMOUNT_OUT_OF_RANGE',
        message: 'That amount is outside this corridor’s limits',
      });
    }

    const row = await this.prisma.transferSchedule.create({
      data: {
        userId,
        corridorId: corridor.id,
        recipientId: recipient.id,
        sendMinorUnits: amount,
        sendCurrency: corridor.sourceCurrency,
        payinMethod: input.payinMethod,
        purpose: input.purpose,
        frequency: input.frequency,
        dayOfPeriod: input.dayOfPeriod,
        nextRunAt: nextRunAfter(new Date(), input.frequency, input.dayOfPeriod),
      },
      include: { recipient: true },
    });

    await this.audit.record({
      actorType: 'USER',
      actorId: userId,
      action: 'SCHEDULE_CREATED',
      subjectType: 'SCHEDULE',
      subjectId: row.id,
      after: {
        corridorId: corridor.id,
        frequency: input.frequency,
        dayOfPeriod: input.dayOfPeriod,
        sendMinorUnits: input.sendMinorUnits,
      },
    });

    return toDto(row);
  }

  async list(userId: string): Promise<ScheduleDto[]> {
    const rows = await this.prisma.transferSchedule.findMany({
      where: { userId },
      include: { recipient: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDto);
  }

  /**
   * Pause or resume.
   *
   * Cancelling is a pause, not a delete: a sender asking "did you take money
   * from me in March" deserves an answer, and a deleted schedule cannot give
   * one.
   */
  async setActive(userId: string, id: string, active: boolean): Promise<ScheduleDto> {
    const existing = await this.prisma.transferSchedule.findUnique({ where: { id } });
    if (existing === null || existing.userId !== userId) {
      throw new NotFoundException({ code: 'SCHEDULE_NOT_FOUND', message: 'No such schedule' });
    }

    const row = await this.prisma.transferSchedule.update({
      where: { id },
      data: {
        active,
        // Resuming skips the occurrences that fell in the pause rather than
        // firing them all at once.
        ...(active
          ? {
              nextRunAt: nextRunAfter(
                new Date(),
                existing.frequency as ScheduleFrequency,
                existing.dayOfPeriod,
              ),
            }
          : {}),
      },
      include: { recipient: true },
    });

    await this.audit.record({
      actorType: 'USER',
      actorId: userId,
      action: active ? 'SCHEDULE_RESUMED' : 'SCHEDULE_PAUSED',
      subjectType: 'SCHEDULE',
      subjectId: id,
      before: { active: existing.active },
      after: { active },
    });

    return toDto(row);
  }

  /**
   * Run everything that is due.
   *
   * Hourly rather than by the minute: these are weekly and monthly
   * instructions, and an occurrence landing at 09:00 instead of 09:00:00 is not
   * a defect anybody can perceive.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async runDue(now = new Date()): Promise<{ prepared: number; failed: number }> {
    const due = await this.prisma.transferSchedule.findMany({
      where: { active: true, nextRunAt: { lte: now } },
      take: 100,
    });

    let prepared = 0;
    let failed = 0;
    for (const schedule of due) {
      // Advance first. If preparing throws in a way we did not anticipate, the
      // schedule moves on rather than retrying every hour for a month.
      const advanced = nextRunAfter(
        now,
        schedule.frequency as ScheduleFrequency,
        schedule.dayOfPeriod,
      );

      try {
        await this.prepareOne(schedule, now);
        await this.prisma.transferSchedule.update({
          where: { id: schedule.id },
          data: {
            nextRunAt: advanced,
            lastRunAt: now,
            lastFailure: null,
            occurrences: { increment: 1 },
          },
        });
        prepared += 1;
      } catch (error) {
        const reason = messageOf(error);
        await this.prisma.transferSchedule.update({
          where: { id: schedule.id },
          data: { nextRunAt: advanced, lastRunAt: now, lastFailure: reason.slice(0, 300) },
        });
        // The sender is told, because a standing instruction that silently
        // stopped working is worse than one that never existed.
        await this.notifications.notify({
          userId: schedule.userId,
          kind: 'SCHEDULE_FAILED',
          title: 'A scheduled transfer could not be prepared',
          body: reason,
          link: '/schedules',
        });
        failed += 1;
        // Id only. The reason can quote a limit but never a name (guardrail G9).
        this.logger.warn(`schedule ${schedule.id} did not produce a transfer: ${reason}`);
      }
    }

    if (prepared > 0 || failed > 0) {
      this.logger.log(`schedules run: ${prepared} prepared, ${failed} failed`);
    }
    return { prepared, failed };
  }

  /**
   * One occurrence: a fresh quote, then the ordinary transfer path.
   *
   * Note what this does *not* do — it does not reach past `TransfersService`
   * into the ledger, and it does not pass a flag that skips anything. It is the
   * same call the send screen makes, which is the only way to be sure a
   * scheduled payment is checked exactly as a manual one is.
   */
  private async prepareOne(
    schedule: {
      id: string;
      userId: string;
      corridorId: string;
      recipientId: string;
      sendMinorUnits: bigint;
      payinMethod: string;
      purpose: string;
      occurrences: number;
    },
    now: Date,
  ): Promise<void> {
    const recipient = await this.prisma.recipient.findUniqueOrThrow({
      where: { id: schedule.recipientId },
    });

    const quote = await this.quotes.create(schedule.userId, {
      corridorId: schedule.corridorId,
      sendMinorUnits: schedule.sendMinorUnits.toString(),
    });

    // Deterministic, so a retry of the same occurrence cannot create a second
    // transfer. The occurrence number is part of it because the same schedule
    // legitimately fires again next month (guardrail 6).
    const idempotencyKey = `schedule-${schedule.id}-${schedule.occurrences}`;

    const transfer = await this.transfers.create(
      schedule.userId,
      {
        quoteId: quote.id,
        recipientId: schedule.recipientId,
        payinMethod: schedule.payinMethod as never,
        purpose: schedule.purpose as TransferPurposeDto,
        confirmedRecipientName: recipient.resolvedName ?? '',
      },
      idempotencyKey,
    );

    await this.notifications.notify({
      userId: schedule.userId,
      kind: 'SCHEDULE_PREPARED',
      title: 'Your scheduled transfer is ready to pay',
      body:
        `${transfer.reference} — ${transfer.recipientAmount.formatted} to ` +
        `${recipient.resolvedName ?? 'your recipient'}. It is waiting for your payment.`,
      link: `/transfers/${transfer.id}`,
    });

    await this.audit.record({
      actorType: 'SYSTEM',
      action: 'SCHEDULE_OCCURRENCE_PREPARED',
      subjectType: 'SCHEDULE',
      subjectId: schedule.id,
      after: { transferId: transfer.id, occurrence: schedule.occurrences, at: now.toISOString() },
    });
  }
}

/**
 * The next occurrence after `from`.
 *
 * Monthly days are capped at 28 by the contract, so this never has to decide
 * what the 31st means in February — a decision that is always wrong for
 * somebody.
 */
export function nextRunAfter(from: Date, frequency: ScheduleFrequency, dayOfPeriod: number): Date {
  const next = new Date(from);
  next.setUTCHours(9, 0, 0, 0);

  if (frequency === 'WEEKLY') {
    // ISO weekday: 1 is Monday, 7 is Sunday. getUTCDay reports Sunday as 0.
    const current = next.getUTCDay() === 0 ? 7 : next.getUTCDay();
    let delta = dayOfPeriod - current;
    if (delta < 0 || (delta === 0 && next <= from)) delta += 7;
    next.setUTCDate(next.getUTCDate() + delta);
    return next;
  }

  next.setUTCDate(dayOfPeriod);
  if (next <= from) {
    next.setUTCMonth(next.getUTCMonth() + 1);
    next.setUTCDate(dayOfPeriod);
  }
  return next;
}

function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const body = (error as { response?: { message?: string } }).response;
    if (typeof body?.message === 'string') return body.message;
  }
  return error instanceof Error ? error.message : 'Unknown failure';
}

function toDto(row: {
  id: string;
  corridorId: string;
  recipientId: string;
  sendMinorUnits: bigint;
  sendCurrency: string;
  payinMethod: string;
  purpose: string;
  frequency: string;
  dayOfPeriod: number;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastFailure: string | null;
  occurrences: number;
  active: boolean;
  recipient: { resolvedName: string | null; maskedAccount: string };
}): ScheduleDto {
  return {
    id: row.id,
    corridorId: row.corridorId,
    recipientId: row.recipientId,
    recipientName: row.recipient.resolvedName,
    recipientMasked: row.recipient.maskedAccount,
    amount: moneyDtoFrom(row.sendMinorUnits, requireCurrencyCode(row.sendCurrency)),
    payinMethod: row.payinMethod as never,
    purpose: row.purpose as TransferPurposeDto,
    frequency: row.frequency as ScheduleFrequency,
    dayOfPeriod: row.dayOfPeriod,
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastFailure: row.lastFailure,
    occurrences: row.occurrences,
    active: row.active,
  };
}
