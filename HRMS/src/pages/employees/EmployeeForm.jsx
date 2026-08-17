import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';
import { Card, Button, Input, Select, Stepper, Toggle } from '../../components/ui';
import { DEPARTMENTS, EMPLOYMENT_TYPES, ROLES } from '../../lib/constants';
import { useSettingsStore } from '../../store/settingsStore';
import { useEmployees, useEmployeeMutations, useEmployee, useEmployeeMap } from '../../hooks/useEmployees';
import { useAccessibleCompanies } from '../../hooks/useCompanies';
import { companyOptionLabel } from '../../lib/companyLabels';
import { useAuthStore } from '../../store/authStore';
import { useSaveShortcut } from '../../hooks/useSaveShortcut';
import { formatCurrency, humanize } from '../../lib/utils';
import { recalculatePayslipsFromSettingsApi } from '../../api/payroll.api';
import { uploadDocumentApi } from '../../api/documents.api';
import { StepDocuments } from './wizard/StepDocuments';
import { StepEducation } from './wizard/StepEducation';
import { StepAdditionalDocuments } from './wizard/StepAdditionalDocuments';
import { PhotoUpload } from './wizard/StepBasicInfo';
import { AddressFields, EmergencyContactFields } from '../../components/shared/ContactDetailFields';
import toast from 'react-hot-toast';
import { employeeEditPath, employeeProfilePath, resolveEmployeeId } from '../../lib/employeeRoutes';
import {
  isSalaryComponentEnabled,
  normalizeSalaryByComponents,
  salaryStepFields,
  suggestPercentOfBasic,
} from '../../lib/payrollComponents';

const SALARY_PERIOD_OPTIONS = [
  { value: 'monthly', label: 'Per month' },
  { value: 'annual', label: 'Per annum' },
];

function toMonthlyAmount(amount, period = 'monthly') {
  const n = Number(amount || 0);
  return period === 'annual' ? n / 12 : n;
}

function fromMonthlyAmount(amount, period = 'monthly') {
  const n = Number(amount || 0);
  return period === 'annual' ? Math.round(n * 12) : n;
}

function salaryPeriodLabel(period = 'monthly') {
  return period === 'annual' ? 'per annum' : 'per month';
}

function calcPayrollOptionAmount(opt, basic, gross) {
  if (!opt?.name) return 0;
  const base = opt.base === 'gross' ? gross : basic;
  if (opt.valueType === 'percent') return Math.round(base * Number(opt.value || 0) / 100);
  return Number(opt.value || 0);
}

/**
 * Deductions preview — mirrors backend calculateContractPayslip (no LOP).
 * `overrides` = per-employee PF/PT/TDS exceptions.
 */
function deductionsFromPayrollSettings(payrollConfig, basic, gross, overrides = {}) {
  const companyPfPct = Number(payrollConfig?.pfEmployeePercent ?? 12);
  const pfPct = overrides.pfPercentOverride != null && overrides.pfPercentOverride !== ''
    ? Number(overrides.pfPercentOverride)
    : companyPfPct;
  const pfRate = Math.max(0, pfPct) / 100;
  const pfApplicable = overrides.pfApplicable !== false;
  const ptApplicable = overrides.ptApplicable !== false;
  const pt = ptApplicable ? Number(payrollConfig?.professionalTaxAmount ?? 200) : 0;
  const pfCeiling = payrollConfig?.pfWageCeiling != null ? Number(payrollConfig.pfWageCeiling) : null;
  const pfBase = pfCeiling != null && pfCeiling > 0 ? Math.min(Number(basic || 0), pfCeiling) : Number(basic || 0);
  const pf = pfApplicable ? Math.round(pfBase * pfRate) : 0;

  const customLines = (payrollConfig?.customPayrollOptions || [])
    .filter((o) => o.active !== false && o.name)
    .map((o) => ({
      id: o.id,
      name: o.name,
      kind: o.kind || 'deduction',
      amount: calcPayrollOptionAmount(o, Number(basic || 0), Number(gross || 0)),
    }));
  const customAllowances = customLines
    .filter((l) => l.kind === 'allowance')
    .reduce((s, l) => s + Number(l.amount || 0), 0);
  const grossFinal = Number(gross || 0) + customAllowances;

  const tdsCompanyRate = Number(payrollConfig?.tdsPercent ?? 8) / 100;
  const tdsMode = String(overrides.tdsMode || 'company').toLowerCase();
  let tds = 0;
  if (tdsMode === 'none') tds = 0;
  else if (tdsMode === 'fixed') tds = Math.round(Number(overrides.tdsFixed || 0));
  else tds = Math.round(grossFinal * tdsCompanyRate);

  return {
    pf,
    pt,
    tds,
    pfRate: Math.round(pfRate * 100),
    tdsRate: Math.round(tdsCompanyRate * 100),
    customLines,
    grossFinal,
  };
}

