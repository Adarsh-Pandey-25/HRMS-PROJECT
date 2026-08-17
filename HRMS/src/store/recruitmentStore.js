import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { candidates as seed } from '../data';

// Shared candidate-stage state so Candidates (kanban) and Offers stay in sync
// now that they're separate routed pages. Persisted so stage changes survive
// a page reload in this demo (no backend).
export const useRecruitmentStore = create(
  persist(
    (set) => ({
      candidates: seed,
      moveCandidate: (id, stage) => set((s) => ({ candidates: s.candidates.map((c) => (c.id === id ? { ...c, stage, daysInStage: 0 } : c)) })),
    }),
    { name: 'zenith-recruitment' }
  )
);
