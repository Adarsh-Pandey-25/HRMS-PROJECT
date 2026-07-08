const payrollService = require('../services/payroll.service');
const { successResponse } = require('../utils/helpers');
const moment = require('moment-timezone');
const { TIMEZONE } = require('../utils/constants');

const generate = async (req, res, next) => {
  try {
    const { month, year, employee_ids } = req.body;
    const results = await payrollService.generatePayroll(month, year, employee_ids);
    successResponse(res, 'Payroll generation completed', results, null, 201);
  } catch (err) { next(err); }
};

const myPayslips = async (req, res, next) => {
  try {
    const result = await payrollService.getPayslips({ employee_id: req.user.id }, req.query);
    successResponse(res, 'Payslips fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const employeePayslips = async (req, res, next) => {
  try {
    const result = await payrollService.getPayslips({ employee_id: req.params.employeeId }, req.query);
    successResponse(res, 'Employee payslips fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const downloadPayslip = async (req, res, next) => {
  try {
    const isOwn = req.user.role === 'employee' || req.user.role === 'manager';
    const result = await payrollService.getPayslipDownload(
      req.params.id,
      isOwn ? req.user.id : null
    );

    if (result.url) {
      return successResponse(res, 'Download URL generated', { url: result.url, payroll: result.payroll });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=payslip-${result.payroll.month}-${result.payroll.year}.pdf`);
    res.send(result.buffer);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const payroll = await payrollService.updatePayroll(req.params.id, req.body);
    successResponse(res, 'Payroll updated', payroll);
  } catch (err) { next(err); }
};

const monthlyReport = async (req, res, next) => {
  try {
    const month = parseInt(req.query.month, 10) || moment().tz(TIMEZONE).month() + 1;
    const year = parseInt(req.query.year, 10) || moment().tz(TIMEZONE).year();
    const report = await payrollService.getMonthlyReport(month, year);
    successResponse(res, 'Monthly payroll report fetched', report);
  } catch (err) { next(err); }
};

module.exports = {
  generate, myPayslips, employeePayslips, downloadPayslip, update, monthlyReport,
};
