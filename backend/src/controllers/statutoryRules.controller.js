const { successResponse } = require('../utils/helpers');
const { listStatutoryRules } = require('../services/statutoryRules.service');

/** The statutory values payroll uses, with sources and effective dates (read-only). */
const list = async (req, res, next) => {
  try {
    successResponse(res, 'Statutory rules', listStatutoryRules());
  } catch (err) { next(err); }
};

module.exports = { list };
