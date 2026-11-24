/**
 * Owner's report, 24 Nov 2026: employee codes restart per company, so the
 * primary company and its subsidiary both have an EMP001. Opening one by
 * code took the first match — editing the subsidiary's EMP001 opened and saved
 * the primary company's. A shared code is now refused; the website links by
 * id. No database: Supabase is an in-memory stand-in.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: mockDb.client }));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));
jest.mock('../../src/services/auditLog.service', () => ({ logAudit: jest.fn(async () => {}), auditFromRequest: jest.fn() }));
jest.mock('../../src/services/auth.service', () => ({ bumpTokenVersion: jest.fn(async () => {}) }));
jest.mock('../../src/services/tenant.service', () => ({
  getOrgCompanyIds: async (home) => (home === 'primary' ? ['primary', 'sub'] : [home]),
  isCompanyInOrg: async () => true,
  getCompanyById: async (cid) => ({ id: cid, is_active: true }),
  employeeBelongsToCompany: async () => true,
}));
jest.mock('../../src/services/rolePermissions.service', () => ({ can: jest.fn(async () => true) }));
jest.mock('../../src/services/storage.service', () => ({
  getSignedUrl: async () => 'signed', getSignedUrls: async () => new Map(),
  STORAGE_BUCKETS: { documents: 'd', receipts: 'r', profilePictures: 'p', payslips: 's' },
}));
jest.mock('../../src/services/profileCompletion.service', () => ({
  isProfileComplete: () => true, isMissingProfileColumn: () => false, syncAfterHrEdit: async () => null,
}));

const { createFakeDb, call } = require('./employee-harness');

const mockDb = createFakeDb();
const controller = require('../../src/controllers/employee.controller');
const { ConflictError } = require('../../src/utils/errors');

const PRIMARY_EMP001 = 'e0000000-0000-4000-8000-000000000001';
const SUB_EMP001 = 'e0000000-0000-4000-8000-000000000002';
const admin = { id: 'e0000000-0000-4000-8000-0000000000aa', role: 'admin', company_id: 'primary' };

beforeEach(() => {
  mockDb.reset();
  mockDb.table('employees').push(
    { id: PRIMARY_EMP001, company_id: 'primary', employee_code: 'EMP001', first_name: 'Adarsh', role: 'admin', is_active: true },
    { id: SUB_EMP001, company_id: 'sub', employee_code: 'EMP001', first_name: 'Yash', role: 'employee', is_active: true },
    { id: admin.id, company_id: 'primary', employee_code: 'EMP002', first_name: 'Admin', role: 'admin', is_active: true },
  );
});

test('a code two companies share is refused, never guessed', async () => {
  const { error } = await call(controller.getById, { user: admin, params: { id: 'EMP001' } });
  expect(error).toBeInstanceOf(ConflictError);
  expect(error.message).toMatch(/More than one employee has the code EMP001/);
});

test('by id, each opens exactly the right person; a unique code still works', async () => {
  const sub = await call(controller.getById, { user: admin, params: { id: SUB_EMP001 } });
  expect(sub.error).toBeNull();
  expect(sub.res.body.data.id || sub.res.body.data.employee?.id).toBe(SUB_EMP001);
  const unique = await call(controller.getById, { user: admin, params: { id: 'EMP002' } });
  expect(unique.error).toBeNull();
});
