import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import {
  fetchMyAssetsApi, fetchAssetsApi, fetchAssetRequestsApi, submitAssetRequestApi,
  updateAssetRequestApi, createAssetApi, updateAssetApi, assignAssetApi, returnAssetApi,
  fetchAssetCategoriesApi, createAssetCategoryApi,
} from '../api/assets.api';
import {
  fetchMyTicketsApi, fetchAllTicketsApi, createTicketApi,
  updateTicketStatusApi, addTicketCommentApi, fetchKbCategoriesApi, fetchKbArticlesApi,
} from '../api/helpdesk.api';
import {
  fetchJobsApi, fetchCandidatesApi, moveCandidateApi, createJobApi, createCandidateApi,
  fetchInterviewsApi, createInterviewApi, updateInterviewOutcomeApi,
  fetchOffersApi, createOfferApi,
  fetchCandidateChecklistApi, toggleCandidateChecklistItemApi,
} from '../api/recruitment.api';
import {
  fetchChecklistTemplatesApi, createChecklistTemplateApi,
  updateChecklistTemplateApi, deleteChecklistTemplateApi,
} from '../api/onboardingChecklist.api';
import {
  fetchMyGoalsApi, createGoalApi, updateGoalApi,
  fetchReviewCyclesApi, createReviewCycleApi,
  fetchTeamReviewsApi, openTeamReviewsApi, updateReviewApi,
} from '../api/performance.api';
import { invalidateAndRefetch } from '../lib/queryCache';

export function useMyAssets(options = {}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const enabled = options.enabled !== false;
  return useQuery({ queryKey: ['assets', 'mine'], queryFn: fetchMyAssetsApi, enabled: isAuthenticated && enabled });
}

export function useAssets(params) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  const canList = ['admin', 'hr'].includes(role);
  return useQuery({
    queryKey: ['assets', params],
    queryFn: () => fetchAssetsApi(params),
    enabled: isAuthenticated && canList,
  });
}

export function useAssetCategories() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['assets', 'categories'], queryFn: fetchAssetCategoriesApi, enabled: isAuthenticated });
}

export function useAssetRequests(params) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['assets', 'requests', params], queryFn: () => fetchAssetRequestsApi(params), enabled: isAuthenticated });
}

export function useAssetMutations() {
  const qc = useQueryClient();
  const invalidate = async () => {
    await invalidateAndRefetch(qc, ['assets']);
    await invalidateAndRefetch(qc, ['dashboard']);
  };
  const invalidateCategories = async () => {
    await invalidate();
    await invalidateAndRefetch(qc, ['assets', 'categories']);
  };
  return {
    submitRequest: useMutation({ mutationFn: submitAssetRequestApi, onSuccess: invalidate }),
    updateRequest: useMutation({ mutationFn: ({ id, status }) => updateAssetRequestApi(id, status), onSuccess: invalidate }),
    createAsset: useMutation({ mutationFn: createAssetApi, onSuccess: invalidateCategories }),
    updateAsset: useMutation({ mutationFn: ({ id, ...payload }) => updateAssetApi(id, payload), onSuccess: invalidate }),
    assignAsset: useMutation({ mutationFn: ({ id, employeeId }) => assignAssetApi(id, employeeId), onSuccess: invalidate }),
    returnAsset: useMutation({ mutationFn: returnAssetApi, onSuccess: invalidate }),
    createCategory: useMutation({ mutationFn: createAssetCategoryApi, onSuccess: invalidateCategories }),
  };
}

export function useMyTickets() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['helpdesk', 'my'], queryFn: fetchMyTicketsApi, enabled: isAuthenticated });
}

export function useAllTickets(params) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['helpdesk', 'all', params], queryFn: () => fetchAllTicketsApi(params), enabled: isAuthenticated });
}

export function useKbCategories() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['helpdesk', 'kb', 'categories'], queryFn: fetchKbCategoriesApi, enabled: isAuthenticated });
}

export function useKbArticles(category) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['helpdesk', 'kb', 'articles', category],
    queryFn: () => fetchKbArticlesApi(category),
    enabled: isAuthenticated,
  });
}

export function useHelpdeskMutations() {
  const qc = useQueryClient();
  const invalidate = async () => {
    await invalidateAndRefetch(qc, ['helpdesk']);
    await invalidateAndRefetch(qc, ['dashboard']);
  };
  return {
    createTicket: useMutation({ mutationFn: createTicketApi, onSuccess: invalidate }),
    updateStatus: useMutation({ mutationFn: ({ id, status }) => updateTicketStatusApi(id, status), onSuccess: invalidate }),
    addComment: useMutation({ mutationFn: ({ id, text }) => addTicketCommentApi(id, text), onSuccess: invalidate }),
  };
}

