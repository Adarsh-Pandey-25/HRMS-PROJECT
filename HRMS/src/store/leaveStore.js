import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { leaveRequests as seed } from '../data';

// Shared leave-request state so MyLeave / TeamLeave / LeaveApprovals stay in sync
// with each other even though each is now a standalone routed page. Persisted
// so submissions/approvals survive a page reload in this demo (no backend).
export const useLeaveStore = create(
  persist(
    (set) => ({
      requests: seed,
      act: (id, status) => set((s) => ({ requests: s.requests.map((r) => (r.id === id ? { ...r, status } : r)) })),
      submit: (request) => set((s) => ({ requests: [request, ...s.requests] })),
    }),
    { name: 'zenith-leave' }
  )
);
