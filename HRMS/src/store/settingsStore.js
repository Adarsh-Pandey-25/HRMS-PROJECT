import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildDefaultRolePermissions, mergeRolePermissions, PERMISSION_ACTIONS } from '../lib/permissions';

// ---------------------------------------------------------------------------
// Employee Document Config — default document types (Settings -> Employee
// Document Config) that also drive the Documents section of Add Employee.
// ---------------------------------------------------------------------------
// Work locations / branches — shown wherever a "Branch" or "Location" picker
// appears (Employee Directory filter, Add/Edit Employee, Job postings), and
// extensible so an Admin/HR user can add a new city without a code change.
const DEFAULT_LOCATIONS = ['Bangalore HQ', 'Mumbai', 'Delhi NCR', 'Gurugram', 'Hyderabad', 'Remote'];

const DEFAULT_DOCUMENT_TYPES = [
  { id: 'DOC-TYPE-001', name: 'Aadhaar Card', category: 'identity', isDefault: true, isRequired: false, acceptedFormats: ['pdf', 'jpg', 'png'], maxSizeMB: 5, isActive: true },
  { id: 'DOC-TYPE-002', name: 'PAN Card', category: 'identity', isDefault: true, isRequired: false, acceptedFormats: ['pdf', 'jpg', 'png'], maxSizeMB: 5, isActive: true },
  { id: 'DOC-TYPE-003', name: 'Employee Photo', category: 'identity', isDefault: true, isRequired: false, acceptedFormats: ['jpg', 'png'], maxSizeMB: 2, isActive: true },
  { id: 'DOC-TYPE-004', name: 'Passport', category: 'identity', isDefault: true, isRequired: false, acceptedFormats: ['pdf', 'jpg', 'png'], maxSizeMB: 5, isActive: true },
  { id: 'DOC-TYPE-005', name: '10th Marksheet', category: 'education', isDefault: true, isRequired: false, acceptedFormats: ['pdf', 'jpg', 'png'], maxSizeMB: 5, isActive: true },
  { id: 'DOC-TYPE-006', name: '12th Marksheet', category: 'education', isDefault: true, isRequired: false, acceptedFormats: ['pdf', 'jpg', 'png'], maxSizeMB: 5, isActive: true },
  { id: 'DOC-TYPE-007', name: 'Graduation Certificate', category: 'education', isDefault: true, isRequired: false, acceptedFormats: ['pdf', 'jpg', 'png'], maxSizeMB: 5, isActive: true },
  { id: 'DOC-TYPE-008', name: 'Post-Grad / Masters', category: 'education', isDefault: true, isRequired: false, acceptedFormats: ['pdf', 'jpg', 'png'], maxSizeMB: 5, isActive: true },
  { id: 'DOC-TYPE-009', name: 'Other Certificate', category: 'education', isDefault: true, isRequired: false, acceptedFormats: ['pdf', 'jpg', 'png'], maxSizeMB: 5, isActive: true },
  { id: 'DOC-TYPE-010', name: 'Offer Letter', category: 'employment', isDefault: true, isRequired: false, acceptedFormats: ['pdf'], maxSizeMB: 5, isActive: true },
  { id: 'DOC-TYPE-011', name: 'Experience Letter', category: 'employment', isDefault: true, isRequired: false, acceptedFormats: ['pdf', 'jpg', 'png'], maxSizeMB: 5, isActive: true },
];

const DEFAULT_ATTENDANCE_CONFIG = {
  methods: { web: true, app: true, biometric: false, ipWeb: true, ipApp: false },
  ipWhitelist: [
    { id: 'IP-001', ip: '192.168.1.0/24', label: 'Bangalore HQ', active: true },
  ],
  biometricDevices: [],
  shifts: [
    { id: 'SHIFT-001', name: 'General Shift', start: '09:00', end: '18:00', active: true },
    { id: 'SHIFT-002', name: 'Morning Shift', start: '07:00', end: '16:00', active: true },
    { id: 'SHIFT-003', name: 'Night Shift', start: '22:00', end: '07:00', active: true },
  ],
  gracePeriodMinutes: 15,
  autoAbsentTime: '11:00',
  overtimeAfterHours: 9,
  selfieRequired: false,
  newJoinerWindowDays: 90,
  newJoinerDeadlineDays: 30,
  orderedNewJoinerVideos: true,
};

