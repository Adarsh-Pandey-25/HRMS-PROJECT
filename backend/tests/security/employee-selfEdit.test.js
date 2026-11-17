/**
 * Audit #13: the address JSON also carries what HR sets (attendance mode,
 * shift, work location). An employee's one-time "edit my info" may change
 * the address lines only, merged into what is stored. No database:
 * Supabase is an in-memory stand-in and backend/.env is never read.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: mockDb.client }));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));
jest.mock('../../src/services/auditLog.service', () => ({
  logAudit: jest.fn(async () => {}),
  auditFromRequest: jest.fn(),
}));
jest.mock('../../src/services/auth.service', () => ({ bumpTokenVersion: jest.fn(async () => {}) }));
jest.mock('../../src/services/tenant.service', () => ({
  getOrgCompanyIds: async (home) => [home],
  isCompanyInOrg: async () => true,
  getCompanyById: async (cid) => ({ id: cid, is_active: true }),
  employeeBelongsToCompany: async () => true,
}));
jest.mock('../../src/services/employeeCode.service', () => ({ allocateNextEmployeeCode: async () => 'EMP900' }));
jest.mock('../../src/services/storage.service', () => ({
  uploadProfilePicture: async () => ({ path: 'p' }),
  getSignedUrl: async () => 'signed',
  getSignedUrls: async () => new Map(),
  deleteEmployeeFolder: async () => {},
  STORAGE_BUCKETS: { documents: 'd', receipts: 'r', profilePictures: 'p', payslips: 's' },
}));
jest.mock('../../src/services/profileCompletion.service', () => ({
  isProfileComplete: () => true,
  isMissingProfileColumn: () => false,
  syncAfterHrEdit: async () => null,
}));
jest.mock('../../src/utils/background', () => ({ runInBackground: () => {} }));
jest.mock('../../src/services/whatsappLink.service', () => ({ followNumberChange: async () => {} }));
jest.mock('../../src/services/payroll.service', () => ({ notifyPayrollSetupChange: async () => {} }));

const { createFakeDb, call } = require('./employee-harness');

const mockDb = createFakeDb();
const controller = require('../../src/controllers/employee.controller');

const COMPANY = 'aaaaaaaa-0000-4000-8000-00000000000a';
const HR = 'e0000000-0000-4000-8000-000000000003';
const EMPLOYEE = 'e0000000-0000-4000-8000-000000000006';

const HR_SET_ADDRESS = {
  line1: '1 Road',
  line2: 'Near Park',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  country: 'India',
  attendance_mode: 'office',
  shift: 'General',
  shift_id: 'shift-general',
  work_location: 'Pune HQ',
  education: [{ degree: 'B.Com' }],
  company_id: COMPANY,
};

beforeEach(() => {
  mockDb.reset();
  mockDb.table('employees').push(
    { id: HR, company_id: COMPANY, role: 'hr', is_active: true, phone: '9876500003', address: { ...HR_SET_ADDRESS } },
    {
      id: EMPLOYEE,
      company_id: COMPANY,
      role: 'employee',
      is_active: true,
      phone: '9876500006',
      first_name: 'Asha',
      address: JSON.parse(JSON.stringify(HR_SET_ADDRESS)),
      emergency_contact: { name: 'Ravi', phone: '9000000000', relation: 'Brother' },
      profile_self_edit_used: false,
    },
  );
});

const stored = (pid) => mockDb.row('employees', pid);
const employee = { id: EMPLOYEE, role: 'employee', company_id: COMPANY };
const hr = { id: HR, role: 'hr', company_id: COMPANY };

describe('an employee\'s one-time self-edit', () => {
  test('cannot set their own attendance mode or shift, but still updates the city', async () => {
    const { error } = await call(controller.update, {
      user: employee,
      params: { id: EMPLOYEE },
      body: { address: { attendance_mode: 'wfh', shift: 'Night', shift_id: 'shift-night', work_location: 'Home', city: 'Mumbai' } },
    });
    expect(error).toBeNull();
    expect(stored(EMPLOYEE).address).toEqual({ ...HR_SET_ADDRESS, city: 'Mumbai' });
    expect(stored(EMPLOYEE).profile_self_edit_used).toBe(true);
  });

  test('the audit report\'s exact request leaves the attendance mode as HR set it', async () => {
    const { error } = await call(controller.update, {
      user: employee, params: { id: EMPLOYEE }, body: { address: { attendance_mode: 'wfh' } },
    });
    expect(error).toBeNull();
    expect(stored(EMPLOYEE).address).toEqual(HR_SET_ADDRESS);
  });

  test('cannot remove HR-set keys by sending a bare address', async () => {
    const { error } = await call(controller.update, {
      user: employee, params: { id: EMPLOYEE }, body: { address: { line1: '22 New Street', pincode: '411002' } },
    });
    expect(error).toBeNull();
    expect(stored(EMPLOYEE).address).toEqual({ ...HR_SET_ADDRESS, line1: '22 New Street', pincode: '411002' });
  });

  test('the "Edit my info" form\'s own payload (stored address spread back, snake-cased) still works', async () => {
    const { error } = await call(controller.update, {
      user: employee,
      params: { id: EMPLOYEE },
      body: {
        first_name: 'Asha',
        phone: '9876500006',
        address: {
          ...HR_SET_ADDRESS,
          attendance_mode: 'hybrid',
          line1: '5 Lake Road', line2: 'Block B', city: 'Nashik', state: 'Maharashtra', pincode: '422001', country: 'India',
          personal_email: 'asha@example.test',
        },
        emergency_contact: { name: 'Ravi', phone: '9000000000', relation: 'Brother' },
      },
    });
    expect(error).toBeNull();
    expect(stored(EMPLOYEE).address).toEqual({
      ...HR_SET_ADDRESS,
      line1: '5 Lake Road', line2: 'Block B', city: 'Nashik', pincode: '422001', personal_email: 'asha@example.test',
    });
  });

  test('a capitalised own id gets the same protection', async () => {
    const { error } = await call(controller.update, {
      user: employee, params: { id: EMPLOYEE.toUpperCase() }, body: { address: { attendance_mode: 'wfh', city: 'Goa' } },
    });
    expect(error).toBeNull();
    expect(stored(EMPLOYEE).address).toMatchObject({ attendance_mode: 'office', city: 'Goa', company_id: COMPANY });
  });

  test('an address with nothing self-editable in it leaves the address alone', async () => {
    const { error } = await call(controller.update, {
      user: employee, params: { id: EMPLOYEE }, body: { address: 'wfh', first_name: 'Asha K' },
    });
    expect(error).toBeNull();
    expect(stored(EMPLOYEE).address).toEqual(HR_SET_ADDRESS);
    expect(stored(EMPLOYEE).first_name).toBe('Asha K');
  });

  test('HR editing their own record cannot change their own attendance mode either', async () => {
    const { error } = await call(controller.update, {
      user: hr, params: { id: HR }, body: { address: { ...HR_SET_ADDRESS, attendance_mode: 'wfh', city: 'Thane' } },
    });
    expect(error).toBeNull();
    expect(stored(HR).address).toEqual({ ...HR_SET_ADDRESS, city: 'Thane' });
  });
});

describe('HR editing someone else keeps working as before', () => {
  test('HR sets an employee\'s attendance mode and shift', async () => {
    const { error } = await call(controller.update, {
      user: hr,
      params: { id: EMPLOYEE },
      body: { address: { ...HR_SET_ADDRESS, attendance_mode: 'wfh', shift: 'Night', shift_id: 'shift-night' } },
    });
    expect(error).toBeNull();
    expect(stored(EMPLOYEE).address).toEqual({ ...HR_SET_ADDRESS, attendance_mode: 'wfh', shift: 'Night', shift_id: 'shift-night' });
    expect(stored(EMPLOYEE).profile_self_edit_used).toBe(false);
  });
});
