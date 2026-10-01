const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { GENDERS } = require('../utils/constants');
const { BadRequestError, ConflictError } = require('../utils/errors');
const { isMissingColumnError } = require('../utils/helpers');

/**
 * Personal details an employee fills in themselves.
 *
 * HR/Admin can add someone with just their name, job and salary; whatever
 * personal details they leave blank, the employee is asked for on first
 * sign-in and cannot reach the rest of the app until they are filled in.
 * employees.profile_completed records that (migration 20261003; it
 * defaults to true, so everyone who existed before is never asked).
 *
 * The rules match the Employee form's own validation, so a profile that
 * passes here also passes HR's Edit Employee form later.
 */

const NAME_RE = /^[A-Za-z][A-Za-z\s.'-]*$/;
const BANK_NAME_RE = /^[A-Za-z][A-Za-z\s.'&-]*$/;
const PHONE_RE = /^\d{10}$/;
const PINCODE_RE = /^\d{6}$/;
const ACCOUNT_RE = /^\d{9,18}$/;
const IFSC_RE = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PROFILE_COLUMN = 'profile_completed';

const str = (v) => (v == null ? '' : String(v).trim());
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

const todayISO = () => new Date().toISOString().slice(0, 10);
const validDob = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v)
  && !Number.isNaN(Date.parse(v)) && v >= '1900-01-01' && v <= todayISO();

/** Each required field: where it lives on an employee row, and its rule. */
const FIELDS = [
  { key: 'date_of_birth', label: 'Date of birth', get: (r) => str(r.date_of_birth).slice(0, 10), ok: validDob, bad: 'Date of birth must be a real date, not in the future' },
  { key: 'gender', label: 'Gender', get: (r) => str(r.gender).toLowerCase(), ok: (v) => GENDERS.includes(v), bad: 'Gender must be male, female or other' },
  { key: 'phone', label: 'Phone', get: (r) => str(r.phone), ok: (v) => PHONE_RE.test(v), bad: 'Phone number must be exactly 10 digits' },
  { key: 'personal_email', label: 'Personal email', get: (r) => str(obj(r.address).personal_email).toLowerCase(), ok: (v) => EMAIL_RE.test(v), bad: 'Enter a valid personal email' },
  { key: 'address.line1', label: 'Address line 1', get: (r) => str(obj(r.address).line1), ok: Boolean },
  { key: 'address.line2', label: 'Address line 2', get: (r) => str(obj(r.address).line2), ok: Boolean },
  { key: 'address.city', label: 'City', get: (r) => str(obj(r.address).city), ok: (v) => NAME_RE.test(v), bad: 'City must contain letters only' },
  { key: 'address.state', label: 'State', get: (r) => str(obj(r.address).state), ok: (v) => NAME_RE.test(v), bad: 'State must contain letters only' },
  { key: 'address.pincode', label: 'Pincode', get: (r) => str(obj(r.address).pincode), ok: (v) => PINCODE_RE.test(v), bad: 'Pincode must be exactly 6 digits' },
  { key: 'address.country', label: 'Country', get: (r) => str(obj(r.address).country), ok: (v) => NAME_RE.test(v), bad: 'Country must contain letters only' },
  { key: 'emergency_contact.name', label: 'Emergency contact name', get: (r) => str(obj(r.emergency_contact).name), ok: (v) => NAME_RE.test(v), bad: 'Emergency contact name must contain letters only' },
  { key: 'emergency_contact.phone', label: 'Emergency contact phone', get: (r) => str(obj(r.emergency_contact).phone), ok: (v) => PHONE_RE.test(v), bad: 'Emergency contact phone must be exactly 10 digits' },
  { key: 'emergency_contact.relation', label: 'Relation', get: (r) => str(obj(r.emergency_contact).relation || obj(r.emergency_contact).relationship), ok: (v) => NAME_RE.test(v), bad: 'Relation must contain letters only' },
  { key: 'bank_details.bank_name', label: 'Bank name', get: (r) => str(obj(r.bank_details).bank_name), ok: (v) => BANK_NAME_RE.test(v), bad: 'Bank name must contain letters only' },
  { key: 'bank_details.account_number', label: 'Account number', get: (r) => str(obj(r.bank_details).account_number), ok: (v) => ACCOUNT_RE.test(v), bad: 'Account number must be 9–18 digits' },
  { key: 'bank_details.ifsc', label: 'IFSC code', get: (r) => str(obj(r.bank_details).ifsc || obj(r.bank_details).ifsc_code), ok: (v) => IFSC_RE.test(v), bad: 'Enter a valid IFSC (e.g. HDFC0001234)' },
];

/** What is missing or invalid on an employee-shaped row: [{ field, message }]. */
const profileProblems = (row = {}) => {
  const problems = [];
  for (const f of FIELDS) {
    const value = f.get(row);
    if (!value) problems.push({ field: f.key, message: `${f.label} is required` });
    else if (!f.ok(value)) problems.push({ field: f.key, message: f.bad });
  }
  return problems;
};

const isProfileComplete = (row) => profileProblems(row).length === 0;

/**
 * The employee's submission, normalised and merged onto what is already
 * stored. Address and bank details are merged, never replaced: the address
 * JSON also carries company_id, shift, attendance mode and work location
 * set by HR.
 */
const buildProfileUpdate = (existing, body = {}) => {
  const address = obj(body.address);
  const emergency = obj(body.emergency_contact);
  const bank = obj(body.bank_details);
  const prevEmergency = obj(existing.emergency_contact);
  return {
    date_of_birth: str(body.date_of_birth),
    gender: str(body.gender).toLowerCase(),
    phone: str(body.phone).replace(/\D/g, ''),
    address: {
      ...obj(existing.address),
      line1: str(address.line1),
      line2: str(address.line2),
      city: str(address.city),
      state: str(address.state),
      pincode: str(address.pincode),
      country: str(address.country),
      personal_email: str(body.personal_email).toLowerCase(),
    },
    emergency_contact: {
      ...prevEmergency,
      name: str(emergency.name),
      phone: str(emergency.phone).replace(/\D/g, ''),
      relation: str(emergency.relation),
    },
    bank_details: {
      ...obj(existing.bank_details),
      bank_name: str(bank.bank_name),
      account_number: str(bank.account_number),
      ifsc: str(bank.ifsc).toUpperCase(),
    },
  };
};

/**
 * The employee completes their own profile (first sign-in). Only allowed
 * while it is still incomplete: afterwards changes go through the one-time
 * self-edit or HR, so this cannot become a way round that lock — e.g. to
 * keep changing the bank account salary is paid into.
 */
const completeOwnProfile = async (employeeId, body) => {
  const { data: existing, error } = await supabaseAdmin
    .from('employees')
    .select(`id, address, emergency_contact, bank_details, ${PROFILE_COLUMN}`)
    .eq('id', employeeId)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!existing) throw new BadRequestError('Employee not found');
  if (existing[PROFILE_COLUMN] !== false) throw new ConflictError('Your profile details are already complete.');

  const update = buildProfileUpdate(existing, body);
  const problems = profileProblems(update);
  if (problems.length) {
    const err = new BadRequestError(`Please fix: ${problems.map((p) => p.message).join('; ')}`);
    err.details = problems;
    throw err;
  }

  // Conditional on still-incomplete, so two submissions cannot both apply.
  const { data, error: updateError } = await supabaseAdmin
    .from('employees')
    .update({ ...update, [PROFILE_COLUMN]: true, profile_completed_at: new Date().toISOString() })
    .eq('id', employeeId)
    .eq(PROFILE_COLUMN, false)
    .select('id')
    .maybeSingle();
  if (updateError) throw new BadRequestError(updateError.message);
  if (!data) throw new ConflictError('Your profile details are already complete.');
  return update;
};

