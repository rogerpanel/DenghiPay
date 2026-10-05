import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { NotificationListResponse } from '@morapay/contracts';
import { NotificationsService } from './notifications.service';
import { AuthenticatedUser, CurrentUser, JwtAuthGuard } from '../auth/guards';

/**
 * In-app notifications (BUILD_PLAN 14.1).
 *
 * `JwtAuthGuard` only, deliberately without `VerifiedUserGuard`: an unverified
 * account still needs to be told things, and the first thing it needs to be
 * told is to confirm its email.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<NotificationListResponse> {
    return this.notifications.list(user.id);
  }

  @Post(':id/read')
  @HttpCode(204)
  async markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.notifications.markRead(user.id, id);
  }

  @Post('read-all')
  @HttpCode(200)
  async markAllRead(@CurrentUser() user: AuthenticatedUser): Promise<{ marked: number }> {
    return { marked: await this.notifications.markAllRead(user.id) };
  }
}
