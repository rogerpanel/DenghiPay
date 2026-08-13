import {
  Controller,
  Inject,
  Headers,
  HttpCode,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { ProviderRegistry, verifySignature, withinSkew } from '@morapay/adapters';
import { PrismaService } from '../common/prisma.service';
import { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/tokens';
import { MetricsService } from '../common/metrics.service';
import { TransferSagaService } from '../transfers/transfer-saga.service';

/**
 * Provider callbacks (TECHNICAL_ARCHITECTURE §4.2).
 *
 * Read what this handler does *not* do: no database write to the transfer, no
 * balance change, no notification to the sender. A forged or replayed callback
 * achieves nothing beyond causing us to poll an API we would have polled
 * anyway.
 *
 * The order of checks is deliberate — freshness first because it is cheap, then
 * the signature over raw bytes in constant time, then normalisation, then
 * dedup, then an idempotent enqueue.
 */
@Controller('webhooks')
export class ProviderCallbackController {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly metrics: MetricsService,
    private readonly saga: TransferSagaService,
  ) {}

  @Post(':providerId/callback')
  @HttpCode(200)
  async handle(
    @Param('providerId') providerId: string,
    @Headers('x-signature') signature: string | undefined,
    @Headers('x-timestamp') timestamp: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<void> {
    const rawBody = request.rawBody;
    if (rawBody === undefined || signature === undefined || timestamp === undefined) {
      this.metrics.callbackReceived(providerId, 'malformed');
      throw new UnauthorizedException();
    }

    const secret = this.signingSecretFor(providerId);
    if (secret === null) {
      this.metrics.callbackReceived(providerId, 'malformed');
      throw new UnauthorizedException();
    }

    // 1. Freshness — cheap, do it first.
    if (!withinSkew(timestamp, this.config.CALLBACK_MAX_SKEW_SECONDS)) {
      this.metrics.callbackReceived(providerId, 'rejected.stale');
      throw new UnauthorizedException();
    }

    // 2. Signature over raw bytes, constant-time.
    if (!verifySignature(secret, timestamp, rawBody, signature)) {
      this.metrics.callbackReceived(providerId, 'rejected.signature');
      throw new UnauthorizedException();
    }

    // 3. Normalise. Yields a TRIGGER — never an outcome.
    const provider = this.registry.payoutById(providerId) ?? this.registry.payinById(providerId);
    if (provider === null) {
      this.metrics.callbackReceived(providerId, 'malformed');
      throw new UnauthorizedException();
    }

    let trigger;
    try {
      trigger = await provider.parseCallback({
        rawBody,
        timestamp,
        headers: request.headers as Record<string, string | undefined>,
      });
    } catch {
      this.metrics.callbackReceived(providerId, 'malformed');
      throw new UnauthorizedException();
    }

    // 4. Dedup. Replay is a no-op, not an error — a partner retrying because we
    // were slow to acknowledge must not be punished with a 4xx.
    const seen = await this.prisma.webhookEvent.findUnique({
      where: { providerId_eventId: { providerId, eventId: trigger.eventId } },
    });
    if (seen !== null) {
      this.metrics.callbackReceived(providerId, 'duplicate');
      return;
    }

    await this.prisma.webhookEvent.create({
      data: {
        providerId,
        eventId: trigger.eventId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // 5. Enqueue the poll. No ledger write on this path — ever.
    const transfer = await this.prisma.transfer.findFirst({
      where: {
        OR: [
          { payoutProviderRef: String(trigger.providerRef) },
          { payinProviderRef: String(trigger.providerRef) },
        ],
      },
      select: { id: true },
    });

    this.metrics.callbackReceived(providerId, 'accepted');

    if (transfer !== null) {
      await this.saga.requestPoll(transfer.id, String(trigger.providerRef));
    }
  }

  private signingSecretFor(providerId: string): string | null {
    switch (providerId) {
      case 'payin-ru-sim':
        return this.config.PROVIDER_SIGNING_SECRET_PAYIN_RU_SIM;
      case 'payout-ng-sim':
        return this.config.PROVIDER_SIGNING_SECRET_PAYOUT_NG_SIM;
      case 'payout-gh-sim':
        return this.config.PROVIDER_SIGNING_SECRET_PAYOUT_GH_SIM;
      default:
        // An unknown provider gets the same 401 as a bad signature. We do not
        // confirm which provider identifiers exist.
        return null;
    }
  }
}
