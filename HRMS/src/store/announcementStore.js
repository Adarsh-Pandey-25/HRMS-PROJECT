import { create } from 'zustand';
import { initialAnnouncements } from '../data';

export const useAnnouncementStore = create((set, get) => ({
  announcements: initialAnnouncements,

  // Pinned first, then newest published/scheduled first. Drafts sort last.
  feed: () => {
    const rank = (a) => (a.status === 'published' ? 2 : a.status === 'scheduled' ? 1 : 0);
    return [...get().announcements].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (rank(a) !== rank(b)) return rank(b) - rank(a);
      const at = a.publishedAt || a.scheduledAt || '';
      const bt = b.publishedAt || b.scheduledAt || '';
      return bt.localeCompare(at);
    });
  },

  unreadCount: (employeeId) =>
    get().announcements.filter((a) => a.status === 'published' && !a.readBy.includes(employeeId)).length,

  markRead: (id, employeeId) =>
    set((s) => ({
      announcements: s.announcements.map((a) =>
        a.id === id && !a.readBy.includes(employeeId) ? { ...a, readBy: [...a.readBy, employeeId] } : a
      ),
    })),

  togglePin: (id) =>
    set((s) => ({
      announcements: s.announcements.map((a) => (a.id === id ? { ...a, isPinned: !a.isPinned } : a)),
    })),

  create: (announcement) =>
    set((s) => ({
      announcements: [
        {
          id: `ANN-${String(s.announcements.length + 1).padStart(3, '0')}`,
          readBy: [],
          ...announcement,
        },
        ...s.announcements,
      ],
    })),
}));
