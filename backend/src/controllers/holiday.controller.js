const { supabaseAdmin } = require('../config/supabase');
const { successResponse } = require('../utils/helpers');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const moment = require('moment-timezone');
const { TIMEZONE } = require('../utils/constants');
const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');

const companyIdOf = (req) => req.user.company_id || getCompanyId(req.user) || DEFAULT_COMPANY_ID;

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
      .insert({ ...req.body, created_by: req.user.id, company_id: companyId })
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
      .update(req.body)
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);
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

module.exports = { create, byYear, update, remove, upcoming };