/**
 * After HR/Admin edit someone whose profile was still pending: if HR has
 * now filled in everything, the employee is not asked again. Best-effort —
 * never fails the HR save (e.g. before migration 20261003 is applied).
 */
const markCompleteIfFilled = async (employeeId) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('employees')
      .select(`id, date_of_birth, gender, phone, address, emergency_contact, bank_details, ${PROFILE_COLUMN}`)
      .eq('id', employeeId)
      .maybeSingle();
    if (error || !data || data[PROFILE_COLUMN] !== false || !isProfileComplete(data)) return false;
    const { error: updateError } = await supabaseAdmin
      .from('employees')
      .update({ [PROFILE_COLUMN]: true, profile_completed_at: new Date().toISOString() })
      .eq('id', employeeId)
      .eq(PROFILE_COLUMN, false);
    return !updateError;
  } catch (err) {
    logger.warn('[ProfileCompletion] markCompleteIfFilled failed', { employeeId, error: err.message });
    return false;
  }
};

const isMissingProfileColumn = (message) => isMissingColumnError(message, PROFILE_COLUMN)
  || isMissingColumnError(message, 'profile_completed_at');

module.exports = {
  FIELDS,
  profileProblems,
  isProfileComplete,
  buildProfileUpdate,
  completeOwnProfile,
  markCompleteIfFilled,
  isMissingProfileColumn,
  PROFILE_COLUMN,
};
