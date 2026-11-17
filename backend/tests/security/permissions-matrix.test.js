/**
 * Settings → User & Role Management: who may save the matrix, what a saved
 * matrix must look like, and how the server reads it (a malformed value
 * means no, never "fall back to allowed"). No database: settings are an
 * in-memory stand-in; nothing is sent.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: () => { throw new Error('no database in these tests'); } } }));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));
jest.mock('../../src/services/settings.service', () => ({
  getSetting: jest.fn(async (key, fallback) => (key in global.__settings ? global.__settings[key] : fallback)),
  setSetting: jest.fn(async (key, value) => { global.__settings[key] = value; return { data: { key }, error: null }; }),
}));
jest.mock('../../src/services/auditLog.service', () => ({
  logAudit: jest.fn(() => Promise.resolve()),
  auditFromRequest: jest.fn(),
}));
jest.mock('../../src/services/backup.service', () => ({}));
jest.mock('../../src/services/storage.service', () => ({
  uploadCompanyLogo: async () => ({}), uploadCompanyBrandIcon: async () => ({}), getSignedUrl: async () => 'x', STORAGE_BUCKETS: { documents: 'documents' },
}));

const settingsService = require('../../src/services/settings.service');
const { auditFromRequest } = require('../../src/services/auditLog.service');
const rolePermissions = require('../../src/services/rolePermissions.service');
const settingsController = require('../../src/controllers/settings.controller');

const hr = { id: 'h1', role: 'hr', company_id: 'c1' };
const manager = { id: 'm1', role: 'manager', company_id: 'c1' };
const admin = { id: 'a1', role: 'admin', company_id: 'c1' };

beforeEach(() => {
  global.__settings = {};
  jest.clearAllMocks();
});

/** Call PUT /api/settings/:key as `user`; resolves to the error passed on, or the response body. */
const put = (user, key, value) => new Promise((resolve) => {
  const req = {
    params: { key }, body: { value }, user, ip: '127.0.0.1',
  };
  const res = {
    status() { return this; },
    json(body) { resolve({ body }); return this; },
  };
  settingsController.updateKey(req, res, (err) => resolve({ err }));
});

