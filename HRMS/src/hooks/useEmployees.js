import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import {
  fetchAllEmployeesApi, fetchTeamEmployeesApi, fetchEmployeeByIdApi,
  createEmployeeApi, updateEmployeeApi, deleteEmployeeApi, deactivateEmployeeApi,
} from '../api/employees.api';
import { useEmployeeStore } from '../store/employeeStore';
import { invalidateAndRefetch, patchQueriesData } from '../lib/queryCache';

export function useEmployees() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  const userId = useAuthStore((s) => s.user?.id);
  const setEmployees = useEmployeeStore((s) => s.setEmployees);
  const isHrAdmin = role === 'admin' || role === 'hr';

  // Employee role has no team/directory API — avoid 403 noise on profile pages.
  const canFetchRoster = isHrAdmin || role === 'manager';

  const query = useQuery({
    queryKey: ['employees', isHrAdmin ? 'all' : 'team', userId],
    queryFn: async () => {
      const rows = isHrAdmin
        ? await fetchAllEmployeesApi({ limit: 200 })
        : await fetchTeamEmployeesApi(userId);
      setEmployees(rows);
      return rows;
    },
    enabled: isAuthenticated && canFetchRoster && Boolean(userId || isHrAdmin),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  // Only show API data — never fall back to a seeded/mock roster.
  const employees = Array.isArray(query.data) ? query.data : [];

  return {
    ...query,
    employees,
  };
}

export function useEmployee(id) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['employees', id],
    queryFn: () => fetchEmployeeByIdApi(id),
    enabled: isAuthenticated && Boolean(id),
    staleTime: 30_000,
  });
}

export function useEmployeeMutations() {
  const qc = useQueryClient();
  const setEmployees = useEmployeeStore((s) => s.setEmployees);
  const removeEmployee = useEmployeeStore((s) => s.removeEmployee);

  const syncStoreFromCache = () => {
    const entries = qc.getQueriesData({ queryKey: ['employees'] });
    const listEntry = entries.find(([key, data]) => Array.isArray(data) && key[1] === 'all');
    if (listEntry?.[1]) setEmployees(listEntry[1]);
  };

  const invalidate = async () => {
    await invalidateAndRefetch(qc, ['employees']);
    await invalidateAndRefetch(qc, ['dashboard']);
    syncStoreFromCache();
  };

  return {
    create: useMutation({
      mutationFn: createEmployeeApi,
      onSuccess: async (result) => {
        if (result?.employee) {
          patchQueriesData(qc, ['employees'], (old) => {
            if (!Array.isArray(old)) return old;
            return [result.employee, ...old.filter((e) => e.id !== result.employee.id)];
          });
        }
        await invalidate();
      },
    }),
    update: useMutation({
      mutationFn: ({ id, payload }) => updateEmployeeApi(id, payload),
      onSuccess: async (updated, { id }) => {
        patchQueriesData(qc, ['employees'], (old) => {
          if (!Array.isArray(old)) return old;
          return old.map((e) => (e.id === id ? { ...e, ...updated } : e));
        });
        qc.setQueryData(['employees', id], updated);
        await invalidate();
      },
    }),
    remove: useMutation({
      mutationFn: deleteEmployeeApi,
      onSuccess: async (_, id) => {
        removeEmployee(id);
        patchQueriesData(qc, ['employees'], (old) => {
          if (!Array.isArray(old)) return old;
          return old.filter((e) => e.id !== id);
        });
        qc.removeQueries({ queryKey: ['employees', id] });
        await invalidate();
      },
    }),
    deactivate: useMutation({
      mutationFn: deactivateEmployeeApi,
      onSuccess: invalidate,
    }),
  };
}

export function useEmployeeMap() {
  const { employees } = useEmployees();
  return useMemo(() => {
    const map = {};
    const codeCount = {};
    for (const e of employees || []) {
      const code = e.employeeCode;
      if (code) codeCount[code] = (codeCount[code] || 0) + 1;
    }
    for (const e of employees || []) {
      map[e.id] = e;
      // Only index by code when unique across the org (avoids EMP001 collisions)
      if (e.employeeCode && codeCount[e.employeeCode] === 1) {
        map[e.employeeCode] = e;
      }
    }
    return map;
  }, [employees]);
}
