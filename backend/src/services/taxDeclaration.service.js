/**
 * Employee income-tax declarations (Form 124, formerly 12BB) — report §7.7.
 *  - The employee chooses the regime for the tax year and declares what the
 *    old regime lets them deduct (rent, LTA, 80C-type investments, …), plus
 *    any salary from a previous employer this year and other income.
 *  - HR checks the proofs and records the amounts allowed (after the legal
 *    limits), which go into the employee's payroll tax profile
 *    (salary_details.tax_profile.years[taxYear]) and so into TDS.
 * One declaration per employee per tax year (table tax_declarations, SQL
 * 20261103_tax_declarations.sql). Nothing is sent to anyone.
 */
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const {
  BadRequestError, NotFoundError, ConflictError, ForbiddenError,
} = require('../utils/errors');
const { TIMEZONE } = require('../utils/constants');
const { taxYearOf } = require('../payroll/taxRules');
const { REGIMES } = require('../payroll/tds');

const TABLE = 'tax_declarations';
const MAX_AMOUNT = 1000000000; // ₹100 crore

/** What an employee declares, in rupees for the year. `oldOnly`: counts only under the old regime. */
const DECLARED_FIELDS = [
  { key: 'rent_paid', oldOnly: true },
  { key: 'lta', oldOnly: true },
  { key: 'section_80c', oldOnly: true },
  { key: 'section_80d', oldOnly: true },
  { key: 'nps_extra', oldOnly: true },
  { key: 'home_loan_interest', oldOnly: true },
  { key: 'other_deductions', oldOnly: true },
  { key: 'previous_employer_income' },
  { key: 'previous_employer_tds' },
  { key: 'other_income' },
];

/** What HR allows — the payroll tax profile's own fields (payroll/tds.js PROFILE_AMOUNTS). */
const ALLOWED_FIELDS = [
  'hra_exemption', 'lta_exemption', 'chapter8_deductions', 'other_deductions',
  'previous_employer_income', 'previous_employer_tds', 'other_income',
];

const notSetUp = () => new BadRequestError('Tax declarations need a one-time database update — ask your administrator to run 20261103_tax_declarations.sql.');
const tableMissing = (error) => /tax_declarations/i.test(error?.message || '') && /(does not exist|schema cache)/i.test(error.message);
const check = (error) => {
  if (!error) return;
  if (tableMissing(error)) throw notSetUp();
  throw new BadRequestError(error.message);
};

const currentTaxYear = () => {
  const now = moment.tz(TIMEZONE);
  return taxYearOf(now.month() + 1, now.year());
};
const shiftTaxYear = (ty, by) => {
  const start = Number(ty.slice(0, 4)) + by;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

/** '2026-27' style; `window` limits it to this tax year and the next (employees) or ±1 (HR). */
const checkTaxYear = (value, { allowPrevious = false } = {}) => {
  const ty = String(value || currentTaxYear());
  const m = /^(\d{4})-(\d{2})$/.exec(ty);
  if (!m || Number(m[2]) !== (Number(m[1]) + 1) % 100) throw new BadRequestError('Tax year must look like 2026-27');
  const current = currentTaxYear();
  const ok = [current, shiftTaxYear(current, 1), ...(allowPrevious ? [shiftTaxYear(current, -1)] : [])];
  if (!ok.includes(ty)) throw new BadRequestError(`Declarations are open for ${ok.join(' and ')} only`);
  return ty;
};

/** Rupee amounts from a form: each 0 … ₹100 crore, at most two decimals; unknown keys dropped. */
const cleanAmounts = (input, keys) => {
  if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) {
    throw new BadRequestError('Amounts must be sent as an object');
  }
  const out = {};
  for (const key of keys) {
    const raw = input?.[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
      throw new BadRequestError('Each amount must be between ₹0 and ₹100 crore');
    }
    out[key] = Math.round(n * 100) / 100;
  }
  return out;
};

const cleanNote = (note) => (note == null ? null : String(note).trim().slice(0, 1000) || null);

