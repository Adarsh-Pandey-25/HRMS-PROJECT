import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { useCompanyStore } from '../store/companyStore';
import { fetchAllSettingsApi, fetchLeavePolicyApi, fetchRolePermissionsApi, fetchCompanyProfileApi } from '../api/settings.api';

export { updateSettingApi } from '../api/settings.api';

/** Read a field that may arrive as snake_case or camelCase after API mapping. */
function pick(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] != null) return obj[k];
  }
  return undefined;
}

/** Hydrate local settings store from backend on login. */
export function useSettingsBootstrap() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const updatePayrollConfig = useSettingsStore((s) => s.updatePayrollConfig);
  const updateLeavePolicy = useSettingsStore((s) => s.updateLeavePolicy);
  const updateAttendanceConfig = useSettingsStore((s) => s.updateAttendanceConfig);
  const updateTrainingConfig = useSettingsStore((s) => s.updateTrainingConfig);
  const updateExpenseConfig = useSettingsStore((s) => s.updateExpenseConfig);
  const updateAssetConfig = useSettingsStore((s) => s.updateAssetConfig);
  const updateHelpdeskConfig = useSettingsStore((s) => s.updateHelpdeskConfig);
  const updateSecurityConfig = useSettingsStore((s) => s.updateSecurityConfig);
  const updateBackupConfig = useSettingsStore((s) => s.updateBackupConfig);
  const updateRecruitmentConfig = useSettingsStore((s) => s.updateRecruitmentConfig);
  const updateAnnouncementConfig = useSettingsStore((s) => s.updateAnnouncementConfig);
  const updateIntegrationsConfig = useSettingsStore((s) => s.updateIntegrationsConfig);
  const updateNotificationConfig = useSettingsStore((s) => s.updateNotificationConfig);
  const setRolePermissions = useSettingsStore((s) => s.setRolePermissions);
  const updateCompany = useCompanyStore((s) => s.updateCompany);
  const setDocumentTypes = useSettingsStore((s) => s.setDocumentTypes);

  const role = useAuthStore((s) => s.role);
  const canLoadAllSettings = role === 'admin' || role === 'hr';
  const [deferHeavySettings, setDeferHeavySettings] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !canLoadAllSettings) return undefined;
    const run = () => setDeferHeavySettings(true);
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(run, 1500);
    return () => clearTimeout(id);
  }, [isAuthenticated, canLoadAllSettings]);

  const settingsQuery = useQuery({
    queryKey: ['settings', 'all'],
    queryFn: fetchAllSettingsApi,
    enabled: isAuthenticated && canLoadAllSettings && deferHeavySettings,
    staleTime: 60_000,
  });

  const leavePolicyQuery = useQuery({
    queryKey: ['settings', 'leave-policy'],
    queryFn: fetchLeavePolicyApi,
    enabled: isAuthenticated && canLoadAllSettings && deferHeavySettings,
    staleTime: 60_000,
  });

  const rolePermissionsQuery = useQuery({
    queryKey: ['settings', 'role_permissions'],
    queryFn: fetchRolePermissionsApi,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const companyProfileQuery = useQuery({
    queryKey: ['settings', 'company-profile'],
    queryFn: fetchCompanyProfileApi,
    enabled: isAuthenticated,
    staleTime: 300_000,
  });

  useEffect(() => {
    if (companyProfileQuery.data && typeof companyProfileQuery.data === 'object') {
      updateCompany(companyProfileQuery.data);
    }
  }, [companyProfileQuery.data, updateCompany]);

  useEffect(() => {
    if (rolePermissionsQuery.data != null) {
      setRolePermissions(rolePermissionsQuery.data);
    }
  }, [rolePermissionsQuery.data, setRolePermissions]);

  useEffect(() => {
    if (!settingsQuery.data?.length) return;
    const map = Object.fromEntries(settingsQuery.data.map((s) => [s.key, s.value]));
    const patch = {};

    if (map.payroll_working_days != null) patch.workingDaysPerMonth = Number(map.payroll_working_days);
    if (map.payroll_pf_rate != null) patch.pfEmployeePercent = Math.round(Number(map.payroll_pf_rate) * 100);
    if (map.payroll_professional_tax != null) patch.professionalTaxAmount = Number(map.payroll_professional_tax);
    if (map.payroll_tds_percent != null) patch.tdsPercent = Number(map.payroll_tds_percent);
    if (map.payroll_esi_employee_percent != null) patch.esiEmployeePercent = Number(map.payroll_esi_employee_percent);
    if (map.payroll_esi_threshold != null) patch.esiThreshold = Number(map.payroll_esi_threshold);

    if (map.payroll_config && typeof map.payroll_config === 'object') {
      const pc = map.payroll_config;
      const pfEmp = pick(pc, 'pfEmployeePercent', 'pf_employee_percent');
      const pfEr = pick(pc, 'pfEmployerPercent', 'pf_employer_percent');
      const ptAmt = pick(pc, 'professionalTaxAmount', 'professional_tax_amount');
      const tdsPct = pick(pc, 'tdsPercent', 'tds_percent');
      const tdsMode = pick(pc, 'tdsMode', 'tds_mode');
      const ptState = pick(pc, 'ptState', 'pt_state');
      const esiEmp = pick(pc, 'esiEmployeePercent', 'esi_employee_percent');
      const esiEr = pick(pc, 'esiEmployerPercent', 'esi_employer_percent');
      const esiThr = pick(pc, 'esiThreshold', 'esi_threshold');
      const pfCeil = pick(pc, 'pfWageCeiling', 'pf_wage_ceiling');
      const custom = pick(pc, 'customPayrollOptions', 'custom_payroll_options');
      const components = pick(pc, 'components');
      const hraPct = pick(pc, 'hraPercent', 'hra_percent');
      const daPct = pick(pc, 'daPercent', 'da_percent');
      const runDate = pick(pc, 'runDate', 'run_date');
      const autoProcess = pick(pc, 'autoProcess', 'auto_process');
      const autoLockDays = pick(pc, 'autoLockDays', 'auto_lock_days');
      const bankFileFormat = pick(pc, 'bankFileFormat', 'bank_file_format');

      if (pfEmp != null) patch.pfEmployeePercent = Number(pfEmp);
      if (pfEr != null) patch.pfEmployerPercent = Number(pfEr);
      if (ptAmt != null) patch.professionalTaxAmount = Number(ptAmt);
      if (tdsPct != null) patch.tdsPercent = Number(tdsPct);
      if (tdsMode) patch.tdsMode = tdsMode;
      if (ptState) patch.ptState = ptState;
      if (esiEmp != null) patch.esiEmployeePercent = Number(esiEmp);
      if (esiEr != null) patch.esiEmployerPercent = Number(esiEr);
      if (esiThr != null) patch.esiThreshold = Number(esiThr);
      if (pfCeil !== undefined) patch.pfWageCeiling = pfCeil == null || pfCeil === '' ? null : Number(pfCeil);
      if (components && typeof components === 'object') patch.components = components;
      if (hraPct != null) patch.hraPercent = Number(hraPct);
      if (daPct != null) patch.daPercent = Number(daPct);
      if (runDate != null) patch.runDate = Math.min(28, Math.max(1, Number(runDate) || 25));
      if (autoProcess != null) patch.autoProcess = Boolean(autoProcess);
      if (autoLockDays != null) patch.autoLockDays = Number(autoLockDays) || 20;
      if (bankFileFormat) patch.bankFileFormat = String(bankFileFormat);
      if (Array.isArray(custom)) {
        patch.customPayrollOptions = custom.map((o, i) => ({
          id: o.id || `PO-${i}`,
          name: o.name || '',
          kind: o.kind || 'deduction',
          valueType: o.valueType || o.value_type || 'fixed',
          value: Number(o.value || 0),
          base: o.base || 'basic',
          active: o.active !== false,
        }));
      }
    }

    if (Object.keys(patch).length) updatePayrollConfig(patch);

    if (map.company_profile && typeof map.company_profile === 'object') {
      updateCompany(map.company_profile);
    }

    if (map.attendance_config && typeof map.attendance_config === 'object') {
      const ac = map.attendance_config;
      updateAttendanceConfig(ac);
      const windowDays = pick(ac, 'newJoinerWindowDays', 'new_joiner_window_days');
      const deadlineDays = pick(ac, 'newJoinerDeadlineDays', 'new_joiner_deadline_days');
      const ordered = pick(ac, 'orderedNewJoinerVideos', 'ordered_new_joiner_videos');
      const trainingPatch = {};
      if (windowDays != null) trainingPatch.newJoinerWindowDays = Number(windowDays);
      if (deadlineDays != null) trainingPatch.newJoinerDeadlineDays = Number(deadlineDays);
      if (ordered != null) trainingPatch.enforceWatchOrder = Boolean(ordered);
      if (Object.keys(trainingPatch).length) updateTrainingConfig(trainingPatch);
    }

    if (map.leave_policy_meta && typeof map.leave_policy_meta === 'object') {
      const meta = map.leave_policy_meta;
      updateLeavePolicy({
        approvalLevel: pick(meta, 'approvalLevel', 'approval_level') || 'single',
        accrualMethod: pick(meta, 'accrualMethod', 'accrual_method') || 'upfront',
        autoDeduct: Boolean(pick(meta, 'autoDeduct', 'auto_deduct')),
      });
    }

    if (Array.isArray(map.document_types) && map.document_types.length) {
      setDocumentTypes(map.document_types);
    }

    if (map.expense_config && typeof map.expense_config === 'object') {
      const ec = map.expense_config;
      updateExpenseConfig({
        approvalFlow: pick(ec, 'approvalFlow', 'approval_flow') || 'manager-then-hr',
        requireReceiptAbove: Number(pick(ec, 'requireReceiptAbove', 'require_receipt_above') ?? 500),
      });
    }

    if (map.asset_config && typeof map.asset_config === 'object') {
      updateAssetConfig(map.asset_config);
    }
    if (map.training_config && typeof map.training_config === 'object') {
      const tc = map.training_config;
      updateTrainingConfig({
        newJoinerWindowDays: Number(pick(tc, 'newJoinerWindowDays', 'new_joiner_window_days') ?? 90),
        newJoinerDeadlineDays: Number(pick(tc, 'newJoinerDeadlineDays', 'new_joiner_deadline_days') ?? 30),
        enforceWatchOrder: Boolean(pick(tc, 'enforceWatchOrder', 'enforce_watch_order') ?? true),
        notifyHrOnOverdue: Boolean(pick(tc, 'notifyHrOnOverdue', 'notify_hr_on_overdue') ?? true),
        certificateOnCompletion: Boolean(pick(tc, 'certificateOnCompletion', 'certificate_on_completion') ?? true),
      });
    }
    if (map.helpdesk_config && typeof map.helpdesk_config === 'object') {
      updateHelpdeskConfig(map.helpdesk_config);
    }
    if (map.security_config && typeof map.security_config === 'object') {
      updateSecurityConfig(map.security_config);
    }
    if (map.backup_config && typeof map.backup_config === 'object') {
      updateBackupConfig(map.backup_config);
    }
    if (map.recruitment_config && typeof map.recruitment_config === 'object') {
      updateRecruitmentConfig(map.recruitment_config);
    }
    if (map.announcement_config && typeof map.announcement_config === 'object') {
      updateAnnouncementConfig(map.announcement_config);
    }
    if (map.integrations_config && typeof map.integrations_config === 'object') {
      updateIntegrationsConfig(map.integrations_config);
    }
    if (map.notification_config && typeof map.notification_config === 'object') {
      const nc = map.notification_config;
      updateNotificationConfig({
        smtp: {
          enabled: Boolean(nc.smtp?.enabled),
          host: '',
          port: 587,
          username: '',
          password: '',
          fromName: '',
          fromEmail: '',
          encryption: 'TLS',
        },
        ...(Array.isArray(nc.triggers) ? { triggers: nc.triggers } : {}),
      });
    }
  }, [
    settingsQuery.data,
    updatePayrollConfig,
    updateCompany,
    updateAttendanceConfig,
    updateTrainingConfig,
    updateExpenseConfig,
    updateAssetConfig,
    updateHelpdeskConfig,
    updateSecurityConfig,
    updateBackupConfig,
    updateRecruitmentConfig,
    updateAnnouncementConfig,
    updateIntegrationsConfig,
    updateNotificationConfig,
    updateLeavePolicy,
    setDocumentTypes,
  ]);

  useEffect(() => {
    const raw = leavePolicyQuery.data;
    if (raw == null) return;

    const list = Array.isArray(raw)
      ? raw
      : (raw.leave_types || raw.leaveTypes || raw.policy || null);

    if (!Array.isArray(list) || !list.length) return;

    const types = list.map((t, i) => ({
      id: t.id || `LT-${t.code || i}`,
      code: t.code,
      name: t.name || t.label || t.code,
      daysPerYear: Number(t.allocation ?? t.days_per_year ?? t.daysPerYear ?? 0),
      carryForward: Boolean(t.carry_forward ?? t.carryForward),
      maxCarry: Number(t.max_carry ?? t.maxCarry ?? 0),
      encashment: Boolean(t.encashment),
      paid: t.paid !== false,
      active: t.active !== false,
    }));
    updateLeavePolicy({ leaveTypes: types });
  }, [leavePolicyQuery.data, updateLeavePolicy]);

  return {
    isLoading: settingsQuery.isLoading || leavePolicyQuery.isLoading || rolePermissionsQuery.isLoading,
  };
}
