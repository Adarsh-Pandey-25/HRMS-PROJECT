/**
 * Follow-ups wired at integration: the permission matrix on someone else's
 * record (#9), seats on reactivation and moves (#10), and sessions ended when
 * access is removed or the role changes (#6). In-memory database; .env never read.
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
const EMP = 'e0000000-0000-4000-8000-000000000006';
const admin = { id: ADMIN, role: 'admin', company_id: C };
const hr = { id: HR, role: 'hr', company_id: C };

beforeEach(() => {
  mockDb.reset();
  jest.clearAllMocks();
  rolePermissions.can.mockImplementation(async () => true);
  mockDb.table('employees').push(
    { id: ADMIN, company_id: C, role: 'admin', is_active: true, phone: '9000000001', address: { company_id: C } },
    { id: HR, company_id: C, role: 'hr', is_active: true, phone: '9000000003', address: { company_id: C } },
    { id: EMP, company_id: C, role: 'employee', is_active: true, phone: '9000000006', first_name: 'Asha', address: { company_id: C } },
  );
});
const stored = (id) => mockDb.row('employees', id);

describe('permission matrix on someone else\'s record (#9)', () => {
  test('HR with Employees → Edit unticked cannot edit an employee', async () => {
    rolePermissions.can.mockImplementation(async (_u, mod, action) => !(mod === 'employees' && action === 'edit'));
    const { error } = await call(controller.update, { user: hr, params: { id: EMP }, body: { first_name: 'X' } });
    expect(error?.message).toMatch(/permission to edit employees/);
    expect(stored(EMP).first_name).toBe('Asha');
  });

  test('HR with Employees → View unticked cannot open an employee', async () => {
    rolePermissions.can.mockImplementation(async (_u, mod, action) => !(mod === 'employees' && action === 'view'));
    const { error } = await call(controller.getById, { user: hr, params: { id: EMP } });
    expect(error?.message).toMatch(/permission to view employees/);
  });

  test('HR can still open their own record whatever the matrix says', async () => {
    rolePermissions.can.mockImplementation(async () => false);
    const { error } = await call(controller.getById, { user: hr, params: { id: HR } });
    expect(error).toBeNull();
  });

  test('the Admin is never stopped by the matrix', async () => {
    rolePermissions.can.mockImplementation(async () => false);
    const { error } = await call(controller.update, { user: admin, params: { id: EMP }, body: { first_name: 'Asha K' } });
    expect(error).toBeNull();
    expect(stored(EMP).first_name).toBe('Asha K');
  });
});

describe('seats (#10)', () => {
  test('reactivating someone checks for a free seat', async () => {
    stored(EMP).is_active = false;
    subscriptionService.assertSeatAvailable.mockRejectedValueOnce(new Error('Seat limit reached'));
    const { error } = await call(controller.update, { user: admin, params: { id: EMP }, body: { is_active: true } });
    expect(error?.message).toMatch(/Seat limit/);
    expect(stored(EMP).is_active).toBe(false);
  });

  test('moving an active person to a subsidiary passes where they came from', async () => {
    const { error } = await call(controller.update, {
      user: admin, params: { id: EMP }, body: { company_id: mockIds.SUBSIDIARY },
    });
    expect(error).toBeNull();
    expect(subscriptionService.assertSeatAvailable)
      .toHaveBeenCalledWith(mockIds.SUBSIDIARY, { fromCompanyId: C });
  });

  test('an ordinary edit uses no seat check', async () => {
    await call(controller.update, { user: admin, params: { id: EMP }, body: { first_name: 'A' } });
    expect(subscriptionService.assertSeatAvailable).not.toHaveBeenCalled();
  });
});

describe('sessions end when access changes (#6)', () => {
  test('switching someone off through the edit form signs them out', async () => {
    const { error } = await call(controller.update, { user: admin, params: { id: EMP }, body: { is_active: false } });
    expect(error).toBeNull();
    expect(authService.bumpTokenVersion).toHaveBeenCalledWith(EMP);
  });

  test('a role change signs them out', async () => {
    const { error } = await call(controller.update, { user: admin, params: { id: EMP }, body: { role: 'manager' } });
    expect(error).toBeNull();
    expect(authService.bumpTokenVersion).toHaveBeenCalledWith(EMP);
  });

  test('an ordinary edit does not', async () => {
    await call(controller.update, { user: admin, params: { id: EMP }, body: { first_name: 'A' } });
    expect(authService.bumpTokenVersion).not.toHaveBeenCalled();
  });
});
