import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { isCorridorOpen } from '@morapay/domain';
import {
  CorridorResponse,
  CreateQuoteRequest,
  QuoteResponse,
  RateResponse,
  createQuoteRequestSchema,
} from '@morapay/contracts';
import { CorridorsService } from './corridors.service';
import { QuotesService } from './quotes.service';
import { RatesService } from './rates.service';
import { AuthenticatedUser, CurrentUser, JwtAuthGuard, VerifiedUserGuard } from '../auth/guards';
import { zodBody } from '../common/zod.pipe';
import { moneyDtoFrom } from '../common/money.util';

@Controller()
export class QuotingController {
  constructor(
    private readonly corridors: CorridorsService,
    private readonly quotes: QuotesService,
    private readonly rates: RatesService,
  ) {}

  /**
   * Public: the corridors and their fees, so the marketing page can show them.
   *
   * `from` narrows to the corridors that start in one country, which is the only
   * thing a sender can actually use — somebody in Nairobi cannot hand over
   * naira. Every sender-facing screen passes it.
   *
   * It matters more than it looks. With fifteen countries this catalogue is 212
   * corridors and about 104 KB, of which a given sender can use fourteen and
   * roughly 7 KB. Downloading the other 97 KB is several seconds of blank screen
   * on a 3G connection in Lagos or Kampala, on every visit to the send screen —
   * and it got fifteen times worse the day the mesh grew, without anybody
   * noticing, because the clients were filtering after the download.
   *
   * This is a payload filter and not a security boundary: the parameter comes
   * from the client, so it can only make the list smaller. What a sender is
   * actually permitted to send on is enforced where it has to be, at transfer
   * creation, which refuses a residency mismatch outright.
   */
  @Get('corridors')
  async listCorridors(@Query('from') from?: string): Promise<{ corridors: CorridorResponse[] }> {
    const now = new Date();
    // `listEnabled`, not `list`. This is the sender-facing catalogue, and a
    // corridor that is switched off — or whose licences are not declared held
    // once live funds are on — must not be offered here only to be refused at
    // the quote. Only the two front ends read this endpoint; the back office
    // reads corridor rows directly, where seeing a disabled one is the point.
    const all = await this.corridors.listEnabled();
    const corridors =
      from === undefined || from === '' ? all : all.filter((c) => c.sourceCountry === from);
    return {
      corridors: corridors.map((corridor) => ({
        id: corridor.id,
        sourceCountry: corridor.sourceCountry,
        sourceCurrency: corridor.sourceCurrency,
        destinationCountry: corridor.destinationCountry,
        destinationCurrency: corridor.destinationCurrency,
        payinMethods: [...corridor.payinMethods],
        payoutMethods: [...corridor.payoutMethods],
        minSend: moneyDtoFrom(corridor.limits.minSendMinorUnits, corridor.sourceCurrency),
        maxSend: moneyDtoFrom(corridor.limits.maxSendMinorUnits, corridor.sourceCurrency),
        fixedFee: moneyDtoFrom(corridor.fees.fixedFeeMinorUnits, corridor.sourceCurrency),
        fxMarginBps: corridor.fees.fxMarginBps,
        enabled: corridor.enabled,
        open: isCorridorOpen(corridor, now),
      })),
    };
  }

  /**
   * Rate feed health.
   *
   * `usable: false` is the visible face of BUILD_PLAN 4.1 — when a feed goes
   * stale, quoting halts and this endpoint says why, rather than the app
   * showing a plausible-looking rate that nobody stands behind.
   */
  @Get('rates')
  async listRates(): Promise<{ rates: RateResponse[] }> {
    const health = await this.rates.health();
    return {
      rates: health.map((entry) => ({
        pair: entry.pair,
        rate: entry.rate ?? '',
        observedAt: entry.observedAt?.toISOString() ?? '',
        ageMs: entry.ageMs ?? -1,
        usable: entry.usable,
        source: entry.source,
      })),
    };
  }

  @Post('quotes')
  @UseGuards(JwtAuthGuard, VerifiedUserGuard)
  async createQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createQuoteRequestSchema)) body: CreateQuoteRequest,
  ): Promise<QuoteResponse> {
    return this.quotes.create(user.id, body);
  }
}
