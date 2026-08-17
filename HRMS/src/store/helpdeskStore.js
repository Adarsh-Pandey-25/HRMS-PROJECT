import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { tickets as seed } from '../data';

export const useHelpdeskStore = create(
  persist(
    (set) => ({
      tickets: seed,
      submit: (ticket) => set((s) => ({ tickets: [ticket, ...s.tickets] })),
      addComment: (id, comment) => set((s) => ({ tickets: s.tickets.map((t) => (t.id === id ? { ...t, comments: [...t.comments, comment] } : t)) })),
      setStatus: (id, status) => set((s) => ({ tickets: s.tickets.map((t) => (t.id === id ? { ...t, status } : t)) })),
    }),
    { name: 'zenith-helpdesk' }
  )
);