const DEFAULT_LEAVE_POLICY = {
  leaveTypes: [
    { id: 'LT-CL', code: 'CL', name: 'Casual Leave', daysPerYear: 12, carryForward: false, maxCarry: 0, encashment: false, paid: true, active: true },
    { id: 'LT-SL', code: 'SL', name: 'Sick Leave', daysPerYear: 12, carryForward: false, maxCarry: 0, encashment: false, paid: true, active: true },
    { id: 'LT-EL', code: 'EL', name: 'Earned Leave', daysPerYear: 15, carryForward: true, maxCarry: 10, encashment: true, paid: true, active: true },
    { id: 'LT-WFH', code: 'WFH', name: 'Work From Home', daysPerYear: 0, carryForward: false, maxCarry: 0, encashment: false, paid: true, active: true },
    { id: 'LT-COMP', code: 'COMP_OFF', name: 'Comp Off', daysPerYear: 0, carryForward: false, maxCarry: 0, encashment: false, paid: true, active: true },
    { id: 'LT-MAT', code: 'MATERNITY', name: 'Maternity Leave', daysPerYear: 182, carryForward: false, maxCarry: 0, encashment: false, paid: true, active: true },
    { id: 'LT-PAT', code: 'PATERNITY', name: 'Paternity Leave', daysPerYear: 15, carryForward: false, maxCarry: 0, encashment: false, paid: true, active: true },
    { id: 'LT-UNP', code: 'UNPAID', name: 'Unpaid Leave', daysPerYear: 0, carryForward: false, maxCarry: 0, encashment: false, paid: false, active: true },
  ],
  approvalLevel: 'single',
  accrualMethod: 'upfront',
  autoDeduct: false,
  holidays: [],
};

const DEFAULT_PAYROLL_CONFIG = {
  components: { hra: true, da: true, special: true, transport: false, medical: false },
  hraPercent: 40,
  daPercent: 10,
  pfEmployeePercent: 12,
  pfEmployerPercent: 12,
  esiEmployeePercent: 0.75,
  esiEmployerPercent: 3.25,
  esiThreshold: 21000,
  // PF is computed on full basic by default (pfWageCeiling: null). Set a number
  // (e.g. 15000, the EPF statutory ceiling) to cap the PF-eligible wage.
  pfWageCeiling: null,
  ptState: 'Karnataka',
  professionalTaxAmount: 200,
  ptSlabs: [
    { min: 0, max: 24999, amount: 0 },
    { min: 25000, max: null, amount: 200 },
  ],
  tdsMode: 'auto',
  tdsPercent: 8,
  tdsRegime: 'new',
  standardDeduction: 75000,
  workingDaysPerMonth: 26,
  /** Extra payroll lines (deductions/allowances) configurable in Settings → Payroll */
  customPayrollOptions: [],
  runDate: 25,
  autoLockDays: 20,
  autoProcess: false,
  bankFileFormat: 'NEFT',
};

const DEFAULT_NOTIFICATION_TRIGGERS = [
  { event: 'Leave approved', inApp: true, mobile: true, email: true },
  { event: 'Leave rejected', inApp: true, mobile: true, email: true },
  { event: 'Leave pending approval', inApp: true, mobile: true, email: true },
  { event: 'Expense approved', inApp: true, mobile: true, email: true },
  { event: 'Expense rejected', inApp: true, mobile: true, email: true },
  { event: 'New announcement', inApp: true, mobile: true, email: true },
  { event: 'Payslip ready', inApp: true, mobile: true, email: true },
  { event: 'Asset assigned', inApp: true, mobile: true, email: false },
  { event: 'Helpdesk ticket updated', inApp: true, mobile: true, email: true },
  { event: 'Helpdesk ticket resolved', inApp: true, mobile: true, email: true },
  { event: 'Birthday reminder (to HR)', inApp: true, mobile: false, email: false },
  { event: 'Work anniversary reminder', inApp: true, mobile: false, email: true },
];

