import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { expenses as seed } from '../data';

export const useExpenseStore = create(
  persist(
    (set) => ({
      expenses: seed,
      act: (id, status) => set((s) => ({ expenses: s.expenses.map((e) => (e.id === id ? { ...e, status } : e)) })),
      submit: (claim) => set((s) => ({ expenses: [claim, ...s.expenses] })),
    }),
    { name: 'zenith-expenses' }
  )
);
