/**
 * PAYROLL CALCULATION SETTINGS
 * ----------------------------
 * Change values here to adjust payroll math across the entire system.
 * Used by: backend/src/services/payroll.service.js
 */
module.exports = {
  COMPANY_NAME: process.env.COMPANY_NAME || 'HRMS Company Pvt Ltd',

  // Working days used for LOP (Loss of Pay) calculation
  WORKING_DAYS_PER_MONTH: 23,

  // Deduction rates / fixed amounts
  PF_RATE: 0.12, // PF = basic * PF_RATE
  PROFESSIONAL_TAX: 200, // Fixed PT deduction (₹)

  // Payslip workflow statuses
  MONTH_STATUS: {
    PENDING: 'PENDING',
    COMPLETED: 'COMPLETED',
  },
  PAYSLIP_STATUS: {
    DRAFT: 'DRAFT',
    PUBLISHED: 'PUBLISHED',
  },
};