const DEFAULT_NOTIFICATION_CONFIG = {
  smtp: {
    enabled: false,
    // Credentials must never live in the browser — use backend/.env
    host: '',
    port: 587,
    username: '',
    password: '',
    fromName: '',
    fromEmail: '',
    encryption: 'TLS',
  },
  triggers: DEFAULT_NOTIFICATION_TRIGGERS,
};

// Remaining Settings sections (Recruitment, Announcement, Asset, Expense,
// Training, Helpdesk, Integrations, Security, Data & Backup) — reasonable
// working defaults so every section has real, saveable state.
const DEFAULT_RECRUITMENT_CONFIG = {
  stages: ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'],
  careersPageEnabled: true,
  careersPageSlug: 'acmetech',
  offerLetterTemplate: 'Dear {{candidateName}}, we are pleased to offer you the position of {{role}}...',
  autoRejectAfterDays: 30,
};

const DEFAULT_ANNOUNCEMENT_CONFIG = {
  defaultChannels: { inApp: true, mobilePush: true, email: false },
  emailSubjectTemplate: '[{{company}}] {{priority}}: {{title}}',
  requireApproval: false,
};

const DEFAULT_ASSET_CONFIG = {
  categories: ['Laptop', 'Phone', 'Tablet', 'Monitor', 'Furniture', 'Peripheral'],
  depreciationMethod: 'straight-line', // straight-line | declining-balance
  depreciationYears: 3,
  exitRecoveryReminderDays: 7,
};

const DEFAULT_EXPENSE_CONFIG = {
  categories: [
    { type: 'travel', name: 'Travel' },
    { type: 'food', name: 'Meals' },
    { type: 'other', name: 'Accommodation' },
    { type: 'office_supplies', name: 'Office Supplies' },
    { type: 'client_entertainment', name: 'Client Entertainment' },
    { type: 'medical', name: 'Medical' },
    { type: 'internet_phone', name: 'Internet' },
    { type: 'other', name: 'Other' },
  ],
  approvalFlow: 'manager-then-hr', // manager-only | manager-then-hr
  requireReceiptAbove: 500,
};

const DEFAULT_TRAINING_CONFIG = {
  newJoinerWindowDays: 90,
  newJoinerDeadlineDays: 30,
  enforceWatchOrder: true,
  notifyHrOnOverdue: true,
  certificateOnCompletion: true,
};

const DEFAULT_HELPDESK_CONFIG = {
  categories: ['IT', 'HR', 'Admin', 'Finance', 'Payroll', 'Other'],
  slaHours: { low: 72, medium: 48, high: 24, critical: 4 },
  autoAssignment: true,
  escalateAfterHours: 24,
};

const DEFAULT_INTEGRATIONS_CONFIG = {
  slack: { connected: false, webhookUrl: '' },
  googleCalendar: { connected: false },
  webhooks: [],
  whatsapp: { connected: false, businessNumber: '' },
};

const DEFAULT_SECURITY_CONFIG = {
  passwordMinLength: 8,
  passwordRequireSpecialChar: true,
  passwordRequireNumber: true,
  twoFactorEnabled: false,
  sessionTimeoutMinutes: 60,
  auditLogEnabled: true,
};

const DEFAULT_BACKUP_CONFIG = {
  autoBackupEnabled: true,
  autoBackupFrequency: 'daily', // daily | weekly | monthly
  dataRetentionMonths: 24,
  lastBackupAt: '2026-07-08T02:00:00Z',
};

