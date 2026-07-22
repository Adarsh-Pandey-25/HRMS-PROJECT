const { body, param, query } = require('express-validator');
const {
  ROLES, LEAVE_TYPES, CHECK_IN_METHODS, REIMBURSEMENT_TYPES,
  DOCUMENT_TYPES, TRAINING_MODES, ANNOUNCEMENT_PRIORITY,
  ANNOUNCEMENT_AUDIENCE, HOLIDAY_TYPES, EMPLOYMENT_TYPES, GENDERS,
} = require('./constants');

const registerRules = [
  body('email').isEmail().normalizeEmail(),
  body('password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('first_name').trim().notEmpty(),
  body('last_name').trim().notEmpty(),
  body('role').isIn(Object.values(ROLES)),
  body('employee_code').optional().trim(),
  body('department').optional().trim(),
  body('designation').optional().trim(),
  body('manager_id').optional().isUUID(),
  body('date_of_joining').optional().isISO8601(),
  body('employment_type').optional().isIn(EMPLOYMENT_TYPES),
];

const loginRules = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
];

const bootstrapRules = [
  body('email').isEmail().normalizeEmail(),
  body('password').optional().isLength({ min: 8, max: 128 }),
  body('admin_name').trim().isLength({ min: 2, max: 200 }),
  body('company_profile').isObject(),
  body('company_profile.name').trim().isLength({ min: 2, max: 200 }),
  body('verificationToken').optional().isString().isLength({ min: 16, max: 128 }),
  body('verification_token').optional().isString().isLength({ min: 16, max: 128 }),
];

const onboardingSendOtpRules = [
  body('email').isEmail().normalizeEmail(),
  body('adminName').optional().trim().isLength({ max: 200 }),
  body('admin_name').optional().trim().isLength({ max: 200 }),
];

const onboardingVerifyOtpRules = [
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min: 4, max: 10 }).withMessage('OTP is required'),
];

const changePasswordRules = [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 1 }).withMessage('Password is required'),
];

const forgotPasswordRules = [body('email').isEmail().normalizeEmail()];

// OTP-based password reset:
// 1) POST /auth/forgot-password -> sends OTP to email
// 2) POST /auth/reset-password -> { email, otp, newPassword }
const resetPasswordRules = [
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min: 4, max: 10 }).withMessage('OTP is required'),
  body('newPassword').isLength({ min: 1 }).withMessage('Password is required'),
];

const employeeCreateRules = [
  body('email').isEmail().normalizeEmail(),
  body('first_name').trim().notEmpty(),
  body('last_name').trim().notEmpty(),
  body('role').isIn(Object.values(ROLES)),
  body('phone').optional().trim(),
  body('date_of_birth').optional().isISO8601(),
  body('gender').optional().isIn(GENDERS),
  body('department').optional().trim(),
  body('designation').optional().trim(),
  body('manager_id').optional().isUUID(),
  body('date_of_joining').optional().isISO8601(),
  body('employment_type').optional().isIn(EMPLOYMENT_TYPES),
  body('salary_details').optional().isObject(),
  body('bank_details').optional().isObject(),
  body('emergency_contact').optional().isObject(),
];

const checkInRules = [
  body('method').isIn(CHECK_IN_METHODS),
  body('device_id').optional().trim(),
  body('location').optional().isObject(),
  body('is_wfh').optional().isBoolean(),
];

const leaveApplyRules = [
  // Leave types are now admin-configurable; validate existence in service layer
  body('leave_type').isString().trim().notEmpty(),
  body('from_date').isISO8601(),
  body('to_date').isISO8601(),
  body('is_half_day').optional().isBoolean(),
  body('reason').trim().notEmpty(),
];

const reimbursementRules = [
  body('reimbursement_type').isIn(REIMBURSEMENT_TYPES),
  body('amount').isFloat({ min: 0.01 }),
  body('description').trim().notEmpty(),
  body('expense_date').isISO8601(),
  body('category_name').optional().trim(),
];

