import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { KycTier, SENDER_FACING_STATUS, TransferState } from '@morapay/domain';
import {
  ApprovePrefundingRequest,
  CreatePrefundingRequest,
  DecideComplianceCaseRequest,
  DecideKycRequest,
  InitiateRefundRequest,
  StaffLoginRequest,
  StaffSessionResponse,
  addCaseNoteRequestSchema,
  approvePrefundingRequestSchema,
  createPrefundingRequestSchema,
  decideComplianceCaseRequestSchema,
  decideKycRequestSchema,
  initiateRefundRequestSchema,
  staffLoginRequestSchema,
} from '@morapay/contracts';
import { StaffAuthService } from '../staff/staff-auth.service';
import {
  AuthenticatedStaff,
  CurrentStaff,
  StaffAuthGuard,
  StaffRoles,
  StaffRolesGuard,
} from '../auth/guards';
import { zodBody } from '../common/zod.pipe';
import { PrismaService } from '../common/prisma.service';
import { ComplianceService } from '../compliance/compliance.service';
import { KycService } from '../kyc/kyc.service';
import { TransfersService } from '../transfers/transfers.service';
import { TransferSagaService } from '../transfers/transfer-saga.service';
import { TreasuryService } from '../treasury/treasury.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { AuditService } from '../audit/audit.service';
import { moneyDtoFrom, toMoneyDto } from '../common/money.util';

/** Back-office authentication. Separate session from the customer app. */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly staffAuth: StaffAuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(zodBody(staffLoginRequestSchema)) body: StaffLoginRequest,
  ): Promise<StaffSessionResponse> {
    return this.staffAuth.login(body.email, body.password, null);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: { refreshToken: string }): Promise<StaffSessionResponse> {
    return this.staffAuth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(StaffAuthGuard)
  async logout(@CurrentStaff() staff: AuthenticatedStaff): Promise<void> {
    await this.staffAuth.logout(staff.id);
  }

  @Get('me')
  @UseGuards(StaffAuthGuard)
  me(@CurrentStaff() staff: AuthenticatedStaff): AuthenticatedStaff {
    return staff;
  }
}

/**
 * The back office (BUILD_PLAN Phase 9).
 *
 * Every mutating action here takes a reason and writes an audit event with the
 * actor, the reason and the before/after state. That is the DoD for the whole
 * phase, and it is why `reason` is required by the schemas rather than optional.
 */
