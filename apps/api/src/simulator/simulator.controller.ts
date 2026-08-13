import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { asProviderRef } from '@morapay/domain';
import { PayinSimulator, ProviderRegistry, SCENARIO_GUIDE, signPayload } from '@morapay/adapters';
import { PrismaService } from '../common/prisma.service';
import { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/tokens';
import { TransferSagaService } from '../transfers/transfer-saga.service';
import { OutboxService } from '../notifications/outbox.service';

/**
 * Simulator control surface.
 *
 * This is what lets a demo show the sender paying, a webhook arriving, and a
 * partner failing — without a partner. It is refused outright when
 * `LIVE_FUNDS_ENABLED` is true or `NODE_ENV` is production, because a
 * "mark this pay-in as received" endpoint on a live system is a fraud tool.
 */
@Controller('simulator')
export class SimulatorController {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly saga: TransferSagaService,
    private readonly outbox: OutboxService,
  ) {}

  private assertSimulatorAllowed(): void {
    if (this.config.LIVE_FUNDS_ENABLED || this.config.NODE_ENV === 'production') {
      throw new ForbiddenException({
        code: 'SIMULATOR_DISABLED',
        message: 'The simulator is not available when live funds are enabled',
      });
    }
  }

  /** The scenario guide, so a demo does not need the source code open. */
  @Get('scenarios')
  scenarios(): { scenarios: typeof SCENARIO_GUIDE; providers: unknown } {
    this.assertSimulatorAllowed();
    return { scenarios: SCENARIO_GUIDE, providers: this.registry.describe() };
  }

  /**
   * The sender pays.
   *
   * Notice what happens next: nothing, directly. This marks the pay-in as
   * received *at the provider*. Our system finds out by polling, exactly as it
   * would with a real bank.
   */
  @Post('payin/:reference/pay')
  @HttpCode(200)
  async pay(@Param('reference') reference: string): Promise<{ paid: boolean; state: string }> {
    this.assertSimulatorAllowed();
    const transfer = await this.prisma.transfer.findUnique({ where: { reference } });
    if (transfer === null || transfer.payinProviderRef === null) {
      throw new BadRequestException({
        code: 'NO_PAYIN',
        message: 'That transfer has no pay-in awaiting payment yet',
      });
    }

    const provider = this.registry.payinById(transfer.payinProviderId ?? '');
    if (!(provider instanceof PayinSimulator)) {
      throw new BadRequestException({
        code: 'NOT_A_SIMULATOR',
        message: 'That transfer is not using the pay-in simulator',
      });
    }

    const paid = provider.markPaid(asProviderRef(transfer.payinProviderRef));
    const state = await this.saga.advance(transfer.id);
    return { paid, state };
  }

  /** The sender's bank declines. */
  @Post('payin/:reference/decline')
  @HttpCode(200)
  async decline(
    @Param('reference') reference: string,
  ): Promise<{ declined: boolean; state: string }> {
    this.assertSimulatorAllowed();
    const transfer = await this.prisma.transfer.findUnique({ where: { reference } });
    if (transfer === null || transfer.payinProviderRef === null) {
      throw new BadRequestException({ code: 'NO_PAYIN', message: 'No pay-in to decline' });
    }
    const provider = this.registry.payinById(transfer.payinProviderId ?? '');
    if (!(provider instanceof PayinSimulator)) {
      throw new BadRequestException({ code: 'NOT_A_SIMULATOR', message: 'Not a simulated pay-in' });
    }
    const declined = provider.markFailed(asProviderRef(transfer.payinProviderRef));
    const state = await this.saga.advance(transfer.id);
    return { declined, state };
  }

  /**
   * Produce a correctly signed callback, so the real webhook endpoint can be
   * exercised end to end — signature, freshness, dedup and all.
   *
   * The signature is computed with the same secret the endpoint verifies
   * against, which is the only way to demonstrate that the check works rather
   * than asserting it does.
   */
  @Post('callback/:providerId/:providerRef')
  @HttpCode(200)
  async buildCallback(
    @Param('providerId') providerId: string,
    @Param('providerRef') providerRef: string,
    @Body() body: { eventId?: string; tamper?: boolean; stale?: boolean },
  ): Promise<{ url: string; headers: Record<string, string>; body: string }> {
    this.assertSimulatorAllowed();

    const secretByProvider: Record<string, string> = {
      'payin-ru-sim': this.config.PROVIDER_SIGNING_SECRET_PAYIN_RU_SIM,
      'payout-ng-sim': this.config.PROVIDER_SIGNING_SECRET_PAYOUT_NG_SIM,
      'payout-gh-sim': this.config.PROVIDER_SIGNING_SECRET_PAYOUT_GH_SIM,
    };
    const secret = secretByProvider[providerId];
    if (secret === undefined) {
      throw new BadRequestException({ code: 'UNKNOWN_PROVIDER', message: 'No such provider' });
    }

    const eventId = body.eventId ?? `evt_${Date.now()}`;
    const payload = JSON.stringify({
      Status: 'Success',
      Trans_Status: 'Success',
      Financial_Institution_id: providerRef,
      provider_ref: providerRef,
      event_id: eventId,
    });

    // `stale` backdates the timestamp past the skew window; `tamper` signs a
    // different body. Both must be rejected by the endpoint.
    const timestamp = String(
      Math.floor(Date.now() / 1000) -
        (body.stale === true ? this.config.CALLBACK_MAX_SKEW_SECONDS + 60 : 0),
    );
    const signed = body.tamper === true ? `${payload}tampered` : payload;

    return {
      url: `${this.config.API_PUBLIC_URL}/webhooks/${providerId}/callback`,
      headers: {
        'content-type': 'application/json',
        'x-timestamp': timestamp,
        'x-signature': signPayload(secret, timestamp, Buffer.from(signed)),
      },
      body: payload,
    };
  }

  /**
   * The local mailbox.
   *
   * Verification links land here in development, so a demo can complete
   * onboarding without a mail server. Disabled with the rest of the simulator.
   */
  @Get('outbox')
  async mailbox(): Promise<{ messages: Awaited<ReturnType<OutboxService['recent']>> }> {
    this.assertSimulatorAllowed();
    return { messages: await this.outbox.recent(50) };
  }
}
