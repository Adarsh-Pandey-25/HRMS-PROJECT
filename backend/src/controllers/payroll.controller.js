const payrollService = require('../services/payroll.service');
const { successResponse } = require('../utils/helpers');

const initializeMonth = async (req, res, next) => {
  try {
    const { month, year } = req.body;
    const data = await payrollService.initializeMonth(month, year, req.user.id);
    successResponse(res, 'Payroll month initialized', data, null, 201);
  } catch (err) { next(err); }
};

const getMonthStatus = async (req, res, next) => {
  try {
    const month = parseInt(req.query.month, 10);
    const year = parseInt(req.query.year, 10);
    const data = await payrollService.getMonthStatus(month, year);
    successResponse(res, 'Payroll month fetched', data);
  } catch (err) { next(err); }
};

const generatePayslip = async (req, res, next) => {
  try {
    const { payroll_month_id, user_id } = req.body;
    const data = user_id
      ? await payrollService.generateDraftPayslip(payroll_month_id, user_id)
      : await payrollService.generateAllDraftPayslips(payroll_month_id);
    successResponse(res, user_id ? 'Draft payslip generated' : 'Draft payslips generated', data, null, 201);
  } catch (err) { next(err); }
};

const publishPayslip = async (req, res, next) => {
  try {
    const data = await payrollService.publishPayslip(req.params.id, req.user.id);
    successResponse(res, 'Payslip published', data);
  } catch (err) { next(err); }
};

const listPayslips = async (req, res, next) => {
  try {
    const month = parseInt(req.query.month, 10);
    const year = parseInt(req.query.year, 10);
    const data = await payrollService.listPayslips({
      month,
      year,
      user: req.user,
      role: req.user.role,
    });
    successResponse(res, 'Payslips fetched', data);
  } catch (err) { next(err); }
};

const downloadPayslip = async (req, res, next) => {
  try {
    const { redirectUrl } = await payrollService.downloadPayslip(req.params.id, req.user);
    return res.redirect(302, redirectUrl);
  } catch (err) { next(err); }
};

module.exports = {
  initializeMonth,
  getMonthStatus,
  generatePayslip,
  publishPayslip,
  listPayslips,
  downloadPayslip,
};
