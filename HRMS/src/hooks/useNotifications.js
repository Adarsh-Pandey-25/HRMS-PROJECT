import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import {
  fetchNotificationsApi, fetchUnreadCountApi,
  markNotificationReadApi, markAllNotificationsReadApi,
} from '../api/notifications.api';
import { invalidateAndRefetch } from '../lib/queryCache';

function useUserId() {
  return useAuthStore((s) => s.user?.id || null);
}

export function useNotifications({ enabled = true } = {}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const userId = useUserId();
  return useQuery({
    queryKey: ['notifications', userId, 'list'],
    queryFn: () => fetchNotificationsApi({ limit: 50 }),
    enabled: Boolean(isAuthenticated && userId && enabled),
    staleTime: 45_000,
    refetchInterval: 90_000,
  });
}

export function useUnreadNotificationCount() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const userId = useUserId();
  return useQuery({
    queryKey: ['notifications', userId, 'unread-count'],
    queryFn: fetchUnreadCountApi,
    enabled: Boolean(isAuthenticated && userId),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function useNotificationMutations() {
  const qc = useQueryClient();
  const userId = useUserId();
  const listKey = ['notifications', userId, 'list'];
  const countKey = ['notifications', userId, 'unread-count'];

  const invalidate = async () => {
    await invalidateAndRefetch(qc, ['notifications', userId]);
  };

  return {
    markRead: useMutation({
      mutationFn: markNotificationReadApi,
      onMutate: async (id) => {
        await qc.cancelQueries({ queryKey: ['notifications', userId] });
        const prevList = qc.getQueryData(listKey);
        const prevCount = qc.getQueryData(countKey);
        qc.setQueryData(listKey, (old) =>
          Array.isArray(old)
            ? old.map((n) => (n.id === id ? { ...n, read: true } : n))
            : old
        );
        const wasUnread = Array.isArray(prevList) && prevList.some((n) => n.id === id && !n.read);
        if (wasUnread) {
          qc.setQueryData(countKey, (c) => Math.max(0, Number(c || 0) - 1));
        }
        return { prevList, prevCount };
      },
      onError: (_err, _id, ctx) => {
        if (ctx?.prevList) qc.setQueryData(listKey, ctx.prevList);
        if (ctx?.prevCount != null) qc.setQueryData(countKey, ctx.prevCount);
      },
      onSettled: invalidate,
    }),
    markAllRead: useMutation({
      mutationFn: markAllNotificationsReadApi,
      onMutate: async () => {
        await qc.cancelQueries({ queryKey: ['notifications', userId] });
        const prevList = qc.getQueryData(listKey);
        const prevCount = qc.getQueryData(countKey);
        qc.setQueryData(listKey, (old) =>
          Array.isArray(old) ? old.map((n) => ({ ...n, read: true })) : old
        );
        qc.setQueryData(countKey, 0);
        return { prevList, prevCount };
      },
      onError: (_err, _v, ctx) => {
        if (ctx?.prevList) qc.setQueryData(listKey, ctx.prevList);
        if (ctx?.prevCount != null) qc.setQueryData(countKey, ctx.prevCount);
      },
      onSettled: invalidate,
    }),
  };
}
