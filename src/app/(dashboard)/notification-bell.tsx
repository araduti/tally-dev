'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/trpc/client';

// ---------------------------------------------------------------------------
// Entity navigation helper
// ---------------------------------------------------------------------------

function entityUrl(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case 'SUBSCRIPTION':
      return `/subscriptions/${entityId}`;
    case 'LICENSE':
      return '/licenses';
    case 'INVITATION':
      return '/settings';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Notification Bell Component
// ---------------------------------------------------------------------------

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const utils = api.useUtils();

  // Queries
  const unreadQuery = api.notification.unreadCount.useQuery(
    {},
    { refetchInterval: 30_000 }, // poll every 30s
  );
  const listQuery = api.notification.list.useQuery(
    { limit: 10 },
    { enabled: open },
  );

  const unreadCount = unreadQuery.data?.count ?? 0;
  const notifications = listQuery.data?.items ?? [];

  // Mutations
  const markAsReadMutation = api.notification.markAsRead.useMutation({
    onSuccess: () => {
      utils.notification.unreadCount.invalidate();
      utils.notification.list.invalidate();
    },
  });
  const markAllAsReadMutation = api.notification.markAllAsRead.useMutation({
    onSuccess: () => {
      utils.notification.unreadCount.invalidate();
      utils.notification.list.invalidate();
    },
  });

  // Close on outside click or Escape
  const handleClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    function onClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        handleClose();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        handleClose();
      }
    }

    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, handleClose]);

  // Handle notification click
  const handleNotificationClick = useCallback(
    (notification: { id: string; read: boolean; entityType: string | null; entityId: string | null }) => {
      // Mark as read if unread
      if (!notification.read) {
        markAsReadMutation.mutate({
          notificationId: notification.id,
          idempotencyKey: `mark-read-${notification.id}-${Date.now()}`,
        });
      }

      // Navigate to entity if possible
      const url = entityUrl(notification.entityType, notification.entityId);
      if (url) {
        router.push(url);
        setOpen(false);
      }
    },
    [markAsReadMutation, router],
  );

  // Handle mark all as read
  const handleMarkAllAsRead = useCallback(() => {
    markAllAsReadMutation.mutate({
      idempotencyKey: `mark-all-read-${Date.now()}`,
    });
  }, [markAllAsReadMutation]);

  // Type icon based on notification type
  function typeIcon(type: string): string {
    switch (type) {
      case 'INVITATION_RECEIVED':
        return '✉️';
      case 'SUBSCRIPTION_EXPIRING':
        return '⏰';
      case 'WASTE_ALERT':
        return '⚠️';
      default:
        return '🔔';
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Bell button */}
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        className="relative rounded-full p-1.5 text-slate-400 transition hover:bg-slate-700/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={() => setOpen((prev) => !prev)}
      >
        {/* Bell SVG icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.25 9a6.75 6.75 0 0 1 13.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 0 1-.573 1.23H3.705a.75.75 0 0 1-.573-1.23A8.963 8.963 0 0 0 5.25 9.75V9ZM8.159 18.753c.132.065.27.12.413.163a3.751 3.751 0 0 0 6.856 0c.143-.043.281-.098.413-.163a.75.75 0 0 1-.826 1.415 2.25 2.25 0 0 1-6.03 0 .75.75 0 0 1-.826-1.415Z"
            clipRule="evenodd"
          />
        </svg>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          role="menu"
          aria-label="Notifications"
          className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-slate-600 bg-slate-800 shadow-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <h3 className="text-sm font-semibold text-white">Notifications</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                className="text-xs text-blue-400 transition hover:text-blue-300"
                onClick={handleMarkAllAsRead}
                disabled={markAllAsReadMutation.isPending}
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-96 overflow-y-auto">
            {listQuery.isLoading && (
              <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading notifications">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse rounded-md bg-slate-700/50"
                  />
                ))}
              </div>
            )}

            {!listQuery.isLoading && notifications.length === 0 && (
              <div className="px-4 py-8 text-center">
                <span className="text-2xl" aria-hidden="true">
                  🔔
                </span>
                <p className="mt-2 text-sm text-slate-400">
                  No notifications yet
                </p>
              </div>
            )}

            {notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                role="menuitem"
                className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-700/40 ${
                  !notification.read ? 'bg-blue-500/5' : ''
                }`}
                onClick={() =>
                  handleNotificationClick({
                    id: notification.id,
                    read: notification.read,
                    entityType: notification.entityType,
                    entityId: notification.entityId,
                  })
                }
              >
                {/* Unread dot */}
                <div className="flex h-5 w-5 shrink-0 items-center justify-center pt-0.5">
                  {!notification.read ? (
                    <span
                      className="h-2 w-2 rounded-full bg-blue-500"
                      aria-label="Unread"
                    />
                  ) : (
                    <span className="text-sm" aria-hidden="true">
                      {typeIcon(notification.type)}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm ${
                      notification.read
                        ? 'text-slate-400'
                        : 'font-medium text-white'
                    }`}
                  >
                    {notification.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {notification.message}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-600">
                    {new Date(notification.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