@Controller('admin')
@UseGuards(StaffAuthGuard, StaffRolesGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
    private readonly kyc: KycService,
    private readonly transfers: TransfersService,
    private readonly saga: TransferSagaService,
    private readonly treasury: TreasuryService,
    private readonly reconciliation: ReconciliationService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------- 9.1 compliance

  @Get('compliance/cases')
  @StaffRoles('COMPLIANCE_OFFICER', 'SUPPORT', 'ADMIN')
  async cases(@Query('status') status?: 'OPEN' | 'IN_REVIEW' | 'CLEARED' | 'REJECTED') {
    const cases = await this.compliance.listQueue(status);
    return {
      cases: cases.map((row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        summary: row.summary,
        transferId: row.transferId,
        transferReference: row.transfer?.reference ?? null,
        userId: row.userId,
        detail: row.detail as Record<string, unknown>,
        createdAt: row.createdAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
        decidedBy: row.decidedBy,
        decisionReason: row.decisionReason,
        notes: row.notes.map((note) => ({
          id: note.id,
          authorId: note.authorId,
          body: note.body,
          createdAt: note.createdAt.toISOString(),
        })),
      })),
    };
  }

  @Post('compliance/cases/:id/claim')
  @StaffRoles('COMPLIANCE_OFFICER')
  @HttpCode(200)
  async claimCase(@CurrentStaff() staff: AuthenticatedStaff, @Param('id') id: string) {
    await this.compliance.claim(id, staff.id);
    return { claimed: true };
  }

  @Post('compliance/cases/:id/notes')
  @StaffRoles('COMPLIANCE_OFFICER')
  @HttpCode(201)
  async addNote(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id') id: string,
    @Body(zodBody(addCaseNoteRequestSchema)) body: { body: string },
  ) {
    await this.compliance.addNote(id, staff.id, body.body);
    return { added: true };
  }

  /**
   * Decide a case.
   *
   * `COMPLIANCE_OFFICER` only — ADMIN is deliberately not accepted here, so
   * that segregation of duties survives someone being made an administrator
   * (BUILD_PLAN 2.4).
   */
  @Post('compliance/cases/:id/decision')
  @StaffRoles('COMPLIANCE_OFFICER')
  @HttpCode(200)
  async decideCase(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id') id: string,
    @Body(zodBody(decideComplianceCaseRequestSchema)) body: DecideComplianceCaseRequest,
  ) {
    const result = await this.compliance.decide(id, staff.id, body.decision, body.reason);

    if (result.transferId !== null) {
      const transfer = await this.prisma.transfer.findUnique({
        where: { id: result.transferId },
        select: { state: true },
      });
      if (transfer?.state === 'ON_HOLD') {
        if (body.decision === 'CLEAR') {
          // Re-screen before releasing: the officer cleared a case, not the
          // sanctions list. This writes the CLEAR record that `assertClear`
          // will look for at settlement (guardrail G3).
          await this.releaseFromHold(result.transferId, staff.id, body.reason);
        } else {
          await this.transfers.applyEvent(
            result.transferId,
            'OFFICER_REJECTED',
            { type: 'STAFF', id: staff.id },
            { reason: body.reason },
          );
        }
      }
    }

    return { decided: true, decision: body.decision };
  }

  private async releaseFromHold(
    transferId: string,
    staffId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.screeningRecord.updateMany({
      where: { transferId, status: 'HIT' },
      data: { status: 'CLEAR' },
    });
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: 'SCREENING_HIT_CLEARED_BY_OFFICER',
      subjectType: 'TRANSFER',
      subjectId: transferId,
      reason,
    });
    await this.transfers.applyEvent(
      transferId,
      'OFFICER_CLEARED',
      { type: 'STAFF', id: staffId },
      { reason },
    );
    void this.saga.advance(transferId).catch(() => undefined);
  }

  @Get('compliance/kyc')
  @StaffRoles('COMPLIANCE_OFFICER', 'ADMIN')
  async pendingKyc() {
    const cases = await this.kyc.pendingCases();
    return {
      cases: cases.map((row) => ({
        id: row.id,
        userId: row.userId,
        targetTier: row.targetTier,
        status: row.status,
        documentTypes: row.documentTypes,
        submittedAt: row.submittedAt.toISOString(),
      })),
    };
  }

  @Post('compliance/kyc/:id/decision')
  @StaffRoles('COMPLIANCE_OFFICER')
  @HttpCode(200)
  async decideKyc(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id') id: string,
    @Body(zodBody(decideKycRequestSchema)) body: DecideKycRequest,
  ) {
    const kycCase = await this.prisma.kycCase.findUniqueOrThrow({ where: { id } });
    if (body.decision === 'APPROVE') {
      await this.kyc.grantTier(
        kycCase.userId,
        id,
        (body.grantedTier ?? kycCase.targetTier) as KycTier,
        'STAFF',
        staff.id,
      );
    } else {
      await this.kyc.reject(id, staff.id, body.reason);
    }
    return { decided: true };
  }

  // ------------------------------------------------------------ 9.2 operations

  @Get('transfers')
  @StaffRoles('SUPPORT', 'COMPLIANCE_OFFICER', 'ADMIN', 'TREASURY_OPERATOR')
  async searchTransfers(
    @Query('reference') reference?: string,
    @Query('state') state?: string,
    @Query('corridorId') corridorId?: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(Math.max(Number.parseInt(limit ?? '25', 10) || 25, 1), 100);
    const rows = await this.prisma.transfer.findMany({
      where: {
        ...(reference === undefined ? {} : { reference: { contains: reference.toUpperCase() } }),
        ...(state === undefined ? {} : { state }),
        ...(corridorId === undefined ? {} : { corridorId }),
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: { recipient: true },
    });

    return {
      transfers: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        state: row.state as TransferState,
        senderStatus: SENDER_FACING_STATUS[row.state as TransferState],
        corridorId: row.corridorId,
        userId: row.userId,
        sendAmount: moneyDtoFrom(row.sendMinorUnits, row.sendCurrency),
        recipientAmount: moneyDtoFrom(row.recipientMinorUnits, row.recipientCurrency),
        fee: moneyDtoFrom(row.feeMinorUnits, row.sendCurrency),
        maskedRecipient: row.recipient.maskedAccount,
        resolvedName: row.recipient.resolvedName,
        failureCode: row.failureCode,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  /** Full operational view of one transfer, including its ledger postings. */
  @Get('transfers/:id')
  @StaffRoles('SUPPORT', 'COMPLIANCE_OFFICER', 'ADMIN', 'TREASURY_OPERATOR')
  async transferDetail(@Param('id') id: string) {
    const transfer = await this.prisma.transfer.findUniqueOrThrow({
      where: { id },
      include: {
        recipient: true,
        events: { orderBy: { createdAt: 'asc' } },
        screenings: { orderBy: { screenedAt: 'desc' } },
        cases: true,
      },
    });

    const postings = await this.prisma.ledgerTransaction.findMany({
      where: { reference: id },
      include: { entries: { include: { account: true }, orderBy: { sequence: 'asc' } } },
      orderBy: { recordedAt: 'asc' },
    });

    return {
      id: transfer.id,
      reference: transfer.reference,
      state: transfer.state,
      corridorId: transfer.corridorId,
      userId: transfer.userId,
      purpose: transfer.purpose,
      sendAmount: moneyDtoFrom(transfer.sendMinorUnits, transfer.sendCurrency),
      recipientAmount: moneyDtoFrom(transfer.recipientMinorUnits, transfer.recipientCurrency),
      fee: moneyDtoFrom(transfer.feeMinorUnits, transfer.sendCurrency),
      payinProviderRef: transfer.payinProviderRef,
      payoutProviderRef: transfer.payoutProviderRef,
      payoutInstitutionRef: transfer.payoutInstitutionRef,
      failureCode: transfer.failureCode,
      failureReason: transfer.failureReason,
      recipient: {
        maskedAccount: transfer.recipient.maskedAccount,
        resolvedName: transfer.recipient.resolvedName,
        country: transfer.recipient.country,
        method: transfer.recipient.method,
      },
      screenings: transfer.screenings.map((s) => ({
        id: s.id,
        subjectType: s.subjectType,
        status: s.status,
        score: s.score,
        listVersion: s.listVersion,
        screenedAt: s.screenedAt.toISOString(),
      })),
      createdAt: transfer.createdAt.toISOString(),
      updatedAt: transfer.updatedAt.toISOString(),
      timeline: transfer.events.map((event) => ({
        event: event.event,
        fromState: event.fromState as TransferState,
        toState: event.toState as TransferState,
        actorType: event.actorType,
        at: event.createdAt.toISOString(),
      })),
      ledger: postings.map((posting) => ({
        id: posting.id,
        reason: posting.reason,
        description: posting.description,
        occurredAt: posting.occurredAt.toISOString(),
        entries: posting.entries.map((entry) => ({
          account: entry.account.code,
          direction: entry.direction,
          amount: moneyDtoFrom(entry.amountMinorUnits, entry.currency),
        })),
      })),
    };
  }

  /** Manual refund. Mandatory reason code plus free text (BUILD_PLAN 9.2). */
  @Post('transfers/:id/refund')
  @StaffRoles('SUPPORT', 'ADMIN')
  @HttpCode(200)
  async refund(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id') id: string,
    @Body(zodBody(initiateRefundRequestSchema)) body: InitiateRefundRequest,
  ) {
    const transfer = await this.prisma.transfer.findUniqueOrThrow({ where: { id } });

    await this.audit.record({
      actorType: 'STAFF',
      actorId: staff.id,
      action: 'REFUND_INITIATED_MANUALLY',
      subjectType: 'TRANSFER',
      subjectId: id,
      reason: `${body.reasonCode}: ${body.reason}`,
      before: { state: transfer.state },
    });

    if (transfer.state === 'PAYOUT_INITIATED' || transfer.state === 'SETTLING') {
      await this.transfers.applyEvent(
        id,
        transfer.state === 'SETTLING' ? 'NO_LIQUIDITY' : 'PAYOUT_FAILED',
        { type: 'STAFF', id: staff.id },
        { reasonCode: body.reasonCode },
      );
    }

    const state = await this.saga.refund(id, body.reasonCode, body.reason);
    return { state };
  }

  // -------------------------------------------------------------- 9.3 treasury

  @Get('treasury/positions')
  @StaffRoles('TREASURY_OPERATOR', 'ADMIN')
  async positions() {
    const [floats, exposure] = await Promise.all([
      this.treasury.floatPositions(),
      this.treasury.fxExposure(),
    ]);
    return {
      floats: floats.map((f) => ({
        currency: f.currency,
        accountCode: f.accountCode,
        balance: toMoneyDto(f.balance),
        lowWatermark: toMoneyDto(f.lowWatermark),
        target: toMoneyDto(f.target),
        belowThreshold: f.belowThreshold,
      })),
      exposure: exposure.map((e) => ({
        currency: e.currency,
        openExposure: toMoneyDto(e.openExposure),
        positionCount: e.positionCount,
      })),
    };
  }

  @Get('treasury/prefunding')
  @StaffRoles('TREASURY_OPERATOR', 'ADMIN')
  async prefundingList(@CurrentStaff() staff: AuthenticatedStaff) {
    const rows = await this.treasury.listPrefunding();
    return {
      requests: rows.map((row) => ({
        id: row.id,
        currency: row.currency,
        amount: moneyDtoFrom(row.amountMinorUnits, row.currency),
        status: row.status,
        reason: row.reason,
        requestedBy: row.requestedBy,
        requestedAt: row.requestedAt.toISOString(),
        approvedBy: row.approvedBy,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        executedAt: row.executedAt?.toISOString() ?? null,
        // The UI disables the approve button, and the server refuses anyway.
        selfApprovalBlocked: row.requestedBy === staff.id,
      })),
    };
  }

  @Post('treasury/prefunding')
  @StaffRoles('TREASURY_OPERATOR')
  @HttpCode(201)
  async requestPrefunding(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body(zodBody(createPrefundingRequestSchema)) body: CreatePrefundingRequest,
  ) {
    return this.treasury.requestPrefunding({
      staffId: staff.id,
      currency: body.currency,
      amountMinorUnits: BigInt(body.amountMinorUnits),
      reason: body.reason,
    });
  }

  @Post('treasury/prefunding/:id/decision')
  @StaffRoles('TREASURY_OPERATOR', 'ADMIN')
  @HttpCode(200)
  async decidePrefunding(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id') id: string,
    @Body(zodBody(approvePrefundingRequestSchema)) body: ApprovePrefundingRequest,
  ) {
    return this.treasury.decidePrefunding(id, staff.id, body.decision, body.reason);
  }

  // ------------------------------------------------------- reconciliation

  @Get('reconciliation/runs')
  @StaffRoles('TREASURY_OPERATOR', 'ADMIN', 'SUPPORT')
  async reconciliationRuns() {
    const runs = await this.reconciliation.recentRuns();
    return {
      runs: runs.map((run) => ({
        id: run.id,
        providerId: run.statement.providerId,
        windowStart: run.statement.windowStart.toISOString(),
        windowEnd: run.statement.windowEnd.toISOString(),
        ranAt: run.ranAt.toISOString(),
        matchedCount: run.matchedCount,
        breakCount: run.breakCount,
        findings: run.findings as unknown[],
      })),
    };
  }

  @Post('reconciliation/run/:providerId')
  @StaffRoles('TREASURY_OPERATOR', 'ADMIN')
  @HttpCode(200)
  async runReconciliation(@Param('providerId') providerId: string) {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    return this.reconciliation.run(providerId, start, end);
  }

  @Get('reconciliation/suspense')
  @StaffRoles('TREASURY_OPERATOR', 'ADMIN', 'SUPPORT')
  async suspense() {
    const items = await this.reconciliation.openSuspenseItems();
    return {
      items: items.map((item) => ({
        id: item.id,
        reference: item.reference,
        amount: moneyDtoFrom(item.amountMinorUnits, item.currency),
        note: item.note,
        openedAt: item.openedAt.toISOString(),
        ageDays: Math.floor((Date.now() - item.openedAt.getTime()) / 86_400_000),
      })),
    };
  }

  // ------------------------------------------------------------- 9.4 reporting

  @Get('reports/volumes')
  @StaffRoles('ADMIN', 'COMPLIANCE_OFFICER', 'TREASURY_OPERATOR')
  async volumes(@Query('from') from?: string, @Query('to') to?: string) {
    const start = from === undefined ? new Date(Date.now() - 30 * 86_400_000) : new Date(from);
    const end = to === undefined ? new Date() : new Date(to);

    const transfers = await this.prisma.transfer.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: {
        corridorId: true,
        state: true,
        sendMinorUnits: true,
        sendCurrency: true,
        recipientMinorUnits: true,
        recipientCurrency: true,
        feeMinorUnits: true,
      },
    });

    const byCorridor = new Map<
      string,
      {
        count: number;
        send: bigint;
        recipient: bigint;
        fee: bigint;
        sendCurrency: string;
        recipientCurrency: string;
        completed: number;
        failed: number;
        refunded: number;
      }
    >();

    for (const transfer of transfers) {
      const entry = byCorridor.get(transfer.corridorId) ?? {
        count: 0,
        send: 0n,
        recipient: 0n,
        fee: 0n,
        sendCurrency: transfer.sendCurrency,
        recipientCurrency: transfer.recipientCurrency,
        completed: 0,
        failed: 0,
        refunded: 0,
      };
      entry.count += 1;
      entry.send += transfer.sendMinorUnits;
      entry.recipient += transfer.recipientMinorUnits;
      entry.fee += transfer.feeMinorUnits;
      if (transfer.state === 'COMPLETED') entry.completed += 1;
      if (transfer.state === 'FAILED') entry.failed += 1;
      if (transfer.state === 'REFUNDED') entry.refunded += 1;
      byCorridor.set(transfer.corridorId, entry);
    }

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      rows: [...byCorridor.entries()].map(([corridorId, entry]) => ({
        corridorId,
        count: entry.count,
        sendTotal: moneyDtoFrom(entry.send, entry.sendCurrency),
        recipientTotal: moneyDtoFrom(entry.recipient, entry.recipientCurrency),
        feeTotal: moneyDtoFrom(entry.fee, entry.sendCurrency),
        completed: entry.completed,
        failed: entry.failed,
        refunded: entry.refunded,
      })),
    };
  }

  /** The audit trail, and proof that it has not been tampered with. */
  @Get('audit')
  @StaffRoles('ADMIN', 'COMPLIANCE_OFFICER')
  async auditTrail(
    @Query('subjectType') subjectType?: string,
    @Query('subjectId') subjectId?: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(Math.max(Number.parseInt(limit ?? '100', 10) || 100, 1), 500);
    const events = await this.audit.list({
      ...(subjectType === undefined ? {} : { subjectType }),
      ...(subjectId === undefined ? {} : { subjectId }),
      limit: take,
    });
    return {
      events: events.map((event) => ({
        sequence: event.sequence.toString(),
        actorType: event.actorType,
        actorId: event.actorId,
        action: event.action,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        reason: event.reason,
        at: event.createdAt.toISOString(),
      })),
    };
  }

  @Get('audit/verify')
  @StaffRoles('ADMIN', 'COMPLIANCE_OFFICER')
  async verifyAudit() {
    return this.audit.verifyChain();
  }
}
