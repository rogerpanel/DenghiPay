import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Corridor,
  CountryCode,
  PayinMethod,
  PayoutMethod,
  isCorridorOpen,
  requireCurrencyCode,
} from '@morapay/domain';
import { PrismaService } from '../common/prisma.service';

/**
 * Corridors as data (BUILD_PLAN 4.3).
 *
 * Nothing in the transfer path branches on a country name. Adding BY→GH is a
 * row in this table plus a payout provider registration.
 */
@Injectable()
export class CorridorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<readonly Corridor[]> {
    const rows = await this.prisma.corridor.findMany({ orderBy: { id: 'asc' } });
    return rows.map(toCorridor);
  }

  async listEnabled(): Promise<readonly Corridor[]> {
    return (await this.list()).filter((c) => c.enabled);
  }

  async get(id: string): Promise<Corridor> {
    const row = await this.prisma.corridor.findUnique({ where: { id } });
    if (row === null) {
      throw new NotFoundException({ code: 'CORRIDOR_NOT_FOUND', message: `No corridor ${id}` });
    }
    return toCorridor(row);
  }

  async isOpenNow(id: string, at = new Date()): Promise<boolean> {
    return isCorridorOpen(await this.get(id), at);
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