const toView = (row) => (row ? {
  id: row.id,
  employeeId: row.employee_id,
  taxYear: row.tax_year,
  regime: row.regime,
  declared: row.declared || {},
  allowed: row.allowed || null,
  status: row.status,
  employeeNote: row.employee_note || null,
  hrNote: row.hr_note || null,
  submittedAt: row.submitted_at || null,
  verifiedAt: row.verified_at || null,
  updatedAt: row.updated_at || null,
} : null);

/** An employee's own declaration for a tax year (a blank one if none yet). */
const getMyDeclaration = async (user, taxYear) => {
  const ty = checkTaxYear(taxYear);
  const { data, error } = await supabaseAdmin
    .from(TABLE).select('*').eq('employee_id', user.id).eq('tax_year', ty).maybeSingle();
  check(error);
  if (data) return toView(data);
  return {
    id: null, employeeId: user.id, taxYear: ty, regime: 'new', declared: {}, allowed: null, status: 'none',
  };
};

/**
 * The employee saves their declaration (submit: true sends it to HR). While
 * HR is checking it, it can't be changed.
 */
const saveMyDeclaration = async (user, body = {}) => {
  const ty = checkTaxYear(body.taxYear);
  const regime = body.regime === undefined ? 'new' : body.regime;
  if (!REGIMES.includes(regime)) throw new BadRequestError('Tax regime must be new or old');
  const declared = cleanAmounts(body.declared, DECLARED_FIELDS.map((f) => f.key));
  if (body.declared && typeof body.declared.metro_city === 'boolean') declared.metro_city = body.declared.metro_city;
  const submit = body.submit === true;

  const { data: existing, error } = await supabaseAdmin
    .from(TABLE).select('id, status').eq('employee_id', user.id).eq('tax_year', ty).maybeSingle();
  check(error);
  if (existing?.status === 'submitted') {
    throw new ConflictError('Your declaration is with HR for checking — you can change it once they have reviewed it.');
  }
  const nowIso = new Date().toISOString();
  const fields = {
    regime,
    declared,
    employee_note: cleanNote(body.note),
    status: submit ? 'submitted' : 'draft',
    submitted_at: submit ? nowIso : null,
  };
  const query = existing
    ? supabaseAdmin.from(TABLE).update(fields).eq('id', existing.id).neq('status', 'submitted')
    : supabaseAdmin.from(TABLE).insert({
      ...fields, company_id: user.company_id, employee_id: user.id, tax_year: ty,
    });
  const { data, error: saveErr } = await query.select('*').maybeSingle();
  check(saveErr);
  if (!data) throw new ConflictError('Your declaration was sent to HR meanwhile — reload to see it.');
  return toView(data);
};

/** HR: the company's declarations for a tax year, newest first, with names. */
const listDeclarations = async (companyId, { taxYear, status } = {}) => {
  if (!companyId) throw new BadRequestError('companyId is required');
  const ty = checkTaxYear(taxYear, { allowPrevious: true });
  let query = supabaseAdmin
    .from(TABLE)
    .select('*, employee:employee_id(id, first_name, last_name, employee_code, date_of_joining, salary_details)')
    .eq('company_id', companyId)
    .eq('tax_year', ty)
    .order('updated_at', { ascending: false });
  if (status) {
    if (!['draft', 'submitted', 'verified', 'returned'].includes(status)) throw new BadRequestError('Unknown status');
    query = query.eq('status', status);
  }
  const { data, error } = await query;
  check(error);
  return (data || []).map((row) => {
    // What is already recorded for that year (the review starts from it).
    const year = row.employee?.salary_details?.tax_profile?.years?.[row.tax_year] || {};
    return {
      ...toView(row),
      employeeName: `${row.employee?.first_name || ''} ${row.employee?.last_name || ''}`.trim() || row.employee?.employee_code || 'Employee',
      employeeCode: row.employee?.employee_code || '',
      recorded: Object.fromEntries(ALLOWED_FIELDS.map((k) => [k, Number(year[k]) || 0])),
    };
  });
};

const loadForReview = async (id, companyId, actor) => {
  const { data: row, error } = await supabaseAdmin.from(TABLE).select('*').eq('id', id).maybeSingle();
  check(error);
  if (!row || String(row.company_id) !== String(companyId)) throw new NotFoundError('Declaration not found');
  if (String(row.employee_id) === String(actor?.id)) {
    throw new ForbiddenError('You cannot review your own tax declaration — another HR person or an admin has to.');
  }
  if (row.status !== 'submitted') throw new ConflictError('Only a declaration sent for checking can be reviewed');
  return row;
};

