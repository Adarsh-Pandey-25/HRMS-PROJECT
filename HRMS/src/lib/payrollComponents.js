/** Default active salary components (matches settings store). */
export const DEFAULT_SALARY_COMPONENTS = {
  hra: true,
  da: true,
  special: true,
  transport: false,
  medical: false,
};

export function resolveSalaryComponents(components) {
  return { ...DEFAULT_SALARY_COMPONENTS, ...(components || {}) };
}

/** HRA, DA, Special default on unless explicitly false; transport/medical default off. */
export function isSalaryComponentEnabled(components, key) {
  const c = resolveSalaryComponents(components);
  if (key === 'transport' || key === 'medical') return Boolean(c[key]);
  return c[key] !== false;
}

/** Form / validation fields for the salary step. */
export function salaryStepFields(components) {
  const fields = ['basic', 'salaryPeriod', 'pfApplicable', 'ptApplicable', 'tdsMode'];
  if (isSalaryComponentEnabled(components, 'hra')) fields.push('hra');
  if (isSalaryComponentEnabled(components, 'da')) fields.push('da');
  if (isSalaryComponentEnabled(components, 'special')) fields.push('special');
  if (isSalaryComponentEnabled(components, 'transport')) fields.push('transport');
  if (isSalaryComponentEnabled(components, 'medical')) fields.push('medical');
  return fields;
}

/** Zero-out disabled components before save. */
export function normalizeSalaryByComponents(data, components) {
  return {
    ...data,
    hra: isSalaryComponentEnabled(components, 'hra') ? Number(data.hra || 0) : 0,
    da: isSalaryComponentEnabled(components, 'da') ? Number(data.da || 0) : 0,
    special: isSalaryComponentEnabled(components, 'special') ? Number(data.special || 0) : 0,
    transport: isSalaryComponentEnabled(components, 'transport') ? Number(data.transport || 0) : 0,
    medical: isSalaryComponentEnabled(components, 'medical') ? Number(data.medical || 0) : 0,
  };
}

export function suggestPercentOfBasic(basic, percent) {
  const b = Number(basic || 0);
  const p = Number(percent || 0);
  if (!b || !p) return 0;
  return Math.round(b * (p / 100));
}