const trainingCreateRules = [
  body('title').trim().notEmpty(),
  body('description').optional().trim(),
  body('trainer_name').optional().trim(),
  body('training_mode').isIn(TRAINING_MODES),
  body('start_date').isISO8601(),
  body('end_date').isISO8601(),
  body('duration_hours').optional().isInt({ min: 1 }),
  body('location').optional().trim(),
];

const announcementRules = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('content').custom((v) => {
    const text = String(v || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (!text) throw new Error('Body is required');
    return true;
  }),
  body('priority')
    .customSanitizer((v) => {
      const aliases = { normal: 'medium', important: 'high' };
      return aliases[v] || v || 'medium';
    })
    .isIn(ANNOUNCEMENT_PRIORITY),
  body('target_audience')
    .customSanitizer((v, { req }) => v || req.body.audience || 'all')
    .isIn(ANNOUNCEMENT_AUDIENCE),
  body('is_active').optional(),
  body('expires_at').optional({ values: 'falsy' }).isISO8601(),
  body('department').optional().trim(),
];

const holidayRules = [
  body('title').trim().notEmpty(),
  body('date').isISO8601(),
  body('type').isIn(HOLIDAY_TYPES),
  body('description').optional().trim(),
  body('is_mandatory').optional().isBoolean(),
];

const documentUploadRules = [
  body('document_type').isIn(DOCUMENT_TYPES),
  body('document_name').trim().notEmpty(),
  body('expires_at').optional().isISO8601(),
];

const payrollMonthRules = [
  body('month').isInt({ min: 1, max: 12 }),
  body('year').isInt({ min: 2020 }),
];

const payrollMonthQueryRules = [
  query('month').isInt({ min: 1, max: 12 }),
  query('year').isInt({ min: 2020 }),
];

const payrollGeneratePayslipRules = [
  body('payroll_month_id').isUUID(),
  body('user_id').optional().isUUID(),
];

const payrollListQueryRules = [
  query('month').isInt({ min: 1, max: 12 }),
  query('year').isInt({ min: 2020 }),
  // Contract: no scope param (keep endpoint strict to month/year only)
];

const courseCreateRules = [
  body('title').trim().notEmpty(),
  body('description').optional().trim(),
];

const courseChapterRules = [
  body('title').trim().notEmpty(),
  body('order').isInt({ min: 1 }),
];

const courseLessonRules = [
  body('title').trim().notEmpty(),
  body('order').optional().isInt({ min: 1 }),
  body('lesson_order').optional().isInt({ min: 1 }),
  body('type').isIn(['VIDEO_UPLOAD', 'EXTERNAL_LINK']),
  body('externalLink').optional().trim(),
  body('external_link').optional().trim(),
  body('videoDuration').optional().isFloat({ min: 0.1 }),
  body('video_duration').optional().isFloat({ min: 0.1 }),
];

const lessonProgressRules = [
  body('watchedSeconds').optional({ nullable: true }).isFloat({ min: 0 }),
  body('watched_seconds').optional({ nullable: true }).isFloat({ min: 0 }),
  body().custom((_, { req }) => {
    const v = req.body?.watchedSeconds ?? req.body?.watched_seconds;
    if (v === undefined || v === null || v === '') {
      throw new Error('watchedSeconds is required');
    }
    return true;
  }),
];

const uuidParam = (name = 'id') => [param(name).isUUID()];

const employeeRefParam = (name = 'id') => [
  param(name).trim().notEmpty().isLength({ min: 1, max: 64 }),
];

const paginationQuery = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 500 }),
];

module.exports = {
  registerRules,
  loginRules,
  bootstrapRules,
  onboardingSendOtpRules,
  onboardingVerifyOtpRules,
  changePasswordRules,
  forgotPasswordRules,
  resetPasswordRules,
  employeeCreateRules,
  checkInRules,
  leaveApplyRules,
  reimbursementRules,
  trainingCreateRules,
  courseCreateRules,
  courseChapterRules,
  courseLessonRules,
  lessonProgressRules,
  announcementRules,
  holidayRules,
  documentUploadRules,
  payrollMonthRules,
  payrollMonthQueryRules,
  payrollGeneratePayslipRules,
  payrollListQueryRules,
  uuidParam,
  employeeRefParam,
  paginationQuery,
};
