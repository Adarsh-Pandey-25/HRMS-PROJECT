import { create } from 'zustand';

/** Live employee directory cache — filled from the API via useEmployees(). Not persisted (PII). */
export const useEmployeeStore = create((set, get) => ({
  employees: [],

  addEmployee: (emp) => set((s) => ({ employees: [emp, ...s.employees] })),
  updateEmployee: (id, patch) =>
    set((s) => ({
      employees: s.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })),
  removeEmployee: (id) => set((s) => ({ employees: s.employees.filter((e) => e.id !== id) })),
  setEmployees: (employees) => set({ employees: Array.isArray(employees) ? employees : [] }),

  getEmployee: (id) => get().employees.find((e) => e.id === id) || null,
}));