describe('saving the matrix', () => {
  const valid = { hr: { payroll: { view: true, manage: false } }, manager: { leave: { approve: true } } };

  test.each([
    ['an empty list', []],
    ['nothing', null],
    ['text', 'all'],
    ['a valid matrix', valid],
  ])('HR is refused whatever it sends (%s), and the attempt is logged', async (_label, value) => {
    global.__settings.role_permissions = valid;
    const { err } = await put(hr, 'role_permissions', value);
    expect(err).toMatchObject({ statusCode: 403, message: 'Only an Admin can change permissions.' });
    expect(settingsService.setSetting).not.toHaveBeenCalled();
    expect(global.__settings.role_permissions).toBe(valid);
    expect(auditFromRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actionType: 'settings.update_refused', afterState: { key: 'role_permissions' },
    }));
  });

  test('HR may not change security settings either', async () => {
    const { err } = await put(hr, 'security_config', { passwordMinLength: 4 });
    expect(err).toMatchObject({ statusCode: 403, message: 'Only an Admin can change security settings.' });
    for (const key of ['allow_remote_login', 'office_cidr', 'office_ip']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await put(hr, key, 'x')).err).toMatchObject({ statusCode: 403 });
    }
    expect(settingsService.setSetting).not.toHaveBeenCalled();
  });

  test.each([
    ['an empty list', [], /each role/],
    ['nothing', null, /each role/],
    ['text', 'all', /each role/],
    ['an unknown role', { owner: {} }, /"owner" isn't a role/],
    ['a role as a list', { hr: [] }, /hr's modules/],
    ['an unknown module', { hr: { billing: { view: true } } }, /"billing" isn't a module/],
    ['a module as text', { hr: { payroll: 'all' } }, /hr → payroll/],
    ['an unknown action', { hr: { payroll: { run: true } } }, /"run" isn't an action/],
    ['a cell as text', { hr: { payroll: { manage: 'true' } } }, /must be on or off/],
    ['a cell as a number', { hr: { payroll: { manage: 1 } } }, /must be on or off/],
  ])('an Admin\'s malformed matrix is refused (%s)', async (_label, value, message) => {
    const { err } = await put(admin, 'role_permissions', value);
    expect(err).toMatchObject({ statusCode: 400 });
    expect(err.message).toMatch(message);
    expect(settingsService.setSetting).not.toHaveBeenCalled();
  });

  test('an Admin saves a well-formed matrix', async () => {
    const { err, body } = await put(admin, 'role_permissions', valid);
    expect(err).toBeUndefined();
    expect(body.success).toBe(true);
    expect(global.__settings.role_permissions).toEqual(valid);
  });

  test('HR still saves ordinary settings', async () => {
    const { err } = await put(hr, 'expense_config', { maxAmount: 5000 });
    expect(err).toBeUndefined();
    expect(global.__settings.expense_config).toEqual({ maxAmount: 5000 });
  });
});

describe('reading the matrix', () => {
  test('Organizations: HR may view by default, but not add or edit companies', async () => {
    expect(await rolePermissions.can(hr, 'organizations', 'view')).toBe(true);
    expect(await rolePermissions.can(hr, 'organizations', 'create')).toBe(false);
    expect(await rolePermissions.can(hr, 'organizations', 'edit')).toBe(false);
    expect(await rolePermissions.can(manager, 'organizations', 'view')).toBe(false);
    expect(await rolePermissions.can(admin, 'organizations', 'create')).toBe(true);
  });

  test('an Admin can allow HR to add companies', async () => {
    global.__settings.role_permissions = { hr: { organizations: { create: true, edit: true } } };
    expect(await rolePermissions.can(hr, 'organizations', 'create')).toBe(true);
    expect(await rolePermissions.can(hr, 'organizations', 'edit')).toBe(true);
    // Cells the row doesn't use stay off whatever is saved.
    global.__settings.role_permissions = { hr: { organizations: { delete: true } } };
    expect(await rolePermissions.can(hr, 'organizations', 'delete')).toBe(false);
  });

  test('every module: nothing saved gives today\'s defaults', async () => {
    expect(await rolePermissions.can(hr, 'payroll', 'manage')).toBe(true);
    expect(await rolePermissions.can(hr, 'employees', 'delete')).toBe(true);
    expect(await rolePermissions.can(hr, 'settings', 'manage')).toBe(true);
    expect(await rolePermissions.can(manager, 'leave', 'approve')).toBe(true);
    expect(await rolePermissions.can(manager, 'payroll', 'manage')).toBe(false);
    expect(await rolePermissions.can(hr, 'billing', 'view')).toBe(false);
    expect(await rolePermissions.can({ role: 'api_key', company_id: 'c1' }, 'attendance', 'view')).toBe(false);
    expect(await rolePermissions.can(null, 'payroll', 'view')).toBe(false);
  });

  test('a saved cell wins; a role or module saved without it keeps the default', async () => {
    global.__settings.role_permissions = { hr: { payroll: { manage: false } } };
    expect(await rolePermissions.can(hr, 'payroll', 'manage')).toBe(false);
    expect(await rolePermissions.can(hr, 'payroll', 'view')).toBe(true);
    expect(await rolePermissions.can(hr, 'leave', 'approve')).toBe(true);
    expect(await rolePermissions.can(manager, 'leave', 'approve')).toBe(true);
  });

  test.each([
    ['an empty list', []],
    ['text', 'all'],
    ['a number', 7],
    ['HR\'s row as a list', { hr: [] }],
    ['HR\'s row as nothing', { hr: null }],
    ['the module as text', { hr: { payroll: 'yes' } }],
    ['the cell as text', { hr: { payroll: { manage: 'true' } } }],
    ['the cell as nothing', { hr: { payroll: { manage: null } } }],
  ])('a malformed stored matrix means no (%s)', async (_label, stored) => {
    global.__settings.role_permissions = stored;
    expect(await rolePermissions.can(hr, 'payroll', 'manage')).toBe(false);
    expect(await rolePermissions.can(admin, 'payroll', 'manage')).toBe(true);
  });
});
