import { Injectable } from '@nestjs/common';
import { NotificationDto } from '@morapay/contracts';
import { PrismaService } from '../common/prisma.service';

/**
 * In-app notifications (BUILD_PLAN 14.1).
 *
 * The outbox reaches the outside world; this is what a sender sees when they
 * open the app. Both are written from the same place on purpose — a status
 * change visible in email and not in the app is a support ticket, and a status
 * change visible in neither is how somebody concludes their money is lost.
 *
 * Nothing here touches financial state. A notification is a record that we told
 * somebody something, and it is never the reason anything happened.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(input: {
    readonly userId: string;
    readonly kind: string;
    readonly title: string;
    readonly body: string;
    /** An in-app path. External URLs are refused rather than rendered. */
    readonly link?: string | null;
  }): Promise<void> {
    const link = input.link ?? null;
    await this.prisma.userNotification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        // A notification whose link left the app would be a phishing primitive
        // we shipped ourselves, so anything that is not a relative path is
        // dropped rather than sanitised into something plausible.
        link: link !== null && link.startsWith('/') ? link : null,
      },
    });
  }

  async list(
    userId: string,
    limit = 50,
  ): Promise<{ notifications: NotificationDto[]; unread: number }> {
    const [rows, unread] = await Promise.all([
      this.prisma.userNotification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.userNotification.count({ where: { userId, readAt: null } }),
    ]);

    return {
      notifications: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        link: row.link,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
      })),
      unread,
    };
  }

  /**
   * Mark one as read.
   *
   * Scoped by user in the `where`, not checked afterwards: an ownership test
   * that happens after the update is a test that can be forgotten.
   */
  async markRead(userId: string, id: string): Promise<void> {
    await this.prisma.userNotification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.prisma.userNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }
}