export function useJobs() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['recruitment', 'jobs'], queryFn: fetchJobsApi, enabled: isAuthenticated });
}

export function useCandidates(params) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['recruitment', 'candidates', params], queryFn: () => fetchCandidatesApi(params), enabled: isAuthenticated });
}

export function useInterviews() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['recruitment', 'interviews'], queryFn: fetchInterviewsApi, enabled: isAuthenticated });
}

export function useOffers() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['recruitment', 'offers'], queryFn: fetchOffersApi, enabled: isAuthenticated });
}

export function useRecruitmentMutations() {
  const qc = useQueryClient();
  const invalidate = async () => {
    await invalidateAndRefetch(qc, ['recruitment']);
    await invalidateAndRefetch(qc, ['dashboard']);
  };
  return {
    createJob: useMutation({ mutationFn: createJobApi, onSuccess: invalidate }),
    createCandidate: useMutation({ mutationFn: createCandidateApi, onSuccess: invalidate }),
    moveCandidate: useMutation({ mutationFn: ({ id, stage }) => moveCandidateApi(id, stage), onSuccess: invalidate }),
    createInterview: useMutation({ mutationFn: createInterviewApi, onSuccess: invalidate }),
    updateInterviewOutcome: useMutation({
      mutationFn: ({ id, ...payload }) => updateInterviewOutcomeApi(id, payload),
      onSuccess: invalidate,
    }),
    createOffer: useMutation({ mutationFn: createOfferApi, onSuccess: invalidate }),
  };
}

/** Onboarding checklist templates (admin-configurable, company-wide) — Settings > Onboarding Checklist. */
export function useChecklistTemplates() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['onboarding-checklist-templates'],
    queryFn: fetchChecklistTemplatesApi,
    enabled: isAuthenticated,
  });
}

export function useChecklistTemplateMutations() {
  const qc = useQueryClient();
  const invalidate = () => invalidateAndRefetch(qc, ['onboarding-checklist-templates']);
  return {
    createTemplate: useMutation({ mutationFn: createChecklistTemplateApi, onSuccess: invalidate }),
    updateTemplate: useMutation({ mutationFn: ({ id, patch }) => updateChecklistTemplateApi(id, patch), onSuccess: invalidate }),
    deleteTemplate: useMutation({ mutationFn: deleteChecklistTemplateApi, onSuccess: invalidate }),
  };
}

/** One candidate's onboarding checklist — active templates joined with checked state. */
export function useCandidateChecklist(candidateId) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['recruitment', 'candidate-checklist', candidateId],
    queryFn: () => fetchCandidateChecklistApi(candidateId),
    enabled: isAuthenticated && !!candidateId,
  });
}

export function useToggleCandidateChecklistItem(candidateId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, isChecked }) => toggleCandidateChecklistItemApi(candidateId, templateId, isChecked),
    onSuccess: () => invalidateAndRefetch(qc, ['recruitment', 'candidate-checklist', candidateId]),
  });
}

export function useMyGoals() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['performance', 'goals'], queryFn: fetchMyGoalsApi, enabled: isAuthenticated });
}

export function useReviewCycles() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['performance', 'cycles'], queryFn: fetchReviewCyclesApi, enabled: isAuthenticated });
}

export function useTeamReviews() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['performance', 'team-reviews'], queryFn: fetchTeamReviewsApi, enabled: isAuthenticated });
}

export function usePerformanceMutations() {
  const qc = useQueryClient();
  const invalidate = async () => {
    await invalidateAndRefetch(qc, ['performance']);
    await invalidateAndRefetch(qc, ['dashboard']);
  };
  return {
    createGoal: useMutation({ mutationFn: createGoalApi, onSuccess: invalidate }),
    updateGoal: useMutation({
      mutationFn: ({ id, ...payload }) => updateGoalApi(id, payload),
      onSuccess: invalidate,
    }),
    createCycle: useMutation({ mutationFn: createReviewCycleApi, onSuccess: invalidate }),
    openTeamReviews: useMutation({ mutationFn: (cycleId) => openTeamReviewsApi(cycleId), onSuccess: invalidate }),
    updateReview: useMutation({
      mutationFn: ({ id, ...payload }) => updateReviewApi(id, payload),
      onSuccess: invalidate,
    }),
  };
}
