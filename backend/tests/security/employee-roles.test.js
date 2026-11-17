/**
 * Who may change whose account in the employee module (audit #4, #7, #41):
 * capitalised own ids, HR against Admins and other HR, the last Admin,
 * and nobody changing their own role or access. No database: Supabase is
 * an in-memory stand-in (employee-harness.js) and backend/.env is never read.
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
  // The parent company also manages its subsidiary; everyone else sees only their own.
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
jest.mock('../../src/services/subscription.service', () => ({ assertSeatAvailable: async () => {} }));
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
  A: 'aaaaaaaa-0000-4000-8000-00000000000a',
  B: 'bbbbbbbb-0000-4000-8000-00000000000b',
  PARENT: 'cccccccc-0000-4000-8000-00000000000c',
  SUBSIDIARY: 'dddddddd-0000-4000-8000-00000000000d',
};
const mockDb = createFakeDb();

const controller = require('../../src/controllers/employee.controller');
const { logAudit } = require('../../src/services/auditLog.service');

const id = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = id(1);
const ADMIN_2 = id(2);
const HR = id(3);
const HR_2 = id(4);
const MANAGER = id(5);
const EMPLOYEE = id(6);
const OTHER_CO = id(7);
const PARENT_ADMIN = id(8);
const SUB_ADMIN = id(9);
const OFFBOARDED_ADMIN = id(10);

const person = (pid, companyId, role, extra = {}) => ({
  id: pid,
  company_id: companyId,
  role,
  is_active: true,
  employment_status: 'active',
  employee_code: `EMP${pid.slice(-3)}`,
  first_name: role,
  last_name: 'Person',
  email: `${pid.slice(-3)}@example.test`,
  phone: '9876500000',
  designation: 'Staff',
  department: 'Ops',
  manager_id: null,
  salary_details: { basic: 30000 },
  bank_details: { bank_name: 'HDFC', account_number: '123456789', ifsc: 'HDFC0001234' },
  address: { line1: '1 Road', city: 'Pune', attendance_mode: 'office', shift: 'General', company_id: companyId },
  profile_self_edit_used: false,
  ...extra,
});

const asUser = (row) => ({ id: row.id, role: row.role, company_id: row.company_id });
const user = (pid) => asUser(mockDb.row('employees', pid));

beforeEach(() => {
  mockDb.reset();
  mockDb.table('employees').push(
    person(ADMIN, mockIds.A, 'admin'),
    person(ADMIN_2, mockIds.A, 'admin'),
    person(HR, mockIds.A, 'hr'),
    person(HR_2, mockIds.A, 'hr'),
    person(MANAGER, mockIds.A, 'manager'),
    person(EMPLOYEE, mockIds.A, 'employee', { manager_id: MANAGER }),
    person(OTHER_CO, mockIds.B, 'employee'),
    person(PARENT_ADMIN, mockIds.PARENT, 'admin'),
    person(SUB_ADMIN, mockIds.SUBSIDIARY, 'admin'),
    person(OFFBOARDED_ADMIN, mockIds.A, 'admin', { is_active: false, employment_status: 'offboarded' }),
  );
  logAudit.mockClear();
});

const stored = (pid) => mockDb.row('employees', pid);
const refusals = () => logAudit.mock.calls.map(([e]) => e).filter((e) => e.actionType === 'employee.refused');
const roleChanges = () => logAudit.mock.calls.map(([e]) => e).filter((e) => e.actionType === 'employee.role_change');

describe('audit #4 — a capitalised own id is still "yourself"', () => {
  test('HR sending their own id in capitals cannot change their own salary or bank details', async () => {
    const { res, error } = await call(controller.update, {
      user: user(HR),
      params: { id: HR.toUpperCase() },
      body: { salary_details: { basic: 999999 }, bank_details: { account_number: '999999999' }, designation: 'Chief' },
    });
    expect(error).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(stored(HR).salary_details).toEqual({ basic: 30000 });
    expect(stored(HR).bank_details.account_number).toBe('123456789');
    expect(stored(HR).designation).toBe('Staff');
  });

  test('HR sending their own id in capitals cannot give themselves a new role', async () => {
    const { error } = await call(controller.update, {
      user: user(HR), params: { id: HR.toUpperCase() }, body: { role: 'admin' },
    });
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe('You can\'t change your own role. Ask an Admin.');
    expect(stored(HR).role).toBe('hr');
    expect(refusals()).toHaveLength(1);
  });

  test('an Admin sending their own id in capitals cannot deactivate themselves', async () => {
    const { error } = await call(controller.deactivate, { user: user(ADMIN), params: { id: ADMIN.toUpperCase() } });
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe('You can\'t deactivate your own account.');
    expect(stored(ADMIN).is_active).toBe(true);
  });

  test('an employee using a capitalised own id goes through the one-time self-edit', async () => {
    const { res, error } = await call(controller.update, {
      user: user(EMPLOYEE), params: { id: EMPLOYEE.toUpperCase() }, body: { first_name: 'Asha' },
    });
    expect(error).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(stored(EMPLOYEE).first_name).toBe('Asha');
    expect(stored(EMPLOYEE).profile_self_edit_used).toBe(true);
  });

  test('another company\'s employee id is "not found" for every write and for viewing', async () => {
    const hr = user(HR);
    for (const handler of [controller.update, controller.deactivate, controller.offboard, controller.permanentlyErase, controller.resetSelfEditLock]) {
      const { error } = await call(handler, { user: hr, params: { id: OTHER_CO }, body: { first_name: 'X' } });
      expect(error.statusCode).toBe(404);
    }
    const { error } = await call(controller.getById, { user: hr, params: { id: OTHER_CO.toUpperCase() } });
    expect(error.statusCode).toBe(404);
    expect(stored(OTHER_CO).is_active).toBe(true);
    expect(stored(OTHER_CO).first_name).toBe('employee');
  });

  test('write endpoints only act on a uuid, never on an employee code', async () => {
    const { error } = await call(controller.deactivate, { user: user(HR), params: { id: stored(EMPLOYEE).employee_code } });
    expect(error.statusCode).toBe(404);
    expect(stored(EMPLOYEE).is_active).toBe(true);
  });
});

describe('audit #7 — HR cannot touch an Admin\'s account', () => {
  test('HR cannot demote an Admin', async () => {
    const { error } = await call(controller.update, { user: user(HR), params: { id: ADMIN }, body: { role: 'employee' } });
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe('Only an Admin can change another Admin\'s account.');
    expect(stored(ADMIN).role).toBe('admin');
    expect(refusals()[0]).toMatchObject({
      actorId: HR, targetId: ADMIN, companyId: mockIds.A,
      afterState: expect.objectContaining({ action: 'update', fromRole: 'admin', toRole: 'employee' }),
    });
  });

  test('HR cannot edit even ordinary fields, or the mobile number, of an Admin', async () => {
    const { error } = await call(controller.update, { user: user(HR), params: { id: ADMIN }, body: { phone: '9000000000', designation: 'X' } });
    expect(error.statusCode).toBe(403);
    expect(stored(ADMIN).phone).toBe('9876500000');
    expect(stored(ADMIN).designation).toBe('Staff');
  });

  test('HR cannot deactivate an Admin, by either route', async () => {
    let { error } = await call(controller.deactivate, { user: user(HR), params: { id: ADMIN } });
    expect(error.statusCode).toBe(403);
    ({ error } = await call(controller.update, { user: user(HR), params: { id: ADMIN }, body: { is_active: false } }));
    expect(error.statusCode).toBe(403);
    expect(stored(ADMIN).is_active).toBe(true);
    expect(refusals()).toHaveLength(2);
  });

  test('HR cannot offboard an Admin', async () => {
    const { error } = await call(controller.offboard, { user: user(HR), params: { id: ADMIN }, body: {} });
    expect(error.statusCode).toBe(403);
    expect(stored(ADMIN).is_active).toBe(true);
    expect(stored(ADMIN).employment_status).toBe('active');
  });

  test('HR cannot erase an (offboarded) Admin', async () => {
    const { error } = await call(controller.permanentlyErase, {
      user: user(HR), params: { id: OFFBOARDED_ADMIN }, body: { confirm_employee_code: stored(OFFBOARDED_ADMIN).employee_code },
    });
    expect(error.statusCode).toBe(403);
    expect(stored(OFFBOARDED_ADMIN)).toBeDefined();
  });

  test('HR cannot reset an Admin\'s self-edit lock or change their photo', async () => {
    let { error } = await call(controller.resetSelfEditLock, { user: user(HR), params: { id: ADMIN }, body: {} });
    expect(error.statusCode).toBe(403);
    ({ error } = await call(controller.uploadPhoto, {
      user: user(HR), params: { id: ADMIN }, file: { mimetype: 'image/png' },
    }));
    expect(error.statusCode).toBe(403);
  });

  test('an Admin can demote, deactivate and offboard another Admin while one stays', async () => {
    let { error } = await call(controller.update, { user: user(ADMIN), params: { id: ADMIN_2 }, body: { role: 'hr' } });
    expect(error).toBeNull();
    expect(stored(ADMIN_2).role).toBe('hr');
    expect(roleChanges()[0]).toMatchObject({ targetId: ADMIN_2, beforeState: { role: 'admin' }, afterState: { role: 'hr' } });

    stored(ADMIN_2).role = 'admin';
    ({ error } = await call(controller.deactivate, { user: user(ADMIN), params: { id: ADMIN_2 } }));
    expect(error).toBeNull();
    expect(stored(ADMIN_2).is_active).toBe(false);

    stored(ADMIN_2).is_active = true;
    ({ error } = await call(controller.offboard, { user: user(ADMIN), params: { id: ADMIN_2 }, body: {} }));
    expect(error).toBeNull();
    expect(stored(ADMIN_2).employment_status).toBe('offboarded');
  });

  test('an Admin can erase an offboarded Admin', async () => {
    const { error } = await call(controller.permanentlyErase, {
      user: user(ADMIN), params: { id: OFFBOARDED_ADMIN }, body: { confirm_employee_code: stored(OFFBOARDED_ADMIN).employee_code },
    });
    expect(error).toBeNull();
    expect(stored(OFFBOARDED_ADMIN)).toBeUndefined();
  });
});

describe('audit #41 — only an Admin gives or takes away the HR or Admin role', () => {
  const newHire = (role) => ({
    email: `new.${role}@example.test`, first_name: 'New', last_name: 'Hire', role, phone: '9123456789',
  });

  test.each(['hr', 'admin'])('HR cannot create a %s account', async (role) => {
    const before = mockDb.table('employees').length;
    const { error } = await call(controller.create, { user: user(HR), body: newHire(role) });
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe('Only an Admin can create an HR or Admin account.');
    expect(mockDb.table('employees')).toHaveLength(before);
    expect(refusals()[0]).toMatchObject({ actorId: HR, afterState: expect.objectContaining({ action: 'create', role }) });
  });

  test.each(['manager', 'employee'])('HR can create a %s account', async (role) => {
    const { res, error } = await call(controller.create, { user: user(HR), body: newHire(role) });
    expect(error).toBeNull();
    expect(res.statusCode).toBe(201);
    expect(res.body.data.employee.role).toBe(role);
  });

  test.each(['hr', 'admin'])('an Admin can create a %s account', async (role) => {
    const { res, error } = await call(controller.create, { user: user(ADMIN), body: newHire(role) });
    expect(error).toBeNull();
    expect(res.body.data.employee.role).toBe(role);
  });

  test('HR cannot promote an employee to HR or Admin', async () => {
    for (const role of ['hr', 'admin']) {
      const { error } = await call(controller.update, { user: user(HR), params: { id: EMPLOYEE }, body: { role } });
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('Only an Admin can give someone the HR or Admin role.');
    }
    expect(stored(EMPLOYEE).role).toBe('employee');
  });

  test('HR can move someone between manager and employee', async () => {
    const { error } = await call(controller.update, { user: user(HR), params: { id: EMPLOYEE }, body: { role: 'manager' } });
    expect(error).toBeNull();
    expect(stored(EMPLOYEE).role).toBe('manager');
    expect(roleChanges()).toHaveLength(1);
  });

  test('HR cannot change another HR user\'s role, access or mobile number', async () => {
    const attempts = [
      [controller.update, { role: 'employee' }],
      [controller.update, { is_active: false }],
      [controller.update, { phone: '9000000001' }],
      [controller.deactivate, {}],
      [controller.offboard, {}],
    ];
    for (const [handler, body] of attempts) {
      const { error } = await call(handler, { user: user(HR), params: { id: HR_2 }, body });
      expect(error.statusCode).toBe(403);
    }
    expect(stored(HR_2)).toMatchObject({ role: 'hr', is_active: true, phone: '9876500000', employment_status: 'active' });
    expect(refusals()).toHaveLength(attempts.length);
  });

  test('HR can still edit another HR user\'s ordinary profile fields (unchanged role and phone sent along)', async () => {
    const { error } = await call(controller.update, {
      user: user(HR), params: { id: HR_2 }, body: { designation: 'HR Lead', role: 'hr', phone: '98765 00000' },
    });
    expect(error).toBeNull();
    expect(stored(HR_2)).toMatchObject({ designation: 'HR Lead', role: 'hr' });
  });

  test('an Admin can grant and remove the HR role', async () => {
    let { error } = await call(controller.update, { user: user(ADMIN), params: { id: EMPLOYEE }, body: { role: 'hr' } });
    expect(error).toBeNull();
    expect(stored(EMPLOYEE).role).toBe('hr');
    ({ error } = await call(controller.update, { user: user(ADMIN), params: { id: HR_2 }, body: { role: 'employee' } }));
    expect(error).toBeNull();
    expect(stored(HR_2).role).toBe('employee');
    expect(roleChanges()).toHaveLength(2);
  });

  test('a blank role no longer demotes the person being edited', async () => {
    const { error } = await call(controller.update, { user: user(HR), params: { id: MANAGER }, body: { role: '', designation: 'Lead' } });
    expect(error).toBeNull();
    expect(stored(MANAGER)).toMatchObject({ role: 'manager', designation: 'Lead' });
  });
});

describe('the last active Admin and changes to yourself', () => {
  // The parent company's Admin manages the subsidiary, whose only Admin is SUB_ADMIN.
  test('the last active Admin of a company cannot be demoted, deactivated or offboarded', async () => {
    const parentAdmin = user(PARENT_ADMIN);
    const attempts = [
      [controller.update, { role: 'hr' }],
      [controller.update, { is_active: false }],
      [controller.deactivate, {}],
      [controller.offboard, {}],
    ];
    for (const [handler, body] of attempts) {
      const { error } = await call(handler, { user: parentAdmin, params: { id: SUB_ADMIN }, body });
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe('This is the company\'s last active Admin. Make someone else an Admin first.');
    }
    expect(stored(SUB_ADMIN)).toMatchObject({ role: 'admin', is_active: true, employment_status: 'active' });
    expect(refusals()).toHaveLength(attempts.length);
  });

  test('once a second Admin exists, the first can be demoted', async () => {
    mockDb.table('employees').push(person(id(11), mockIds.SUBSIDIARY, 'admin'));
    const { error } = await call(controller.update, { user: user(PARENT_ADMIN), params: { id: SUB_ADMIN }, body: { role: 'hr' } });
    expect(error).toBeNull();
    expect(stored(SUB_ADMIN).role).toBe('hr');
  });

  test('an Admin cannot demote or deactivate themselves, even with another Admin around', async () => {
    let { error } = await call(controller.update, { user: user(ADMIN), params: { id: ADMIN }, body: { role: 'hr' } });
    expect(error.statusCode).toBe(403);
    ({ error } = await call(controller.update, { user: user(ADMIN), params: { id: ADMIN }, body: { is_active: false } }));
    expect(error.statusCode).toBe(403);
    ({ error } = await call(controller.offboard, { user: user(ADMIN), params: { id: ADMIN }, body: {} }));
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe('You can\'t offboard yourself.');
    expect(stored(ADMIN)).toMatchObject({ role: 'admin', is_active: true });
  });

  test('a sole Admin cannot demote themselves either', async () => {
    const { error } = await call(controller.update, { user: user(SUB_ADMIN), params: { id: SUB_ADMIN }, body: { role: 'employee' } });
    expect(error.statusCode).toBe(403);
    expect(stored(SUB_ADMIN).role).toBe('admin');
  });

  test('HR cannot deactivate, offboard or erase themselves', async () => {
    let { error } = await call(controller.deactivate, { user: user(HR), params: { id: HR } });
    expect(error.statusCode).toBe(403);
    ({ error } = await call(controller.offboard, { user: user(HR), params: { id: HR }, body: {} }));
    expect(error.statusCode).toBe(403);
    stored(HR).employment_status = 'offboarded';
    ({ error } = await call(controller.permanentlyErase, {
      user: user(HR), params: { id: HR }, body: { confirm_employee_code: stored(HR).employee_code },
    }));
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe('You can\'t erase your own account.');
    expect(stored(HR)).toBeDefined();
  });

  test('an employee cannot give themselves a new role through the self-edit', async () => {
    const { error } = await call(controller.update, { user: user(EMPLOYEE), params: { id: EMPLOYEE }, body: { role: 'admin' } });
    expect(error.statusCode).toBe(403);
    expect(stored(EMPLOYEE)).toMatchObject({ role: 'employee', profile_self_edit_used: false });
  });
});
