'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/app/providers';
import { api } from '@/lib/api';
import { AppShell, ErrorNotice, LoadingCard, RequireAuth } from '@/components/shell';

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

function NotificationsInner() {
  const { t } = useApp();
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api<{ notifications: Notification[]; unread: number }>('/notifications');
      setNotifications(result.notifications);
      setUnread(result.unread);
    } catch {
      setError(t('error.generic'));
      setNotifications([]);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markAll() {
    await api('/notifications/read-all', { method: 'POST' });
    await load();
  }

  if (notifications === null) return <LoadingCard />;

  return (
    <div className="mp-stack">
      <div className="mp-row">
        <h1 style={{ margin: 0 }}>{t('notifications.title')}</h1>
        {unread > 0 ? (
          <button className="mp-button mp-button--ghost" onClick={markAll}>
            {t('notifications.markAll')}
          </button>
        ) : null}
      </div>

      <ErrorNotice message={error} />

      {notifications.length === 0 ? (
        <div className="mp-card">
          <p className="mp-muted mp-small" style={{ margin: 0 }}>
            {t('notifications.empty')}
          </p>
        </div>
      ) : (
        <ul className="mp-list">
          {notifications.map((notification) => {
            const body = (
              <>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>{notification.title}</strong>
                  <br />
                  <span className="mp-small mp-muted">{notification.body}</span>
                  <br />
                  <span className="mp-small mp-muted">
                    {new Date(notification.createdAt).toLocaleString()}
                  </span>
                </span>
                {notification.read ? null : (
                  <span
                    aria-label={t('notifications.unread')}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      background: 'var(--brand-500, #e08a1e)',
                      flex: 'none',
                      alignSelf: 'center',
                    }}
                  />
                )}
              </>
            );

            return (
              <li key={notification.id}>
                {/* Only ever an in-app path — the API refuses to store anything else. */}
                {notification.link === null ? (
                  <div className="mp-list__item" style={{ cursor: 'default' }}>
                    {body}
                  </div>
                ) : (
                  <Link
                    href={notification.link}
                    className="mp-list__item"
                    onClick={() =>
                      void api(`/notifications/${notification.id}/read`, { method: 'POST' })
                    }
                  >
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <AppShell>
      <RequireAuth>
        <NotificationsInner />
      </RequireAuth>
    </AppShell>
  );
}
