const { supabaseAdmin } = require('../config/supabase');
const { successResponse } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const moment = require('moment-timezone');
const { TIMEZONE } = require('../utils/constants');
const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');

const filterHolidaysForCompany = async (rows, companyId) => {
  const cid = companyId || DEFAULT_COMPANY_ID;
  const creatorIds = [...new Set((rows || []).map((h) => h.created_by).filter(Boolean))];
  if (!creatorIds.length) {
    // Legacy holidays with no creator belong only to the default company
    return cid === DEFAULT_COMPANY_ID ? (rows || []) : [];
  }

  const { data: creators } = await supabaseAdmin
    .from('employees')
    .select('id, address')
    .in('id', creatorIds);

  const allowed = new Set(
    (creators || [])
      .filter((e) => getCompanyId(e) === cid)
      .map((e) => e.id)
  );

  return (rows || []).filter((h) => {
    if (!h.created_by) return cid === DEFAULT_COMPANY_ID;
    return allowed.has(h.created_by);
  });
};

const assertHolidayCompany = async (holidayId, companyId) => {
  const { data } = await supabaseAdmin.from('holidays').select('*').eq('id', holidayId).maybeSingle();
  if (!data) throw new NotFoundError('Holiday not found');
  const filtered = await filterHolidaysForCompany([data], companyId);
  if (!filtered.length) throw new ForbiddenError('Not authorized for this holiday');
  return data;
};

const create = async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('holidays')
      .insert({ ...req.body, created_by: req.user.id })
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Holiday created', data, null, 201);
  } catch (err) { next(err); }
};

const byYear = async (req, res, next) => {
  try {
    const year = parseInt(req.params.year, 10);
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const companyId = req.user.company_id || getCompanyId(req.user);

    const { data, error } = await supabaseAdmin
      .from('holidays')
      .select('*')
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true });

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Holidays fetched', await filterHolidaysForCompany(data, companyId));
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const companyId = req.user.company_id || getCompanyId(req.user);
    await assertHolidayCompany(req.params.id, companyId);

    const { data, error } = await supabaseAdmin
      .from('holidays')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Holiday updated', data);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const companyId = req.user.company_id || getCompanyId(req.user);
    await assertHolidayCompany(req.params.id, companyId);
    await supabaseAdmin.from('holidays').delete().eq('id', req.params.id);
    successResponse(res, 'Holiday deleted');
  } catch (err) { next(err); }
};

const upcoming = async (req, res, next) => {
  try {
    const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    const companyId = req.user.company_id || getCompanyId(req.user);
    const { data, error } = await supabaseAdmin
      .from('holidays')
      .select('*')
      .gte('date', today)
      .order('date', { ascending: true })
      .limit(40);

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Upcoming holidays fetched', (await filterHolidaysForCompany(data, companyId)).slice(0, 10));
  } catch (err) { next(err); }
};

module.exports = { create, byYear, update, remove, upcoming };
