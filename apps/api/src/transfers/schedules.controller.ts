import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  CreateScheduleRequest,
  ScheduleDto,
  ScheduleListResponse,
  createScheduleRequestSchema,
} from '@morapay/contracts';
import { SchedulesService } from './schedules.service';
import { AuthenticatedUser, CurrentUser, JwtAuthGuard, VerifiedUserGuard } from '../auth/guards';
import { zodBody } from '../common/zod.pipe';

/**
 * Standing instructions (BUILD_PLAN 14.4).
 *
 * `VerifiedUserGuard` applies here as it does to transfers: a schedule leads to
 * money moving, so the same bar to entry.
 */
@Controller('schedules')
@UseGuards(JwtAuthGuard, VerifiedUserGuard)
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<ScheduleListResponse> {
    return { schedules: await this.schedules.list(user.id) };
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createScheduleRequestSchema)) body: CreateScheduleRequest,
  ): Promise<ScheduleDto> {
    return this.schedules.create(user.id, body);
  }

  /**
   * Pause, and resume.
   *
   * Not a delete: a sender asking "did you take money from me in March"
   * deserves an answer, and a deleted schedule cannot give one.
   */
  @Post(':id/pause')
  @HttpCode(200)
  async pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ScheduleDto> {
    return this.schedules.setActive(user.id, id, false);
  }

  @Post(':id/resume')
  @HttpCode(200)
  async resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ScheduleDto> {
    return this.schedules.setActive(user.id, id, true);
  }
}
