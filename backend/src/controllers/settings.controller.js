const settingsService = require('../services/settings.service');
const { supabaseAdmin } = require('../config/supabase');
const { successResponse } = require('../utils/helpers');
const { BadRequestError, NotFoundError } = require('../utils/errors');

const getAll = async (req, res, next) => {
  try {
    await settingsService.ensureCache(true);
    const { data, error } = await supabaseAdmin
      .from('system_settings')
      .select('key,value,updated_at,updated_by')
      .order('key', { ascending: true });

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'System settings fetched', data);
  } catch (err) {
    next(err);
  }
};

const getByKey = async (req, res, next) => {
  try {
    const key = req.params.key;
    const { data, error } = await supabaseAdmin
      .from('system_settings')
      .select('key,value,updated_at,updated_by')
      .eq('key', key)
      .single();

    if (error || !data) throw new NotFoundError('Setting not found');
    successResponse(res, 'Setting fetched', data);
  } catch (err) {
    next(err);
  }
};

const updateKey = async (req, res, next) => {
  try {
    const key = req.params.key;
    if (typeof req.body.value === 'undefined') {
      throw new BadRequestError('value is required');
    }

    const { data, error } = await settingsService.setSetting(key, req.body.value, req.user.id);
    if (error) throw new BadRequestError(error.message);

    successResponse(res, 'Setting updated', data);
  } catch (err) {
    next(err);
  }
};

module.exports = { getAll, getByKey, updateKey };

