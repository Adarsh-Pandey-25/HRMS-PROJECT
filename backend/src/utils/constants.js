const moment = require('moment-timezone');
const config = require('../config/database');

const TIMEZONE = config.timezone;

const ROLES = {
  HR: 'hr',
  ADMIN: 'admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
};

const LEAVE_TYPES = [
  'CL', 'SL', 'EL', 'WFH', 'COMP_OFF',
  'MATERNITY', 'PATERNITY', 'UNPAID',
];

const LEAVE_STATUS = ['pending', 'approved', 'rejected', 'cancelled'];

const ATTENDANCE_STATUS = ['present', 'absent', 'half_day', 'late', 'early_departure'];

const CHECK_IN_METHODS = ['office_ip', 'web', 'mobile', 'biometric'];

const REIMBURSEMENT_TYPES = [
  'travel', 'food', 'medical', 'internet_phone',
  'office_supplies', 'client_entertainment', 'other',
];

const DOCUMENT_TYPES = [
  'offer_letter', 'joining_letter', 'aadhar', 'pan',
  'educational_certificate', 'experience_letter', 'payslip',
  'form_16', 'resignation_letter', 'relieving_letter',
];

const TRAINING_MODES = ['online', 'offline', 'hybrid'];

const ANNOUNCEMENT_PRIORITY = ['low', 'medium', 'high', 'urgent'];

const ANNOUNCEMENT_AUDIENCE = ['all', 'hr', 'managers', 'employees'];

const HOLIDAY_TYPES = ['public', 'optional', 'restricted'];

const PAYMENT_STATUS = ['pending', 'processed', 'paid'];

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'];

const GENDERS = ['male', 'female', 'other'];

const STORAGE_BUCKETS = {
  documents: 'documents',
  receipts: 'receipts',
  trainingMaterials: 'training-materials',
  courseVideos: 'course-videos',
  profilePictures: 'profile-pictures',
  payslips: 'payslips',
};

module.exports = {
  ROLES,
  LEAVE_TYPES,
  LEAVE_STATUS,
  ATTENDANCE_STATUS,
  CHECK_IN_METHODS,
  REIMBURSEMENT_TYPES,
  DOCUMENT_TYPES,
  TRAINING_MODES,
  ANNOUNCEMENT_PRIORITY,
  ANNOUNCEMENT_AUDIENCE,
  HOLIDAY_TYPES,
  PAYMENT_STATUS,
  EMPLOYMENT_TYPES,
  GENDERS,
  STORAGE_BUCKETS,
  TIMEZONE,
  WORK_HOURS: config.workHours,
  DEFAULT_DEVICE_SERIAL: process.env.ADMS_DEVICE_SERIAL || 'NFZ8244800715',
};