/**
 * HR accepts a declaration with the amounts allowed. They go into the
 * employee's tax profile for that year, and the employee's open draft
 * payslips are recalculated (drafts only; nothing is sent).
 */
const verifyDeclaration = async ({
  id, companyId, actor, allowed, regime, note, ipAddress = null,
}) => {
  const row = await loadForReview(id, companyId, actor);
  const finalRegime = regime === undefined ? row.regime : regime;
  if (!REGIMES.includes(finalRegime)) throw new BadRequestError('Tax regime must be new or old');
  const amounts = cleanAmounts(allowed || {}, ALLOWED_FIELDS);

  const { data: employee, error: empErr } = await supabaseAdmin
    .from('employees').select('id, company_id, salary_details').eq('id', row.employee_id).maybeSingle();
  if (empErr) throw new BadRequestError(empErr.message);
  if (!employee) throw new NotFoundError('Employee not found');
  const sd = employee.salary_details || {};
  const profile = sd.tax_profile && typeof sd.tax_profile === 'object' ? sd.tax_profile : {};
  const years = profile.years && typeof profile.years === 'object' ? profile.years : {};
  const nextYear = { ...(years[row.tax_year] || {}), regime: finalRegime };
  // Only what HR sent changes (an explicit 0 clears); anything else already
  // recorded — e.g. a previous employer's salary entered on the Payroll
  // setup card — stays.
  for (const key of ALLOWED_FIELDS) if (key in amounts) nextYear[key] = amounts[key];
  const nowIso = new Date().toISOString();
  const nextSalary = {
    ...sd,
    tax_profile: {
      ...profile,
      years: { ...years, [row.tax_year]: nextYear },
      updated_at: nowIso,
      updated_by: actor?.id || null,
    },
  };
  const { error: saveErr } = await supabaseAdmin
    .from('employees').update({ salary_details: nextSalary, updated_at: nowIso }).eq('id', employee.id);
  if (saveErr) throw new BadRequestError(saveErr.message);

  const { data: updated, error: decErr } = await supabaseAdmin
    .from(TABLE)
    .update({
      status: 'verified', regime: finalRegime, allowed: amounts, hr_note: cleanNote(note), verified_at: nowIso, verified_by: actor?.id || null,
    })
    .eq('id', row.id)
    .eq('status', 'submitted')
    .select('*')
    .maybeSingle();
  check(decErr);

  require('./auditLog.service').logAudit({
    companyId,
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    actionType: 'payroll.tax_declaration.verify',
    targetType: 'employee',
    targetId: row.employee_id,
    beforeState: years[row.tax_year] || null,
    afterState: { tax_year: row.tax_year, ...nextYear },
    ipAddress,
  }).catch(() => {});
  require('../utils/background').runInBackground('drafts after a tax declaration', () => require('./payroll.service')
    .recalculatePayslipsFromSettings({ employeeId: row.employee_id, companyId }));

  return toView(updated || { ...row, status: 'verified' });
};

/** HR sends a declaration back to the employee with a note saying what to fix. */
const returnDeclaration = async ({
  id, companyId, actor, note, ipAddress = null,
}) => {
  const row = await loadForReview(id, companyId, actor);
  const text = cleanNote(note);
  if (!text) throw new BadRequestError('Say what the employee should change');
  const { data: updated, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'returned', hr_note: text })
    .eq('id', row.id)
    .eq('status', 'submitted')
    .select('*')
    .maybeSingle();
  check(error);
  require('./auditLog.service').logAudit({
    companyId,
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    actionType: 'payroll.tax_declaration.return',
    targetType: 'employee',
    targetId: row.employee_id,
    afterState: { tax_year: row.tax_year, note: text },
    ipAddress,
  }).catch(() => {});
  return toView(updated || { ...row, status: 'returned', hr_note: text });
};

module.exports = {
  DECLARED_FIELDS,
  ALLOWED_FIELDS,
  getMyDeclaration,
  saveMyDeclaration,
  listDeclarations,
  verifyDeclaration,
  returnDeclaration,
};
