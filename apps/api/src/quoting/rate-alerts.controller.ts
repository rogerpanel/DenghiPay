import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  CreateRateAlertRequest,
  RateAlertDto,
  RateAlertListResponse,
  createRateAlertRequestSchema,
} from '@morapay/contracts';
import { RateAlertsService } from './rate-alerts.service';
import { AuthenticatedUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { zodBody } from '../common/zod.pipe';

/** Rate alerts (BUILD_PLAN 14.5). Watching a rate moves no money, so no verified guard. */
@Controller('rate-alerts')
@UseGuards(JwtAuthGuard)
export class RateAlertsController {
  constructor(private readonly alerts: RateAlertsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<RateAlertListResponse> {
    return { alerts: await this.alerts.list(user.id) };
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createRateAlertRequestSchema)) body: CreateRateAlertRequest,
  ): Promise<RateAlertDto> {
    return this.alerts.create(user.id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.alerts.remove(user.id, id);
  }
}
