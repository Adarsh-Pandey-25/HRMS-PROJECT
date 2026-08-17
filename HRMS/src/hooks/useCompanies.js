import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchMyCompanyApi,
  fetchAccessibleCompaniesApi,
  fetchChildCompaniesApi,
  createChildCompanyApi,
  updateChildCompanyApi,
  fetchCompanyEmployeesApi,
  uploadCompanyLogoApi,
} from '../api/companies.api';

export const companyKeys = {
  me: ['companies', 'me'],
  accessible: ['companies', 'accessible'],
  children: ['companies', 'children'],
  employees: (id) => ['companies', id, 'employees'],
};

export function useMyCompany(enabled = true) {
  return useQuery({
    queryKey: companyKeys.me,
    queryFn: fetchMyCompanyApi,
    enabled,
    staleTime: 60_000,
  });
}

export function useAccessibleCompanies(enabled = true) {
  return useQuery({
    queryKey: companyKeys.accessible,
    queryFn: fetchAccessibleCompaniesApi,
    enabled,
    staleTime: 30_000,
  });
}

export function useChildCompanies(enabled = true) {
  return useQuery({
    queryKey: companyKeys.children,
    queryFn: fetchChildCompaniesApi,
    enabled,
    staleTime: 30_000,
  });
}

export function useCompanyEmployees(companyId, enabled = true) {
  return useQuery({
    queryKey: companyKeys.employees(companyId),
    queryFn: () => fetchCompanyEmployeesApi(companyId),
    enabled: Boolean(companyId) && enabled,
    staleTime: 15_000,
  });
}

export function useCompanyMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['companies'] });
  };

  const createChild = useMutation({
    mutationFn: createChildCompanyApi,
    onSuccess: invalidate,
  });

  const updateChild = useMutation({
    mutationFn: ({ id, ...payload }) => updateChildCompanyApi(id, payload),
    onSuccess: invalidate,
  });

  const uploadLogo = useMutation({
    mutationFn: ({ id, file }) => uploadCompanyLogoApi(id, file),
    onSuccess: invalidate,
  });

  return { createChild, updateChild, uploadLogo };
}
