const { supabaseAdmin } = require('../config/supabase');
const { successResponse } = require('../utils/helpers');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const moment = require('moment-timezone');
const { TIMEZONE } = require('../utils/constants');
const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');
const { auditFromRequest } = require('../services/auditLog.service');
const logger = require('../utils/logger');

const companyIdOf = (req) => req.user.company_id || getCompanyId(req.user) || DEFAULT_COMPANY_ID;

/** Fields a caller may set on a holiday — never spread req.body into a Supabase write. */
const HOLIDAY_WRITABLE_FIELDS = ['title', 'date', 'type', 'description', 'is_mandatory'];

const pickHolidayFields = (body = {}) => {
  const fields = {};
  for (const key of HOLIDAY_WRITABLE_FIELDS) {
    if (body[key] !== undefined) fields[key] = body[key];
  }
  return fields;
};

const assertHolidayCompany = async (holidayId, companyId) => {
  const cid = companyId || DEFAULT_COMPANY_ID;
  const { data } = await supabaseAdmin
    .from('holidays')
    .select('*')
    .eq('id', holidayId)
    .eq('company_id', cid)
    .maybeSingle();
  if (!data) throw new NotFoundError('Holiday not found');
  return data;
};

const create = async (req, res, next) => {
  try {
    const companyId = companyIdOf(req);
    const { data, error } = await supabaseAdmin
      .from('holidays')
      .insert({ ...pickHolidayFields(req.body), created_by: req.user.id, company_id: companyId })
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);
        auditFromRequest(req, {
      actionType: 'holiday.create', targetType: 'holiday', targetId: data?.id,
      afterState: { name: data?.name, date: data?.date, type: data?.type },
    });
    successResponse(res, 'Holiday created', data, null, 201);
  } catch (err) { next(err); }
};

const byYear = async (req, res, next) => {
  try {
    const year = parseInt(req.params.year, 10);
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const companyId = companyIdOf(req);

    const { data, error } = await supabaseAdmin
      .from('holidays')
      .select('*')
      .eq('company_id', companyId)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true });

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Holidays fetched', data || []);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const companyId = companyIdOf(req);
    await assertHolidayCompany(req.params.id, companyId);

    const { data, error } = await supabaseAdmin
      .from('holidays')
      .update(pickHolidayFields(req.body))
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);
        auditFromRequest(req, {
      actionType: 'holiday.update', targetType: 'holiday', targetId: req.params.id,
      afterState: { name: data?.name, date: data?.date, type: data?.type },
    });
    successResponse(res, 'Holiday updated', data);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const companyId = companyIdOf(req);
    await assertHolidayCompany(req.params.id, companyId);
    await supabaseAdmin
      .from('holidays')
      .delete()
      .eq('id', req.params.id)
      .eq('company_id', companyId);
        auditFromRequest(req, {
      actionType: 'holiday.delete', targetType: 'holiday', targetId: req.params.id,
    });
    successResponse(res, 'Holiday deleted');
  } catch (err) { next(err); }
};

const upcoming = async (req, res, next) => {
  try {
    const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    const companyId = companyIdOf(req);
    const { data, error } = await supabaseAdmin
      .from('holidays')
      .select('*')
      .eq('company_id', companyId)
      .gte('date', today)
      .order('date', { ascending: true })
      .limit(10);

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Upcoming holidays fetched', data || []);
  } catch (err) { next(err); }
};

const { HOLIDAY_TYPES } = require('../utils/constants');
const MAX_BULK_HOLIDAYS = 200;

/** One imported row → a clean holiday, or the reason it is not one. */
const normalizeImportedHoliday = (raw = {}) => {
  const title = String(raw.title ?? raw.name ?? '').trim();
  const date = String(raw.date ?? '').trim().slice(0, 10);
  const type = String(raw.type || 'public').trim().toLowerCase();
  if (!title) return { error: 'Holiday name is missing' };
  if (title.length > 255) return { error: 'Holiday name is too long' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !moment(date, 'YYYY-MM-DD', true).isValid()) return { error: `"${raw.date ?? ''}" is not a valid date` };
  if (!HOLIDAY_TYPES.includes(type)) return { error: `Type must be one of: ${HOLIDAY_TYPES.join(', ')}` };
  const description = String(raw.description ?? '').trim();
  return {
    holiday: {
      title, date, type, is_mandatory: type !== 'optional',
      ...(description ? { description: description.slice(0, 1000) } : {}),
    },
  };
};

