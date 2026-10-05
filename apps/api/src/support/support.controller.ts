import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  CreateSupportThreadRequest,
  SupportReplyRequest,
  SupportThreadDto,
  SupportThreadListResponse,
  createSupportThreadRequestSchema,
  supportReplyRequestSchema,
} from '@morapay/contracts';
import { SupportService } from './support.service';
import { AuthenticatedUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { zodBody } from '../common/zod.pipe';

/**
 * Customer support (BUILD_PLAN 14.6).
 *
 * `JwtAuthGuard` without `VerifiedUserGuard`, deliberately: somebody whose
 * email will not verify needs support more than anyone, and locking them out of
 * the contact channel is how that becomes an angry review instead of a ticket.
 */
@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<SupportThreadListResponse> {
    return { threads: await this.support.listForUser(user.id) };
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SupportThreadDto> {
    return this.support.get(user.id, id);
  }

  @Post()
  @HttpCode(201)
  async open(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createSupportThreadRequestSchema)) body: CreateSupportThreadRequest,
  ): Promise<SupportThreadDto> {
    return this.support.open(user.id, body);
  }

  @Post(':id/reply')
  @HttpCode(200)
  async reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(supportReplyRequestSchema)) body: SupportReplyRequest,
  ): Promise<SupportThreadDto> {
    return this.support.reply(user.id, id, body.body);
  }
}