function buildSalaryDetails(data, payrollConfig) {
  const period = data.salaryPeriod || 'monthly';
  const normalized = normalizeSalaryByComponents(data, payrollConfig?.components);
  const basic = toMonthlyAmount(normalized.basic, period);
  const hra = toMonthlyAmount(normalized.hra, period);
  const da = toMonthlyAmount(normalized.da, period);
  const special = toMonthlyAmount(normalized.special, period);
  const transport = toMonthlyAmount(normalized.transport, period);
  const medical = toMonthlyAmount(normalized.medical, period);
  const gross = basic + hra + da + special + transport + medical;
  const overrides = {
    pfApplicable: data.pfApplicable !== false,
    ptApplicable: data.ptApplicable !== false,
    pfPercentOverride: data.pfPercentOverride === '' || data.pfPercentOverride == null
      ? null
      : Number(data.pfPercentOverride),
    tdsMode: data.tdsMode || 'company',
    tdsFixed: toMonthlyAmount(data.tdsFixed, period),
  };
  const { pf, pt, tds } = deductionsFromPayrollSettings(payrollConfig, basic, gross, overrides);
  return {
    basic,
    hra,
    da,
    special,
    transport,
    medical,
    pf,
    pt,
    tds,
    salary_period: period,
    pf_applicable: overrides.pfApplicable,
    pt_applicable: overrides.ptApplicable,
    esi_applicable: false,
    pf_percent: overrides.pfPercentOverride,
    tds_mode: overrides.tdsMode,
    tds_fixed: overrides.tdsFixed,
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const STEPS = [
  { label: 'Personal' },
  { label: 'Job' },
  { label: 'Salary' },
  { label: 'Access' },
  { label: 'Documents' },
];

const nameField = z
  .string()
  .trim()
  .min(1, 'Required')
  .regex(/^[A-Za-z][A-Za-z\s.'-]*$/, 'Must contain letters only (no numbers)');

const phoneField = z
  .string()
  .trim()
  .regex(/^\d{10}$/, 'Phone number must be exactly 10 digits');

const emailField = z
  .string()
  .trim()
  .min(1, 'Required')
  .email('Enter a valid email (e.g. name@company.com)');

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const dobField = z
  .string()
  .min(1, 'Required')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date')
  .refine((v) => v <= todayISO(), 'Date of birth cannot be a future date');

const salaryOverrideFields = {
  salaryPeriod: z.enum(['monthly', 'annual']).default('monthly'),
  pfApplicable: z.boolean().default(true),
  ptApplicable: z.boolean().default(true),
  pfPercentOverride: z.union([z.coerce.number().min(0).max(100), z.literal(''), z.nan()]).optional().nullable(),
  tdsMode: z.enum(['company', 'fixed', 'none']).default('company'),
  tdsFixed: z.coerce.number().min(0).default(0),
};

const contactFields = {
  addressLine1: z.string().trim().min(1, 'Required'),
  addressLine2: z.string().trim().min(1, 'Required'),
  city: z.string().trim().min(1, 'Required').regex(/^[A-Za-z][A-Za-z\s.'-]*$/, 'City must contain letters only'),
  state: z.string().trim().min(1, 'Required').regex(/^[A-Za-z][A-Za-z\s.'-]*$/, 'State must contain letters only'),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Pincode must be exactly 6 digits'),
  country: z.string().trim().min(1, 'Required').regex(/^[A-Za-z][A-Za-z\s.'-]*$/, 'Country must contain letters only'),
  emergencyName: nameField,
  emergencyPhone: phoneField,
  emergencyRelation: nameField,
  bankName: z.string().trim().min(1, 'Required').regex(/^[A-Za-z][A-Za-z\s.'&-]*$/, 'Bank name must contain letters only'),
  bankAccount: z.string().trim().min(1, 'Required').regex(/^\d{9,18}$/, 'Account number must be 9–18 digits'),
  bankIfsc: z
    .string()
    .trim()
    .min(1, 'Required')
    .regex(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, 'Enter a valid IFSC (e.g. HDFC0001234)'),
};

const addEmployeeSchema = z.object({
  firstName: nameField,
  lastName: nameField,
  dob: dobField,
  gender: z.string().min(1, 'Required'),
  personalEmail: emailField,
  phone: phoneField,

  employeeId: z.string().optional(),
  companyId: z.string().uuid().optional().or(z.literal('')),
  designation: z.string().min(1, 'Required'),
  department: z.string().min(1, 'Required'),
  employmentType: z.string().min(1, 'Required'),
  joinDate: z.string().min(1, 'Required'),
  reportingTo: z.string().nullish(),
  workLocation: z.string().min(1, 'Required'),
  attendanceMode: z.enum(['office', 'wfh', 'hybrid']).default('office'),
  shift: z.string().optional(),

  basic: z.coerce.number().min(0, 'Required'),
  hra: z.coerce.number().min(0).default(0),
  da: z.coerce.number().min(0).default(0),
  special: z.coerce.number().min(0).default(0),
  transport: z.coerce.number().min(0).default(0),
  medical: z.coerce.number().min(0).default(0),
  ...salaryOverrideFields,

  workEmail: emailField,
  role: z.string().min(1, 'Required'),
  ...contactFields,
});

const employeeSchema = z.object({
  firstName: nameField,
  lastName: nameField,
  dob: dobField,
  gender: z.string().min(1, 'Required'),
  personalEmail: emailField,
  phone: phoneField,

  employeeId: z.string().optional(),
  companyId: z.string().uuid().optional().or(z.literal('')),
  designation: z.string().min(1, 'Required'),
  department: z.string().min(1, 'Required'),
  employmentType: z.string().min(1, 'Required'),
  joinDate: z.string().min(1, 'Required'),
  reportingTo: z.string().nullish(),
  workLocation: z.string().min(1, 'Required'),
  attendanceMode: z.enum(['office', 'wfh', 'hybrid']).default('office'),
  shift: z.string().optional(),

  basic: z.coerce.number().min(0, 'Required'),
  hra: z.coerce.number().min(0).default(0),
  da: z.coerce.number().min(0).default(0),
  special: z.coerce.number().min(0).default(0),
  transport: z.coerce.number().min(0).default(0),
  medical: z.coerce.number().min(0).default(0),
  ...salaryOverrideFields,

  workEmail: emailField,
  role: z.string().min(1, 'Required'),
  ...contactFields,
});

const ADD_STEP_FIELDS = [
  ['firstName', 'lastName', 'dob', 'gender', 'personalEmail', 'phone', 'addressLine1', 'addressLine2', 'city', 'state', 'pincode', 'country', 'emergencyName', 'emergencyPhone', 'emergencyRelation', 'bankName', 'bankAccount', 'bankIfsc'],
  ['companyId', 'employeeId', 'designation', 'department', 'employmentType', 'joinDate', 'workLocation', 'attendanceMode'],
  ['basic', 'hra', 'da', 'special', 'transport', 'medical', 'salaryPeriod', 'pfApplicable', 'ptApplicable', 'tdsMode'],
  ['workEmail', 'role'],
  [],
];

const STEP_FIELDS = [
  ['firstName', 'lastName', 'dob', 'gender', 'personalEmail', 'phone', 'addressLine1', 'addressLine2', 'city', 'state', 'pincode', 'country', 'emergencyName', 'emergencyPhone', 'emergencyRelation', 'bankName', 'bankAccount', 'bankIfsc'],
  ['companyId', 'employeeId', 'designation', 'department', 'employmentType', 'joinDate', 'workLocation', 'attendanceMode'],
  ['basic', 'hra', 'da', 'special', 'transport', 'medical', 'salaryPeriod', 'pfApplicable', 'ptApplicable', 'tdsMode'],
  ['workEmail', 'role'],
  [],
];

function buildEmployeeAddress(data, existingRaw = {}, educationRecords = [], shifts = []) {
  const prev = (existingRaw && typeof existingRaw === 'object') ? existingRaw : {};
  const line1 = data.addressLine1?.trim() || data.address?.trim() || prev.line1 || '';
  const shiftName = data.shift?.trim() || prev.shift || '';
  const matchedShift = shifts.find((s) => s.name === shiftName);
  return {
    ...prev,
    line1,
    line2: data.addressLine2?.trim() || prev.line2 || '',
    city: data.city?.trim() || prev.city || '',
    state: data.state?.trim() || prev.state || '',
    pincode: data.pincode?.trim() || prev.pincode || '',
    country: data.country?.trim() || prev.country || 'India',
    work_location: data.workLocation || prev.work_location || '',
    attendance_mode: data.attendanceMode || prev.attendance_mode || 'office',
    shift: shiftName,
    shift_id: matchedShift?.id || prev.shift_id || '',
    education: Array.isArray(educationRecords) ? educationRecords : (prev.education || []),
    personal_email: data.personalEmail || prev.personal_email || '',
  };
}

function buildEmergencyContact(data) {
  const name = data.emergencyName?.trim();
  const phone = data.emergencyPhone?.trim();
  const relation = data.emergencyRelation?.trim();
  if (!name && !phone && !relation) return undefined;
  return { name: name || '', phone: phone || '', relation: relation || '' };
}

function buildBankDetails(data) {
  const bankName = data.bankName?.trim();
  const accountNumber = data.bankAccount?.trim();
  const ifsc = data.bankIfsc?.trim()?.toUpperCase();
  if (!bankName && !accountNumber && !ifsc) return undefined;
  return {
    bank_name: bankName || '',
    account_number: accountNumber || '',
    ifsc: ifsc || '',
  };
}

function employeeContactDefaults(employee = {}) {
  const ec = employee.emergencyContact || {};
  const bank = employee.bank || {};
  const addr = employee.addressRaw || {};
  return {
    addressLine1: addr.line1 || employee.address || '',
    addressLine2: addr.line2 || '',
    city: addr.city || '',
    state: addr.state || '',
    pincode: addr.pincode || '',
    country: addr.country || 'India',
    emergencyName: ec.name || '',
    emergencyPhone: ec.phone || '',
    emergencyRelation: ec.relation || '',
    bankName: bank.name || '',
    bankAccount: bank.account || '',
    bankIfsc: bank.ifsc || '',
    shift: employee.shift || addr.shift || '',
  };
}

/** Map Settings document type name → backend document_type enum */
function mapWizardDocType(name = '') {
  const n = String(name).toLowerCase();
  if (n.includes('aadhaar') || n.includes('aadhar')) return 'aadhar';
  if (n.includes('pan')) return 'pan';
  if (n.includes('offer')) return 'offer_letter';
  if (n.includes('join')) return 'joining_letter';
  if (n.includes('reliev')) return 'relieving_letter';
  if (n.includes('experience')) return 'experience_letter';
  if (n.includes('resign')) return 'resignation_letter';
  if (n.includes('form 16') || n.includes('form16')) return 'form_16';
  if (n.includes('payslip')) return 'payslip';
  return 'educational_certificate';
}

function SalaryPreview({ basic, hra, da, special, transport, medical, payrollConfig, overrides, salaryPeriod = 'monthly' }) {
  const scale = salaryPeriod === 'annual' ? 12 : 1;
  const mBasic = toMonthlyAmount(basic, salaryPeriod);
  const mHra = toMonthlyAmount(hra, salaryPeriod);
  const mDa = toMonthlyAmount(da, salaryPeriod);
  const mSpecial = toMonthlyAmount(special, salaryPeriod);
  const mTransport = toMonthlyAmount(transport, salaryPeriod);
  const mMedical = toMonthlyAmount(medical, salaryPeriod);
  const gross = mBasic + mHra + mDa + mSpecial + mTransport + mMedical;
  const monthlyOverrides = {
    ...overrides,
    tdsFixed: toMonthlyAmount(overrides?.tdsFixed, salaryPeriod),
  };
  const { pf, pt, tds, pfRate, tdsRate, customLines, grossFinal } = deductionsFromPayrollSettings(
    payrollConfig,
    mBasic,
    gross,
    monthlyOverrides
  );
  const customDeductions = customLines.filter((l) => l.kind === 'deduction').reduce((s, l) => s + Number(l.amount || 0), 0);
  const netMonthly = grossFinal - pf - pt - tds - customDeductions;
  const grossDisplay = grossFinal * scale;
  const netDisplay = netMonthly * scale;
  const tdsLabel = overrides?.tdsMode === 'fixed'
    ? 'TDS (fixed)'
    : overrides?.tdsMode === 'none'
      ? 'TDS (exempt)'
      : `TDS (est. ${tdsRate}%)`;
  const rows = [
    ['Gross', grossDisplay],
    ...customLines.filter((l) => l.kind === 'allowance' && l.amount).map((l) => [l.name, Number(l.amount) * scale]),
    [overrides?.pfApplicable === false ? 'PF (exempt)' : `PF (${pfRate}%)`, -pf * scale],
    [overrides?.ptApplicable === false ? 'Professional tax (exempt)' : 'Professional tax', -pt * scale],
    [tdsLabel, -tds * scale],
    ...customLines.filter((l) => l.kind === 'deduction' && l.amount).map((l) => [l.name, -Number(l.amount) * scale]),
  ];
  return (
    <div className="rounded-input bg-muted/50 p-5">
      <p className="text-sm font-semibold text-fg mb-1">Salary Preview</p>
      <p className="text-xs text-fg-subtle mb-3">All amounts shown {salaryPeriodLabel(salaryPeriod)}</p>
      <div className="space-y-2 text-sm">
        {rows.map(([l, v]) => (
          <div key={l} className="flex justify-between">
            <span className="text-fg-muted">{l}</span>
            <span className={v < 0 ? 'text-danger' : 'text-fg'}>{formatCurrency(v)}</span>
          </div>
        ))}
        <div className="border-t border-border pt-2 mt-2 flex justify-between">
          <span className="font-semibold text-fg">
            Net pay ({salaryPeriod === 'annual' ? 'annual' : 'monthly'})
          </span>
          <span className="font-semibold text-primary text-base">{formatCurrency(netDisplay)}</span>
        </div>
        <p className="text-[11px] text-fg-subtle pt-1">
          Payroll stores monthly values. LOP is deducted at payroll run from actual attendance absences.
        </p>
      </div>
    </div>
  );
}

function PersonalStep({ register, errors, photoFile, setPhotoFile, watch, setValue, isAdd = false }) {
  const firstNameReg = register('firstName', {
    onChange: (e) => {
      const cleaned = e.target.value.replace(/[^A-Za-z\s.'-]/g, '');
      if (cleaned !== e.target.value) setValue('firstName', cleaned, { shouldValidate: true });
    },
  });

  const lastNameReg = register('lastName', {
    onChange: (e) => {
      const cleaned = e.target.value.replace(/[^A-Za-z\s.'-]/g, '');
      if (cleaned !== e.target.value) setValue('lastName', cleaned, { shouldValidate: true });
    },
  });

  const phoneReg = register('phone', {
    onChange: (e) => {
      const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
      if (digits !== e.target.value) setValue('phone', digits, { shouldValidate: true });
    },
  });

  const bankAccountReg = register('bankAccount', {
    onChange: (e) => {
      const digits = e.target.value.replace(/\D/g, '');
      if (digits !== e.target.value) setValue('bankAccount', digits, { shouldValidate: true });
    },
  });

  const handleEmergencyPhoneInput = (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
  };

  const handleNameInput = (e) => {
    e.target.value = e.target.value.replace(/[^A-Za-z\s.'-]/g, '');
  };

  const handlePincodeInput = (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  };

  const handleBankNameInput = (e) => {
    e.target.value = e.target.value.replace(/[^A-Za-z\s.'&-]/g, '');
  };

  return (
    <div className="space-y-6">
      {setPhotoFile && (
        <PhotoUpload photoFile={photoFile} onChange={setPhotoFile} name={`${watch('firstName') || ''} ${watch('lastName') || ''}`.trim()} />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="First name"
          required
          placeholder="e.g. John"
          inputMode="text"
          {...firstNameReg}
          error={errors.firstName?.message}
        />
        <Input
          label="Last name"
          required
          placeholder="e.g. Doe"
          inputMode="text"
          {...lastNameReg}
          error={errors.lastName?.message}
        />
        <Input
          label="Date of birth"
          type="date"
          required
          max={todayISO()}
          {...register('dob')}
          error={errors.dob?.message}
        />
        <Select label="Gender" required {...register('gender')} placeholder="Select gender" options={['male', 'female', 'other']} error={errors.gender?.message} />
        <Input
          label="Personal email"
          type="email"
          required
          placeholder="e.g. john.doe@company.com"
          {...register('personalEmail')}
          error={errors.personalEmail?.message}
        />
        <Input
          label="Phone"
          required
          placeholder="e.g. 9876543210"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={10}
          {...phoneReg}
          error={errors.phone?.message}
        />
      </div>

      <div className="pt-2 border-t border-border/60 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-fg">Address</h3>
          <p className="text-xs text-fg-subtle mt-0.5">Same layout as company workspace contact details.</p>
        </div>
        <AddressFields
          register={register}
          errors={errors}
          required
          onPincodeInput={handlePincodeInput}
          onLettersInput={handleNameInput}
        />
      </div>

      <div className="pt-2 border-t border-border/60">
        <EmergencyContactFields
          register={register}
          errors={errors}
          required
          onPhoneInput={handleEmergencyPhoneInput}
          onNameInput={handleNameInput}
        />
      </div>

      <div className="space-y-4 pt-2 border-t border-border/60">
        <div>
          <h3 className="text-sm font-semibold text-fg">Bank Details</h3>
          <p className="text-xs text-fg-subtle mt-0.5">Used for payroll disbursement.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Bank name"
            required
            placeholder="e.g. HDFC Bank"
            {...register('bankName')}
            onInput={handleBankNameInput}
            error={errors.bankName?.message}
          />
          <Input
            label="Account number"
            required
            placeholder="e.g. 50100123456789"
            inputMode="numeric"
            pattern="[0-9]*"
            {...bankAccountReg}
            error={errors.bankAccount?.message}
          />
          <Input
            label="IFSC code"
            required
            placeholder="e.g. HDFC0001234"
            containerClass="sm:col-span-2"
            {...register('bankIfsc', {
              onChange: (e) => {
                const next = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
                if (next !== e.target.value) setValue('bankIfsc', next, { shouldValidate: true });
              },
            })}
            error={errors.bankIfsc?.message}
          />
        </div>
      </div>
    </div>
  );
}

function JobStep({
  register,
  errors,
  managerOptions,
  locations,
  employeeIdDisabled,
  employeeIdValue,
  shiftOptions,
  companyOptions,
  isAdd = false,
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {companyOptions?.length > 0 && (
        <Select
          label="Company"
          required
          {...register('companyId')}
          placeholder="Select company"
          options={companyOptions}
          error={errors.companyId?.message}
          hint="Which company this employee belongs to"
          containerClass="sm:col-span-2"
        />
      )}
      {employeeIdDisabled ? (
        <Input label="Employee ID" value={employeeIdValue} disabled />
      ) : (
        <Input
          label="Employee ID"
          required
          placeholder="e.g. EMP01"
          {...register('employeeId')}
          error={errors.employeeId?.message}
          hint="Auto-suggested — you can edit"
        />
      )}
      <Input
        label="Designation"
        required
        placeholder="e.g. Software Engineer"
        {...register('designation')}
        error={errors.designation?.message}
      />
      <Select label="Department" required {...register('department')} placeholder="Select department" options={DEPARTMENTS} error={errors.department?.message} />
      <Select label="Employment type" required placeholder="Select type" {...register('employmentType')} options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: humanize(t) }))} error={errors.employmentType?.message} />
      <Input label="Join date" type="date" required {...register('joinDate')} error={errors.joinDate?.message} />
      <Select label="Reporting manager" {...register('reportingTo')} placeholder="Select manager" options={managerOptions} />
      <Select label="Work location" required {...register('workLocation')} placeholder="Select location" options={locations} error={errors.workLocation?.message} />
      <Select
        label="Attendance type"
        required
        {...register('attendanceMode')}
        placeholder="Select attendance type"
        options={[
          { value: 'office', label: 'Office' },
          { value: 'wfh', label: 'WFH' },
          { value: 'hybrid', label: 'Hybrid' },
        ]}
        error={errors.attendanceMode?.message}
      />
      {shiftOptions && (
        <Select label="Shift" {...register('shift')} placeholder="Select shift" options={shiftOptions} />
      )}
    </div>
  );
}

function SalaryStep({ register, errors, watch, setValue, payrollConfig, isAdd = false }) {
  const components = payrollConfig?.components;
  const showHra = isSalaryComponentEnabled(components, 'hra');
  const showDa = isSalaryComponentEnabled(components, 'da');
  const showSpecial = isSalaryComponentEnabled(components, 'special');
  const showTransport = isSalaryComponentEnabled(components, 'transport');
  const showMedical = isSalaryComponentEnabled(components, 'medical');
  const hraPercent = Number(payrollConfig?.hraPercent ?? 40);
  const daPercent = Number(payrollConfig?.daPercent ?? 10);

  const [basic, hra, da, special, transport, medical, salaryPeriod, pfApplicable, ptApplicable, pfPercentOverride, tdsMode, tdsFixed] = watch([
    'basic', 'hra', 'da', 'special', 'transport', 'medical', 'salaryPeriod',
    'pfApplicable', 'ptApplicable', 'pfPercentOverride', 'tdsMode', 'tdsFixed',
  ]);
  const period = salaryPeriod || 'monthly';
  const periodSuffix = salaryPeriodLabel(period);
  const companyPf = payrollConfig?.pfEmployeePercent ?? 12;
  const ptMonthly = Number(payrollConfig?.professionalTaxAmount ?? 200);
  const overrides = {
    pfApplicable: pfApplicable !== false,
    ptApplicable: ptApplicable !== false,
    pfPercentOverride: pfPercentOverride === '' || pfPercentOverride == null ? null : pfPercentOverride,
    tdsMode: tdsMode || 'company',
    tdsFixed: Number(tdsFixed || 0),
  };

  const basicReg = register('basic');
  const applyAutoAllowances = (basicValue) => {
    const b = Number(basicValue ?? basic ?? 0);
    if (showHra) {
      setValue('hra', suggestPercentOfBasic(b, hraPercent), { shouldValidate: true });
    }
    if (showDa) {
      setValue('da', suggestPercentOfBasic(b, daPercent), { shouldValidate: true });
    }
  };

  const salaryPeriodReg = register('salaryPeriod');
  const allowanceFields = ['basic', 'hra', 'da', 'special', 'transport', 'medical', 'tdsFixed'];
  const handleSalaryPeriodChange = (e) => {
    const next = e.target.value;
    if (next === period) return;
    const factor = next === 'annual' ? 12 : 1 / 12;
    for (const field of allowanceFields) {
      if (!showHra && field === 'hra') continue;
      if (!showDa && field === 'da') continue;
      if (!showSpecial && field === 'special') continue;
      if (!showTransport && field === 'transport') continue;
      if (!showMedical && field === 'medical') continue;
      const current = Number(watch(field) || 0);
      setValue(field, Math.round(current * factor), { shouldDirty: true, shouldValidate: true });
    }
    salaryPeriodReg.onChange(e);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-5">
        <Select
          label="Salary entered as"
          required
          options={SALARY_PERIOD_OPTIONS}
          {...salaryPeriodReg}
          onChange={handleSalaryPeriodChange}
          error={errors.salaryPeriod?.message}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label={`Basic salary (${periodSuffix})`}
            type="number"
            required
            placeholder={period === 'annual' ? 'e.g. 300000' : 'e.g. 25000'}
            {...basicReg}
            onBlur={(e) => {
              basicReg.onBlur(e);
              applyAutoAllowances(e.target.value);
            }}
            error={errors.basic?.message}
          />
          {showHra && (
            <Input
              label={`HRA (${periodSuffix})`}
              type="number"
              placeholder={period === 'annual' ? 'e.g. 75000' : 'e.g. 6250'}
              hint={`Default ${hraPercent}% of basic — editable`}
              {...register('hra')}
              error={errors.hra?.message}
            />
          )}
          {showDa && (
            <Input
              label={`DA (${periodSuffix})`}
              type="number"
              placeholder={period === 'annual' ? 'e.g. 18000' : 'e.g. 1500'}
              hint={`Default ${daPercent}% of basic — editable`}
              {...register('da')}
              error={errors.da?.message}
            />
          )}
          {showSpecial && (
            <Input
              label={`Special allowance (${periodSuffix})`}
              type="number"
              placeholder={period === 'annual' ? 'e.g. 105000' : 'e.g. 8750'}
              {...register('special')}
              error={errors.special?.message}
            />
          )}
          {showTransport && (
            <Input
              label={`Transport allowance (${periodSuffix})`}
              type="number"
              placeholder={period === 'annual' ? 'e.g. 24000' : 'e.g. 2000'}
              {...register('transport')}
              error={errors.transport?.message}
            />
          )}
          {showMedical && (
            <Input
              label={`Medical allowance (${periodSuffix})`}
              type="number"
              placeholder={period === 'annual' ? 'e.g. 18000' : 'e.g. 1500'}
              {...register('medical')}
              error={errors.medical?.message}
            />
          )}
        </div>

        <div className="rounded-input border border-border/70 p-4 space-y-3">
          <p className="text-sm font-semibold text-fg">Deduction exceptions</p>
          <p className="text-xs text-fg-subtle">
            Company defaults come from Payroll Settings. Deductions are calculated monthly and shown {periodSuffix}.
          </p>
          <Toggle
            label="Apply PF"
            hint={`Default ${companyPf}% of Basic (${periodSuffix})`}
            checked={pfApplicable !== false}
            onChange={(v) => setValue('pfApplicable', v, { shouldDirty: true })}
          />
          {pfApplicable !== false && (
            <Input
              label="PF % override (optional)"
              type="number"
              placeholder={`Leave blank for company ${companyPf}%`}
              {...register('pfPercentOverride')}
              error={errors.pfPercentOverride?.message}
            />
          )}
          <Toggle
            label="Apply Professional Tax"
            hint={period === 'annual'
              ? `Flat ₹${ptMonthly * 12}/year (₹${ptMonthly}/month)`
              : `Flat ₹${ptMonthly}/month`}
            checked={ptApplicable !== false}
            onChange={(v) => setValue('ptApplicable', v, { shouldDirty: true })}
          />
          <Select
            label="TDS"
            options={[
              { value: 'company', label: 'Use company estimate' },
              { value: 'fixed', label: 'Fixed amount' },
              { value: 'none', label: 'No TDS' },
            ]}
            {...register('tdsMode')}
          />
          {tdsMode === 'fixed' && (
            <Input
              label={`TDS fixed amount (${periodSuffix})`}
              type="number"
              {...register('tdsFixed')}
              error={errors.tdsFixed?.message}
            />
          )}
        </div>
      </div>
      <SalaryPreview
        basic={basic}
        hra={hra}
        da={da}
        special={special}
        transport={transport}
        medical={medical}
        payrollConfig={payrollConfig}
        overrides={overrides}
        salaryPeriod={period}
      />
    </div>
  );
}

function AccessStep({ register, errors, autoEmail }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2 flex items-start gap-2">
        <Input
          label="Work email"
          required
          type="email"
          containerClass="flex-1 min-w-0"
          placeholder="e.g. john.doe@company.com"
          {...register('workEmail')}
          error={errors.workEmail?.message}
        />
        <Button type="button" variant="outline" icon={Sparkles} onClick={autoEmail} className="shrink-0 mt-[1.375rem]">
          Generate
        </Button>
      </div>
      <Select label="System role" required placeholder="Select role" {...register('role')} options={ROLES.map((r) => ({ value: r, label: humanize(r) }))} error={errors.role?.message} />
    </div>
  );
}

function nextCompanyEmployeeCode(employees = [], companyId = null) {
  const scoped = companyId
    ? employees.filter((e) => String(e.companyId || e.company_id || '') === String(companyId))
    : employees;
  let max = 0;
  for (const e of scoped) {
    const code = e.employeeCode || e.employee_code || '';
    const match = /^EMP(\d+)$/i.exec(String(code));
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `EMP${String(max + 1).padStart(3, '0')}`;
}

function AddEmployeeForm({ navigate }) {
  const role = useAuthStore((s) => s.role);
  const canAssignCompany = role === 'admin' || role === 'hr';
  const allDocumentTypes = useSettingsStore((s) => s.documentTypes);
  const documentTypes = useMemo(() => allDocumentTypes.filter((d) => d.isActive), [allDocumentTypes]);
  const { employees } = useEmployees();
  const { create } = useEmployeeMutations();
  const { data: accessibleCompanies = [] } = useAccessibleCompanies(canAssignCompany);
  const attendanceConfig = useSettingsStore((s) => s.attendanceConfig);
  const locations = useSettingsStore((s) => s.locations);
  const payrollConfig = useSettingsStore((s) => s.payrollConfig);

  const companyOptions = useMemo(() => {
    if (!canAssignCompany) return [];
    return (accessibleCompanies || [])
      .filter((c) => c.isActive !== false)
      .map((c) => ({
        value: c.id,
        label: companyOptionLabel(c, { markHomeAs: 'Your company' }),
      }));
  }, [accessibleCompanies, canAssignCompany]);

  const defaultCompanyId = useMemo(() => {
    const home = (accessibleCompanies || []).find((c) => c.isHome);
    return home?.id || companyOptions[0]?.value || '';
  }, [accessibleCompanies, companyOptions]);

  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [docFiles, setDocFiles] = useState({});
  const [educationRecords, setEducationRecords] = useState([]);
  const [additionalFiles, setAdditionalFiles] = useState({});

  const shiftOptions = attendanceConfig.shifts
    .filter((s) => s.active)
    .map((s) => ({ value: s.name, label: `${s.name} (${s.start}–${s.end})` }));

  const previewCode = useMemo(
    () => nextCompanyEmployeeCode(employees, defaultCompanyId || null),
    [employees, defaultCompanyId],
  );

  const { register, handleSubmit, trigger, watch, setValue, formState: { errors } } = useForm({
    resolver: zodResolver(addEmployeeSchema),
    mode: 'onChange',
    reValidateMode: 'onChange',
    defaultValues: {
      firstName: '',
      lastName: '',
      dob: '',
      gender: '',
      personalEmail: '',
      phone: '',
      employeeId: previewCode,
      companyId: '',
      designation: '',
      department: '',
      employmentType: 'full-time',
      joinDate: new Date().toISOString().slice(0, 10),
      reportingTo: '',
      workLocation: '',
      attendanceMode: 'office',
      shift: '',
      basic: 0,
      hra: 0,
      da: 0,
      special: 0,
      transport: 0,
      medical: 0,
      salaryPeriod: 'monthly',
      pfApplicable: true,
      ptApplicable: true,
      pfPercentOverride: '',
      tdsMode: 'company',
      tdsFixed: 0,
      workEmail: '',
      role: 'employee',
      ...employeeContactDefaults(),
    },
  });

  const selectedCompanyId = watch('companyId') || defaultCompanyId;
  const nextId = useMemo(
    () => nextCompanyEmployeeCode(employees, selectedCompanyId || null),
    [employees, selectedCompanyId],
  );

  // Prefill home company once accessible list loads
  useEffect(() => {
    if (canAssignCompany && defaultCompanyId) {
      const current = watch('companyId');
      if (!current) setValue('companyId', defaultCompanyId);
    }
  }, [canAssignCompany, defaultCompanyId, setValue, watch]);

  const managerOptions = employees
    .filter((e) => e.role === 'manager' || e.role === 'admin' || e.role === 'hr')
    .map((e) => ({ value: e.id, label: `${e.name} · ${e.designation}` }));

  const firstName = watch('firstName');
  const lastName = watch('lastName');
  const autoEmail = () => {
    if (firstName && lastName) setValue('workEmail', `${firstName}.${lastName}`.toLowerCase() + '@spaxads.com');
  };

  const onSubmit = async (data) => {
    setIsSubmitting(true);
    try {
      const result = await create.mutateAsync({
        email: data.workEmail,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        phone: data.phone || undefined,
        dateOfBirth: data.dob || undefined,
        gender: data.gender || undefined,
        department: data.department || undefined,
        designation: data.designation,
        managerId: data.reportingTo || undefined,
        dateOfJoining: data.joinDate || new Date().toISOString().slice(0, 10),
        employmentType: (data.employmentType || 'full-time').replace(/-/g, '_'),
        salaryDetails: buildSalaryDetails(data, payrollConfig),
        address: buildEmployeeAddress(data, {}, educationRecords, attendanceConfig.shifts),
        emergencyContact: buildEmergencyContact(data),
        bankDetails: buildBankDetails(data),
        ...(canAssignCompany && data.companyId ? { companyId: data.companyId } : {}),
      });

      const empId = result?.employee?.id;
      const typesById = Object.fromEntries((documentTypes || []).map((d) => [d.id, d]));
      const allDocEntries = [
        ...Object.entries(docFiles || {}),
        ...Object.entries(additionalFiles || {}),
      ];
      let docOk = 0;
      let docFail = 0;
      if (empId) {
        for (const [typeId, file] of allDocEntries) {
          if (!file) continue;
          const meta = typesById[typeId];
          try {
            await uploadDocumentApi({
              file,
              documentType: mapWizardDocType(meta?.name || file.name),
              documentName: meta?.name || file.name,
              employeeId: empId,
            });
            docOk += 1;
          } catch {
            docFail += 1;
          }
        }
      }

      const name = `${data.firstName} ${data.lastName}`.trim();
      let msg = `${name} added. Temporary password sent to their email.`;
      if (docOk) msg += ` · ${docOk} document${docOk === 1 ? '' : 's'} uploaded`;
      if (docFail) msg += ` · ${docFail} document upload failed`;
      toast.success(msg);
      navigate('/employees');
    } catch (err) {
      toast.error(err.message || 'Failed to add employee');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onInvalid = (formErrors) => {
    const firstField = Object.keys(formErrors)[0];
    const stepIdx = ADD_STEP_FIELDS.findIndex((fields) => fields.includes(firstField));
    if (stepIdx >= 0) setStep(stepIdx);
    toast.error('Please review the highlighted fields before saving.');
  };
  useSaveShortcut(() => handleSubmit(onSubmit, onInvalid)());

  const goNext = async () => {
    const fields = step === 2
      ? salaryStepFields(payrollConfig?.components)
      : ADD_STEP_FIELDS[step].filter((f) => f !== 'employeeId');
    const valid = await trigger(fields);
    if (valid) {
      if (step === 1) autoEmail();
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }
  };
  const goBack = () => (step === 0 ? navigate('/employees') : setStep((s) => s - 1));

  const setDocFile = (docTypeId, file) => setDocFiles((s) => ({ ...s, [docTypeId]: file }));
  const setAdditionalFile = (docTypeId, file) => setAdditionalFiles((s) => ({ ...s, [docTypeId]: file }));

  return (
    <>
      <Card className="p-6">
        <Stepper steps={STEPS} current={step} />
      </Card>

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="animate-fade-in">
        <Card className="p-6">
          {step === 0 && (
            <PersonalStep
              register={register}
              errors={errors}
              photoFile={photoFile}
              setPhotoFile={setPhotoFile}
              watch={watch}
              setValue={setValue}
              isAdd
            />
          )}
          {step === 1 && (
            <JobStep
              register={register}
              errors={errors}
              managerOptions={managerOptions}
              locations={locations}
              shiftOptions={shiftOptions}
              companyOptions={companyOptions}
              employeeIdDisabled
              employeeIdValue={nextId}
              isAdd
            />
          )}
          {step === 2 && (
            <SalaryStep
              register={register}
              errors={errors}
              watch={watch}
              setValue={setValue}
              payrollConfig={payrollConfig}
              isAdd
            />
          )}
          {step === 3 && <AccessStep register={register} errors={errors} autoEmail={autoEmail} isAdd />}
          {step === 4 && (
            <div className="space-y-8">
              <StepDocuments documentTypes={documentTypes} files={docFiles} setFile={setDocFile} embedded />
              <StepEducation records={educationRecords} setRecords={setEducationRecords} embedded />
              <StepAdditionalDocuments documentTypes={documentTypes} files={additionalFiles} setFile={setAdditionalFile} embedded />
            </div>
          )}

          <div className="mt-8 flex items-center justify-between pt-5 border-t border-border/60">
            <Button type="button" variant="ghost" onClick={goBack} disabled={isSubmitting}>
              {step === 0 ? 'Cancel' : 'Back'}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={goNext} icon={ArrowRight} className="flex-row-reverse">Next</Button>
            ) : (
              <Button type="submit" icon={Check} loading={isSubmitting} disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save Employee'}
              </Button>
            )}
          </div>
        </Card>
      </form>
    </>
  );
}

function EditEmployeeForm({ navigate, existing }) {
  const [step, setStep] = useState(0);
  const role = useAuthStore((s) => s.role);
  const canAssignCompany = role === 'admin' || role === 'hr';
  const { employees } = useEmployees();
  const { update } = useEmployeeMutations();
  const { data: accessibleCompanies = [] } = useAccessibleCompanies(canAssignCompany);
  const locations = useSettingsStore((s) => s.locations);
  const payrollConfig = useSettingsStore((s) => s.payrollConfig);
  const attendanceConfig = useSettingsStore((s) => s.attendanceConfig);

  const companyOptions = useMemo(() => {
    if (!canAssignCompany) return [];
    return (accessibleCompanies || [])
      .filter((c) => c.isActive !== false)
      .map((c) => ({
        value: c.id,
        label: companyOptionLabel(c, { markHomeAs: 'Your company' }),
      }));
  }, [accessibleCompanies, canAssignCompany]);

  const shiftOptions = attendanceConfig.shifts
    .filter((s) => s.active !== false)
    .map((s) => ({ value: s.name, label: `${s.name} (${s.start}–${s.end})` }));

  const {
    register, handleSubmit, trigger, watch, setValue, formState: { errors },
  } = useForm({
    resolver: zodResolver(employeeSchema.omit({ employeeId: true }).extend({
      employeeId: z.string().optional(),
    })),
    defaultValues: {
      firstName: existing.firstName,
      lastName: existing.lastName,
      dob: existing.dob || '',
      gender: existing.gender || '',
      personalEmail: existing.personalEmail || '',
      phone: existing.phone || '',
      employeeId: existing.employeeCode || existing.id,
      companyId: existing.companyId || '',
      designation: existing.designation || '',
      department: existing.department || '',
      employmentType: existing.employmentType || 'full-time',
      joinDate: existing.joinDate || '',
      reportingTo: existing.reportingTo || '',
      workLocation: existing.workLocation || '',
      shift: existing.shift || existing.addressRaw?.shift || '',
      attendanceMode: ['office', 'wfh', 'hybrid'].includes(existing.attendanceMode) ? existing.attendanceMode : 'office',
      workEmail: existing.workEmail || '',
      role: existing.role || 'employee',
      salaryPeriod: existing.salary?.salaryPeriod || 'monthly',
      basic: fromMonthlyAmount(existing.salary?.basic ?? 0, existing.salary?.salaryPeriod || 'monthly'),
      hra: fromMonthlyAmount(existing.salary?.hra ?? 0, existing.salary?.salaryPeriod || 'monthly'),
      da: fromMonthlyAmount(existing.salary?.da ?? 0, existing.salary?.salaryPeriod || 'monthly'),
      special: fromMonthlyAmount(existing.salary?.special ?? 0, existing.salary?.salaryPeriod || 'monthly'),
      transport: fromMonthlyAmount(existing.salary?.transport ?? 0, existing.salary?.salaryPeriod || 'monthly'),
      medical: fromMonthlyAmount(existing.salary?.medical ?? 0, existing.salary?.salaryPeriod || 'monthly'),
      pfApplicable: existing.salary?.pfApplicable !== false,
      ptApplicable: existing.salary?.ptApplicable !== false,
      pfPercentOverride: existing.salary?.pfPercent ?? '',
      tdsMode: existing.salary?.tdsMode || 'company',
      tdsFixed: fromMonthlyAmount(existing.salary?.tdsFixed ?? 0, existing.salary?.salaryPeriod || 'monthly'),
      ...employeeContactDefaults(existing),
    },
  });
  useSaveShortcut(() => submit());

  const firstName = watch('firstName');
  const lastName = watch('lastName');
  const autoEmail = () => {
    if (firstName && lastName) setValue('workEmail', `${firstName}.${lastName}`.toLowerCase() + '@spaxads.com');
  };

  const next = async () => {
    const fields = step === 2
      ? salaryStepFields(payrollConfig?.components)
      : STEP_FIELDS[step].filter((f) => f !== 'employeeId');
    const valid = await trigger(fields);
    if (valid) {
      if (step === 1) autoEmail();
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }
  };

  const onSubmit = async (data) => {
    try {
      await update.mutateAsync({
        id: existing.id,
        payload: {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.workEmail,
          phone: data.phone,
          dateOfBirth: data.dob,
          gender: data.gender,
          department: data.department,
          designation: data.designation,
          managerId: data.reportingTo || undefined,
          dateOfJoining: data.joinDate,
          employmentType: (data.employmentType || 'full-time').replace(/-/g, '_'),
          role: data.role,
          salaryDetails: buildSalaryDetails(data, payrollConfig),
          address: buildEmployeeAddress(data, existing.addressRaw, [], attendanceConfig.shifts),
          emergencyContact: buildEmergencyContact(data),
          bankDetails: buildBankDetails(data),
          ...(canAssignCompany && data.companyId ? { companyId: data.companyId } : {}),
        },
      });
      try {
        await recalculatePayslipsFromSettingsApi(undefined, undefined, existing.id);
      } catch {
        /* salary saved; open-month slip refresh is best-effort */
      }
      toast.success('Employee updated successfully');
      navigate(employeeProfilePath(existing));
    } catch (err) {
      toast.error(err.message || 'Update failed');
    }
  };

  const onInvalid = (formErrors) => {
    const firstField = Object.keys(formErrors)[0];
    const stepIdx = STEP_FIELDS.findIndex((fields) => fields.includes(firstField));
    if (stepIdx >= 0) setStep(stepIdx);
    toast.error('Please review the highlighted fields before saving.');
  };
  const submit = handleSubmit(onSubmit, onInvalid);

  const managerOptions = employees
    .filter((e) => e.role === 'manager' || e.role === 'admin' || e.role === 'hr')
    .map((e) => ({ value: e.id, label: `${e.name} · ${e.designation}` }));

  return (
    <>
      <Card className="p-6">
        <Stepper steps={STEPS} current={step} />
      </Card>

      <form onSubmit={handleSubmit(onSubmit, onInvalid)}>
        <Card className="p-6">
          {step === 0 && <PersonalStep register={register} errors={errors} watch={watch} setValue={setValue} />}
          {step === 1 && (
            <JobStep
              register={register}
              errors={errors}
              managerOptions={managerOptions}
              locations={locations}
              employeeIdDisabled
              employeeIdValue={existing.employeeCode || existing.id}
              shiftOptions={shiftOptions}
              companyOptions={companyOptions}
            />
          )}
          {step === 2 && (
            <SalaryStep
              register={register}
              errors={errors}
              watch={watch}
              setValue={setValue}
              payrollConfig={payrollConfig}
            />
          )}
          {step === 3 && <AccessStep register={register} errors={errors} autoEmail={autoEmail} />}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-sm text-fg-muted">Manage this employee&apos;s documents from their profile&apos;s Documents tab.</p>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between pt-5 border-t border-border/60">
            <Button type="button" variant="ghost" onClick={() => (step === 0 ? navigate('/employees') : setStep((s) => s - 1))}>
              {step === 0 ? 'Cancel' : 'Back'}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button key="next" type="button" onClick={next} icon={ArrowRight} className="flex-row-reverse">Next</Button>
            ) : (
              <Button key="submit" type="button" onClick={submit} icon={Check}>Save Changes</Button>
            )}
          </div>
        </Card>
      </form>
    </>
  );
}

export default function EmployeeForm() {
  const navigate = useNavigate();
  const { id: slug } = useParams();
  const editing = Boolean(slug);
  const employeeMap = useEmployeeMap();
  const id = useMemo(() => resolveEmployeeId(slug, employeeMap), [slug, employeeMap]);
  const { data: existing, isLoading } = useEmployee(id);

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
      <button type="button" onClick={() => navigate('/employees')} className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Employees
      </button>

      <div>
        <h1 className="text-page-title text-fg">{editing ? 'Edit Employee' : 'Add Employee'}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {editing ? `Updating ${existing?.name}` : 'Onboard a new team member — personal, job, salary, access & documents'}
        </p>
      </div>

      {editing && isLoading ? (
        <Card className="p-8"><p className="text-sm text-fg-muted">Loading employee…</p></Card>
      ) : editing && !existing ? (
        <Card className="p-8"><p className="text-sm text-fg-muted">Employee not found.</p></Card>
      ) : editing ? (
        <EditEmployeeForm navigate={navigate} existing={existing} />
      ) : (
        <AddEmployeeForm navigate={navigate} />
      )}
    </div>
  );
}
