const { supabaseAdmin } = require('../config/supabase');
const { successResponse } = require('../utils/helpers');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const moment = require('moment-timezone');
const { TIMEZONE } = require('../utils/constants');

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

    const { data, error } = await supabaseAdmin
      .from('holidays')
      .select('*')
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true });

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Holidays fetched', data);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
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
    await supabaseAdmin.from('holidays').delete().eq('id', req.params.id);
    successResponse(res, 'Holiday deleted');
  } catch (err) { next(err); }
};

const upcoming = async (req, res, next) => {
  try {
    const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    const { data, error } = await supabaseAdmin
      .from('holidays')
      .select('*')
      .gte('date', today)
      .order('date', { ascending: true })
      .limit(10);

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Upcoming holidays fetched', data);
  } catch (err) { next(err); }
};

module.exports = { create, byYear, update, remove, upcoming };