/**
 * Bulk import a holiday list. Rows that already exist (same date and name)
 * are skipped, so importing the same file twice adds nothing. With notify
 * on, every active employee gets ONE email listing all the new holidays —
 * not one email per holiday — and one in-app notice.
 */
const bulkCreate = async (req, res, next) => {
  try {
    const companyId = companyIdOf(req);
    const input = Array.isArray(req.body?.holidays) ? req.body.holidays : [];
    if (!input.length) throw new BadRequestError('No holidays to import');
    if (input.length > MAX_BULK_HOLIDAYS) throw new BadRequestError(`Import at most ${MAX_BULK_HOLIDAYS} holidays at a time`);

    const problems = [];
    const clean = [];
    const seen = new Set();
    input.forEach((raw, i) => {
      const { holiday, error } = normalizeImportedHoliday(raw);
      if (error) { problems.push(`Row ${i + 1}: ${error}`); return; }
      const key = `${holiday.date}|${holiday.title.toLowerCase()}`;
      if (seen.has(key)) return; // the same holiday twice in one file
      seen.add(key);
      clean.push(holiday);
    });
    if (problems.length) throw new BadRequestError(`Nothing imported — fix these rows: ${problems.slice(0, 10).join('; ')}${problems.length > 10 ? ` (and ${problems.length - 10} more)` : ''}`);

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('holidays')
      .select('date, title')
      .eq('company_id', companyId)
      .in('date', [...new Set(clean.map((h) => h.date))]);
    if (existingError) throw new BadRequestError(existingError.message);
    const existingKeys = new Set((existing || []).map((h) => `${String(h.date).slice(0, 10)}|${String(h.title || '').trim().toLowerCase()}`));
    const toInsert = clean.filter((h) => !existingKeys.has(`${h.date}|${h.title.toLowerCase()}`));
    const skipped = clean.filter((h) => existingKeys.has(`${h.date}|${h.title.toLowerCase()}`));

    let created = [];
    if (toInsert.length) {
      const { data, error } = await supabaseAdmin
        .from('holidays')
        .insert(toInsert.map((h) => ({ ...h, created_by: req.user.id, company_id: companyId })))
        .select();
      if (error) throw new BadRequestError(error.message);
      created = data || [];
    }

    const notify = req.body?.notify !== false && req.body?.notify !== 'false';
    let recipients = 0;
    if (notify && created.length) {
      const { data: employees, error: empError } = await supabaseAdmin
        .from('employees')
        .select('id, email, first_name, company_id, role')
        .eq('company_id', companyId)
        .eq('is_active', true);
      if (empError) throw new BadRequestError(empError.message);
      const people = (employees || []).filter((e) => e.email);
      recipients = people.length;

      const notificationService = require('../services/notification.service');
      await notificationService.createNotifications((employees || []).map((e) => ({
        user_id: e.id,
        type: 'HOLIDAY',
        title: 'Holiday list updated',
        message: `${created.length} holiday${created.length === 1 ? '' : 's'} added to the calendar.`,
        link: '/leave/holidays',
        meta: { holiday_ids: created.map((h) => h.id) },
        skipEmail: true, // the list email below is the email
      }))).catch((err) => logger.warn('[Holidays] in-app notice failed', { error: err.message }));

      const settingsService = require('../services/settings.service');
      const profile = await settingsService.getSetting('company_profile', {}, companyId);
      const companyName = profile?.name || req.tenantCompany?.name || '';
      const { holidayListEmail } = require('../services/email.service');
      const { forEachWithLimit } = require('../utils/concurrency');
      // In the background, two at a time — see config/email.js.
      forEachWithLimit(people, 2, (emp) => holidayListEmail(emp, created, { companyName }),
        (err, emp) => logger.error('[Holidays] list email failed', { employeeId: emp.id, error: err.message }))
        .catch(() => {});
    }

    successResponse(res, `${created.length} holiday${created.length === 1 ? '' : 's'} imported`, {
      created: created.length,
      skipped: skipped.map((h) => ({ date: h.date, title: h.title })),
      emailed: recipients,
      holidays: created,
    }, null, 201);
  } catch (err) { next(err); }
};

module.exports = { create, bulkCreate, byYear, update, remove, upcoming };
