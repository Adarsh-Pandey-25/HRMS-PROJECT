/**
 * Owner's rule (17 Nov 2026): only an Admin changes the pay of HR and Admin
 * users — salary and bank details on the edit form, and every payroll action
 * that goes through ownPayslip.assertMayChangePayOf. In-memory database.
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
jest.mock('../../src/services/auth.service', () => ({
  bumpTokenVersion: jest.fn(async () => {}),
  hashPassword: async () => 'hashed',
  assertPasswordPolicy: async () => {},
  generateOnboardingToken: () => 'token',
}));
jest.mock('../../src/services/tenant.service', () => ({
  getOrgCompanyIds: async (home) => (home === mockIds.PARENT ? [mockIds.PARENT, mockIds.SUBSIDIARY] : [home]),
  isCompanyInOrg: async () => true,
  getCompanyById: async (id) => ({ id, is_active: true }),
  employeeBelongsToCompany: async () => true,
}));
jest.mock('../../src/services/employeeCode.service', () => ({ allocateNextEmployeeCode: async () => 'EMP900' }));
jest.mock('../../src/services/storage.service', () => ({
  uploadProfilePicture: async (_file, id) => ({ path: `${id}/photo.png` }),
  getSignedUrl: async () => 'signed',
  getSignedUrls: async () => new Map(),
  deleteEmployeeFolder: jest.fn(async () => {}),
  STORAGE_BUCKETS: { documents: 'd', receipts: 'r', profilePictures: 'p', payslips: 's' },
}));
jest.mock('../../src/services/profileCompletion.service', () => ({
  isProfileComplete: () => true,
  isMissingProfileColumn: () => false,
  syncAfterHrEdit: async () => null,
}));
jest.mock('../../src/utils/background', () => ({ runInBackground: () => {} }));
jest.mock('../../src/services/subscription.service', () => ({ assertSeatAvailable: jest.fn(async () => {}) }));
jest.mock('../../src/services/rolePermissions.service', () => ({ can: jest.fn(async () => true) }));
jest.mock('../../src/services/email.service', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()),
}));
jest.mock('../../src/services/webhook.service', () => ({ dispatchWebhookEvent: () => {} }));
jest.mock('../../src/services/whatsappLink.service', () => ({
  connectAddedEmployee: async () => {}, followNumberChange: async () => {},
}));
jest.mock('../../src/services/payroll.service', () => ({ notifyPayrollSetupChange: async () => {} }));
jest.mock('../../src/services/settings.service', () => ({ getSetting: async () => ({}), getNumber: async () => 90 }));

const { createFakeDb, call } = require('./employee-harness');

const mockIds = {
  PARENT: 'cccccccc-0000-4000-8000-00000000000c',
  SUBSIDIARY: 'dddddddd-0000-4000-8000-00000000000d',
};
const mockDb = createFakeDb();
const controller = require('../../src/controllers/employee.controller');
const authService = require('../../src/services/auth.service');
const subscriptionService = require('../../src/services/subscription.service');
const rolePermissions = require('../../src/services/rolePermissions.service');

const C = mockIds.PARENT;
const ADMIN = 'e0000000-0000-4000-8000-000000000001';
const HR = 'e0000000-0000-4000-8000-000000000003';
const HR2 = 'e0000000-0000-4000-8000-000000000004';
const EMP = 'e0000000-0000-4000-8000-000000000006';
const admin = { id: ADMIN, role: 'admin', company_id: C };
const hr = { id: HR, role: 'hr', company_id: C };
const ownPay = require('../../src/services/ownPayslip');

const SALARY = { basic: 30000, hra: 12000, special: 8000, deduction_optouts: ['lwf'] };
const BANK = { account_number: '123456789012345678', ifsc: 'HDFC0001234' };

beforeEach(() => {
  mockDb.reset();
  jest.clearAllMocks();
  mockDb.table('employees').push(
    { id: ADMIN, company_id: C, role: 'admin', is_active: true, phone: '9000000001', address: { company_id: C } },
    { id: HR, company_id: C, role: 'hr', is_active: true, phone: '9000000003', address: { company_id: C } },
    {
      id: HR2, company_id: C, role: 'hr', is_active: true, phone: '9000000004', designation: 'HR Executive',
      address: { company_id: C }, salary_details: { ...SALARY }, bank_details: { ...BANK },
    },
    {
      id: EMP, company_id: C, role: 'employee', is_active: true, phone: '9000000006',
      address: { company_id: C }, salary_details: { ...SALARY }, bank_details: { ...BANK },
    },
  );
});
const stored = (id) => mockDb.row('employees', id);

describe('assertMayChangePayOf', () => {
  test('HR changing another HR user\'s pay is refused', async () => {
    await expect(ownPay.assertMayChangePayOf(hr, HR2)).rejects.toThrow(/Only an Admin can change the pay of HR and Admin users/);
  });
  test('HR changing an Admin\'s pay is refused', async () => {
    await expect(ownPay.assertMayChangePayOf(hr, ADMIN)).rejects.toThrow(/Only an Admin/);
  });
  test('HR changing an employee\'s pay is allowed', async () => {
    await expect(ownPay.assertMayChangePayOf(hr, EMP)).resolves.toBeUndefined();
  });
  test('the Admin and scheduled jobs are never stopped', async () => {
    await expect(ownPay.assertMayChangePayOf(admin, HR2)).resolves.toBeUndefined();
    await expect(ownPay.assertMayChangePayOf({ id: null, role: 'system' }, HR2)).resolves.toBeUndefined();
  });
  test('a known role skips the lookup; capitals in the id still match', async () => {
    await expect(ownPay.assertMayChangePayOf(hr, HR2.toUpperCase(), 'hr')).rejects.toThrow(/Only an Admin/);
  });
});

describe('the employee edit form', () => {
  test('HR cannot change another HR user\'s salary', async () => {
    const { error } = await call(controller.update, {
      user: hr, params: { id: HR2 }, body: { salary_details: { ...SALARY, basic: 90000 } },
    });
    expect(error?.message).toMatch(/Only an Admin can change the pay or bank details/);
    expect(stored(HR2).salary_details.basic).toBe(30000);
  });

  test('HR cannot change another HR user\'s bank account', async () => {
    const { error } = await call(controller.update, {
      user: hr, params: { id: HR2 }, body: { bank_details: { ...BANK, account_number: '123456789012345679' } },
    });
    expect(error?.message).toMatch(/Only an Admin/);
    expect(stored(HR2).bank_details.account_number).toBe('123456789012345678');
  });

  test('HR saving another HR user\'s form unchanged (numbers as text) still updates other fields', async () => {
    const { error } = await call(controller.update, {
      user: hr,
      params: { id: HR2 },
      body: {
        designation: 'HR Manager',
        salary_details: { special: '8000', hra: '12000', basic: '30000' },
        bank_details: { ...BANK },
      },
    });
    expect(error).toBeNull();
    expect(stored(HR2).designation).toBe('HR Manager');
    expect(stored(HR2).salary_details).toEqual(SALARY);
  });

  test('HR can still change an employee\'s salary', async () => {
    const { error } = await call(controller.update, {
      user: hr, params: { id: EMP }, body: { salary_details: { ...SALARY, basic: 35000 } },
    });
    expect(error).toBeNull();
    expect(stored(EMP).salary_details.basic).toBe(35000);
  });

  test('the Admin can change an HR user\'s salary and bank account', async () => {
    const { error } = await call(controller.update, {
      user: admin,
      params: { id: HR2 },
      body: { salary_details: { ...SALARY, basic: 40000 }, bank_details: { ...BANK, ifsc: 'ICIC0000001' } },
    });
    expect(error).toBeNull();
    expect(stored(HR2).salary_details.basic).toBe(40000);
    expect(stored(HR2).bank_details.ifsc).toBe('ICIC0000001');
  });
});