export const useSettingsStore = create(
  persist(
    (set, get) => ({
      locations: DEFAULT_LOCATIONS,
      rolePermissions: buildDefaultRolePermissions(),
      documentTypes: DEFAULT_DOCUMENT_TYPES,
      attendanceConfig: DEFAULT_ATTENDANCE_CONFIG,
      leavePolicy: DEFAULT_LEAVE_POLICY,
      payrollConfig: DEFAULT_PAYROLL_CONFIG,
      notificationConfig: DEFAULT_NOTIFICATION_CONFIG,
      recruitmentConfig: DEFAULT_RECRUITMENT_CONFIG,
      announcementConfig: DEFAULT_ANNOUNCEMENT_CONFIG,
      assetConfig: DEFAULT_ASSET_CONFIG,
      expenseConfig: DEFAULT_EXPENSE_CONFIG,
      trainingConfig: DEFAULT_TRAINING_CONFIG,
      helpdeskConfig: DEFAULT_HELPDESK_CONFIG,
      integrationsConfig: DEFAULT_INTEGRATIONS_CONFIG,
      securityConfig: DEFAULT_SECURITY_CONFIG,
      backupConfig: DEFAULT_BACKUP_CONFIG,

      // -- Role permissions matrix (RBAC) --
      updateRolePermission: (role, module, action, value) =>
        set((s) => ({
          rolePermissions: {
            ...s.rolePermissions,
            [role]: {
              ...s.rolePermissions[role],
              [module]: { ...s.rolePermissions[role][module], [action]: value },
            },
          },
        })),
      updateRoleModuleAll: (role, module, value) =>
        set((s) => {
          const nextMod = { ...(s.rolePermissions[role]?.[module] || {}) };
          for (const action of PERMISSION_ACTIONS) nextMod[action] = value;
          return {
            rolePermissions: {
              ...s.rolePermissions,
              [role]: {
                ...s.rolePermissions[role],
                [module]: nextMod,
              },
            },
          };
        }),
      setRolePermissions: (matrix) => set({ rolePermissions: mergeRolePermissions(matrix) }),
      resetRolePermissions: () => set({ rolePermissions: buildDefaultRolePermissions() }),

      // -- Work locations / branches --
      addLocation: (name) =>
        set((s) => (s.locations.some((l) => l.toLowerCase() === name.toLowerCase()) ? s : { locations: [...s.locations, name] })),
      removeLocation: (name) => set((s) => ({ locations: s.locations.filter((l) => l !== name) })),

      // -- Document types --
      addDocumentType: (type) =>
        set((s) => ({
          documentTypes: [
            ...s.documentTypes,
            { id: `DOC-TYPE-${String(s.documentTypes.length + 1).padStart(3, '0')}`, isDefault: false, isActive: true, ...type },
          ],
        })),
      updateDocumentType: (id, patch) =>
        set((s) => ({ documentTypes: s.documentTypes.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
      toggleDocumentTypeActive: (id) =>
        set((s) => ({ documentTypes: s.documentTypes.map((d) => (d.id === id ? { ...d, isActive: !d.isActive } : d)) })),
      removeDocumentType: (id) => set((s) => ({ documentTypes: s.documentTypes.filter((d) => d.id !== id) })),
      setDocumentTypes: (types) => set({ documentTypes: Array.isArray(types) ? types : [] }),

      // -- Generic per-section setters (shallow patch + persisted) --
      updateAttendanceConfig: (patch) => set((s) => ({ attendanceConfig: { ...s.attendanceConfig, ...patch } })),
      updateLeavePolicy: (patch) => set((s) => ({ leavePolicy: { ...s.leavePolicy, ...patch } })),
      updatePayrollConfig: (patch) => set((s) => ({ payrollConfig: { ...s.payrollConfig, ...patch } })),
      updateNotificationConfig: (patch) => set((s) => ({ notificationConfig: { ...s.notificationConfig, ...patch } })),
      updateRecruitmentConfig: (patch) => set((s) => ({ recruitmentConfig: { ...s.recruitmentConfig, ...patch } })),
      updateAnnouncementConfig: (patch) => set((s) => ({ announcementConfig: { ...s.announcementConfig, ...patch } })),
      updateAssetConfig: (patch) => set((s) => ({ assetConfig: { ...s.assetConfig, ...patch } })),
      updateExpenseConfig: (patch) => set((s) => ({ expenseConfig: { ...s.expenseConfig, ...patch } })),
      updateTrainingConfig: (patch) => set((s) => ({ trainingConfig: { ...s.trainingConfig, ...patch } })),
      updateHelpdeskConfig: (patch) => set((s) => ({ helpdeskConfig: { ...s.helpdeskConfig, ...patch } })),
      updateIntegrationsConfig: (patch) => set((s) => ({ integrationsConfig: { ...s.integrationsConfig, ...patch } })),
      updateSecurityConfig: (patch) => set((s) => ({ securityConfig: { ...s.securityConfig, ...patch } })),
      updateBackupConfig: (patch) => set((s) => ({ backupConfig: { ...s.backupConfig, ...patch } })),

      // -- Leave policy list helpers --
      addLeaveType: (lt) =>
        set((s) => {
          const code = (lt.code || lt.name || 'CUSTOM')
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 40) || `CUSTOM_${s.leavePolicy.leaveTypes.length + 1}`;
          return {
            leavePolicy: {
              ...s.leavePolicy,
              leaveTypes: [
                ...s.leavePolicy.leaveTypes,
                {
                  id: `LT-${code}`,
                  code,
                  active: true,
                  daysPerYear: 0,
                  carryForward: false,
                  maxCarry: 0,
                  encashment: false,
                  paid: true,
                  ...lt,
                  code, // keep generated/override code
                },
              ],
            },
          };
        }),
      updateLeaveType: (id, patch) =>
        set((s) => ({ leavePolicy: { ...s.leavePolicy, leaveTypes: s.leavePolicy.leaveTypes.map((l) => (l.id === id ? { ...l, ...patch } : l)) } })),
      removeLeaveType: (id) =>
        set((s) => ({ leavePolicy: { ...s.leavePolicy, leaveTypes: s.leavePolicy.leaveTypes.filter((l) => l.id !== id) } })),
      addHoliday: (h) =>
        set((s) => ({
          leavePolicy: {
            ...s.leavePolicy,
            holidays: [...s.leavePolicy.holidays, { id: `HOL-${String(s.leavePolicy.holidays.length + 1).padStart(3, '0')}`, ...h }].sort((a, b) => a.date.localeCompare(b.date)),
          },
        })),
      removeHoliday: (id) =>
        set((s) => ({ leavePolicy: { ...s.leavePolicy, holidays: s.leavePolicy.holidays.filter((h) => h.id !== id) } })),

      // -- Attendance config list helpers --
      addIpWhitelist: (entry) =>
        set((s) => ({
          attendanceConfig: {
            ...s.attendanceConfig,
            ipWhitelist: [...s.attendanceConfig.ipWhitelist, { id: `IP-${String(s.attendanceConfig.ipWhitelist.length + 1).padStart(3, '0')}`, active: true, ...entry }],
          },
        })),
      removeIpWhitelist: (id) =>
        set((s) => ({ attendanceConfig: { ...s.attendanceConfig, ipWhitelist: s.attendanceConfig.ipWhitelist.filter((i) => i.id !== id) } })),
      addBiometricDevice: (device) =>
        set((s) => ({
          attendanceConfig: {
            ...s.attendanceConfig,
            biometricDevices: [
              ...s.attendanceConfig.biometricDevices,
              {
                id: `BIO-${String(s.attendanceConfig.biometricDevices.length + 1).padStart(3, '0')}`,
                active: true,
                lastSync: null,
                name: device.name,
                deviceId: device.deviceId,
                location: device.location,
                // Never persist device API secrets in the browser
              },
            ],
          },
        })),
      removeBiometricDevice: (id) =>
        set((s) => ({ attendanceConfig: { ...s.attendanceConfig, biometricDevices: s.attendanceConfig.biometricDevices.filter((d) => d.id !== id) } })),
      syncBiometricDevice: (id) =>
        set((s) => ({
          attendanceConfig: {
            ...s.attendanceConfig,
            biometricDevices: s.attendanceConfig.biometricDevices.map((d) => (d.id === id ? { ...d, lastSync: new Date().toISOString() } : d)),
          },
        })),
      addShift: (shift) =>
        set((s) => ({
          attendanceConfig: {
            ...s.attendanceConfig,
            shifts: [...s.attendanceConfig.shifts, { id: `SHIFT-${String(s.attendanceConfig.shifts.length + 1).padStart(3, '0')}`, active: true, ...shift }],
          },
        })),
      removeShift: (id) =>
        set((s) => ({ attendanceConfig: { ...s.attendanceConfig, shifts: s.attendanceConfig.shifts.filter((sh) => sh.id !== id) } })),

      // -- Notification triggers --
      updateNotificationTrigger: (event, channel, value) =>
        set((s) => ({
          notificationConfig: {
            ...s.notificationConfig,
            triggers: s.notificationConfig.triggers.map((t) => (t.event === event ? { ...t, [channel]: value } : t)),
          },
        })),
    }),
    {
      name: 'zenith-settings',
      version: 5,
      migrate: (persisted, fromVersion) => {
        let next = persisted && typeof persisted === 'object' ? { ...persisted } : {};
        // v1 stored experimental matrix toggles that hid most Employee modules.
        if (fromVersion < 2) {
          next = {
            ...next,
            rolePermissions: buildDefaultRolePermissions(),
          };
        }
        // v3: purge any SMTP secrets accidentally persisted in the browser
        if (fromVersion < 3 && next.notificationConfig) {
          next = {
            ...next,
            notificationConfig: {
              ...next.notificationConfig,
              smtp: {
                ...(next.notificationConfig.smtp || {}),
                host: '',
                username: '',
                password: '',
                fromName: '',
                fromEmail: '',
              },
            },
          };
        }
        // v4: strip biometric apiKey fields from persisted attendance config
        if (fromVersion < 4 && next.attendanceConfig?.biometricDevices) {
          next = {
            ...next,
            attendanceConfig: {
              ...next.attendanceConfig,
              biometricDevices: (next.attendanceConfig.biometricDevices || []).map(({ apiKey, ...rest }) => rest),
            },
          };
        }
        // v5: ensure Gurugram is available in work location pickers
        if (fromVersion < 5) {
          const existing = Array.isArray(next.locations) ? next.locations : DEFAULT_LOCATIONS;
          if (!existing.some((l) => String(l).toLowerCase() === 'gurugram')) {
            const delhiIdx = existing.findIndex((l) => /delhi/i.test(String(l)));
            const insertAt = delhiIdx >= 0 ? delhiIdx + 1 : existing.length;
            next = {
              ...next,
              locations: [
                ...existing.slice(0, insertAt),
                'Gurugram',
                ...existing.slice(insertAt),
              ],
            };
          }
        }
        return next;
      },
      merge: (persisted, current) => {
        const merged = {
          ...current,
          ...(persisted || {}),
          rolePermissions: mergeRolePermissions(persisted?.rolePermissions ?? current.rolePermissions),
        };
        // Always keep shipped default cities available (even if an older persist list omitted them).
        const locList = Array.isArray(merged.locations) ? [...merged.locations] : [...DEFAULT_LOCATIONS];
        for (const loc of DEFAULT_LOCATIONS) {
          if (!locList.some((l) => String(l).toLowerCase() === loc.toLowerCase())) {
            locList.push(loc);
          }
        }
        merged.locations = locList;
        if (merged.notificationConfig?.smtp) {
          merged.notificationConfig = {
            ...merged.notificationConfig,
            smtp: {
              ...merged.notificationConfig.smtp,
              host: '',
              username: '',
              password: '',
              fromName: '',
              fromEmail: '',
            },
          };
        }
        if (merged.attendanceConfig?.biometricDevices) {
          merged.attendanceConfig = {
            ...merged.attendanceConfig,
            biometricDevices: merged.attendanceConfig.biometricDevices.map(({ apiKey, ...rest }) => rest),
          };
        }
        return merged;
      },
    }
  )
);
