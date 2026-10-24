import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Corridor,
  CorridorNotAuthorisedError,
  CountryCode,
  PayinMethod,
  PayoutMethod,
  assertCorridorMayMoveLiveFunds,
  isCorridorOpen,
  requireCurrencyCode,
} from '@morapay/domain';
import { PrismaService } from '../common/prisma.service';
import { AppConfig, heldAuthorisations } from '../config/config';
import { APP_CONFIG } from '../config/tokens';

/**
 * Corridors as data (BUILD_PLAN 4.3).
 *
 * Nothing in the transfer path branches on a country name. Adding BY→GH is a
 * row in this table plus a payout provider registration.
 *
 * The one thing that is not data is the licence a corridor rests on. `enabled`
 * is an operational switch — anyone with database access can flip it — and the
 * intra-African corridors need something stronger, because collecting money
 * inside Nigeria or Ghana is a licensed activity in its own right and the
 * transfer code cannot tell the difference. So every read of a corridor passes
 * through the authorisation gate, and with live funds on an undeclared corridor
 * is not merely disabled, it is unreachable.
 */
@Injectable()
export class CorridorsService {
  private readonly logger = new Logger(CorridorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(): Promise<readonly Corridor[]> {
    const rows = await this.prisma.corridor.findMany({ orderBy: { id: 'asc' } });
    return rows.map(toCorridor);
  }

  /** What a sender may actually use: enabled, and authorised to move funds. */
  async listEnabled(): Promise<readonly Corridor[]> {
    return (await this.list()).filter((c) => c.enabled && this.isAuthorised(c));
  }

  async get(id: string): Promise<Corridor> {
    const row = await this.prisma.corridor.findUnique({ where: { id } });
    if (row === null) {
      throw new NotFoundException({ code: 'CORRIDOR_NOT_FOUND', message: `No corridor ${id}` });
    }
    const corridor = toCorridor(row);
    this.assertAuthorised(corridor);
    return corridor;
  }

  async isOpenNow(id: string, at = new Date()): Promise<boolean> {
    return isCorridorOpen(await this.get(id), at);
  }

  /**
   * Throws when live funds are on and this corridor's authorisations are not
   * declared held. The message names what is missing; the response does not,
   * because a sender cannot act on it and it describes our licensing posture.
   */
  private assertAuthorised(corridor: Corridor): void {
    try {
      assertCorridorMayMoveLiveFunds(corridor, {
        liveFundsEnabled: this.config.LIVE_FUNDS_ENABLED,
        held: heldAuthorisations(this.config),
      });
    } catch (error) {
      if (!(error instanceof CorridorNotAuthorisedError)) throw error;
      this.logger.error(error.message);
      throw new ForbiddenException({
        code: 'CORRIDOR_NOT_AVAILABLE',
        message: 'That corridor is not available.',
      });
    }
  }

  private isAuthorised(corridor: Corridor): boolean {
    try {
      this.assertAuthorised(corridor);
      return true;
    } catch {
      return false;
    }
  }
}

function toCorridor(row: {
  id: string;
  sourceCountry: string;
  sourceCurrency: string;
  destinationCountry: string;
  destinationCurrency: string;
  payinMethods: string[];
  payoutMethods: string[];
  minSendMinorUnits: bigint;
  maxSendMinorUnits: bigint;
  fixedFeeMinorUnits: bigint;
  fxMarginBps: number;
  openUtcHour: number;
  closeUtcHour: number;
  weekdays: number[];
  enabled: boolean;
}): Corridor {
  return {
    id: row.id,
    sourceCountry: row.sourceCountry as CountryCode,
    sourceCurrency: requireCurrencyCode(row.sourceCurrency),
    destinationCountry: row.destinationCountry as CountryCode,
    destinationCurrency: requireCurrencyCode(row.destinationCurrency),
    payinMethods: row.payinMethods as PayinMethod[],
    payoutMethods: row.payoutMethods as PayoutMethod[],
    limits: {
      minSendMinorUnits: row.minSendMinorUnits,
      maxSendMinorUnits: row.maxSendMinorUnits,
    },
    fees: {
      fixedFeeMinorUnits: row.fixedFeeMinorUnits,
      fxMarginBps: row.fxMarginBps,
    },
    operatingHours: {
      openUtcHour: row.openUtcHour,
      closeUtcHour: row.closeUtcHour,
      weekdays: row.weekdays,
    },
    enabled: row.enabled,
  };
}
