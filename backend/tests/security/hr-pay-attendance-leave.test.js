/**
 * Audit, 20 Nov 2026 (P7): "only an Admin changes the pay of HR and Admin
 * users" had two gaps — a manual attendance entry (overtime is paid) and an
 * employee's leave balance (more leave, less loss of pay) only refused the
 * caller's own record, so two HR users could raise each other's pay. A manual
 * entry's times are also checked now. No database; services are stand-ins.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: (...a) => mockDb.current.from(...a) } }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/auditLog.service', () => ({ auditFromRequest: jest.fn(), logAudit: jest.fn(async () => {}) }));
jest.mock('../../src/services/attendance.service', () => ({ manualEntry: jest.fn(async (_by, body) => ({ id: 'att1', employee_id: body.employee_id })) }));
jest.mock('../../src/services/leave.service', () => ({
  setEmployeeAllocations: jest.fn(async () => ({ changes: [{ type: 'EL' }] })),
  getLeaveBalance: jest.fn(async () => []),
}));
jest.mock('../../src/services/tenant.service', () => ({
  getOrgEmployeeIds: async () => ['hr1', 'hr2', 'admin1', 'emp1'],
  getCompanyEmployeeIds: async () => ['hr1', 'hr2', 'admin1', 'emp1'],
  assertSameCompany: async () => true,
}));

const mockDb = { current: null };
const { makeFakeSupabase } = require('./helpers/fakeSupabase');
const attendanceService = require('../../src/services/attendance.service');
const leaveService = require('../../src/services/leave.service');
const attendanceController = require('../../src/controllers/attendance.controller');
const leaveController = require('../../src/controllers/leave.controller');
const { ForbiddenError, BadRequestError } = require('../../src/utils/errors');

const HR = { id: 'hr1', role: 'hr', company_id: 'c1' };
const ADMIN = { id: 'admin1', role: 'admin', company_id: 'c1' };

beforeEach(() => {
  mockDb.current = makeFakeSupabase({
    employees: [
      { id: 'hr1', role: 'hr' }, { id: 'hr2', role: 'hr' }, { id: 'admin1', role: 'admin' }, { id: 'emp1', role: 'employee' },
    ],
  });
  jest.clearAllMocks();
});

const run = async (handler, { user, body = {}, params = {} }) => {
  const req = { user, body, params, query: {}, headers: {}, ip: '127.0.0.1', get: () => undefined };
  const res = { status() { return res; }, json() { return res; } };
  const next = jest.fn();
  await handler(req, res, next);
  return next.mock.calls[0]?.[0] || null;
};

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const entry = (employeeId, overrides = {}) => ({ employee_id: employeeId, check_in_time: hoursAgo(10), check_out_time: hoursAgo(1), ...overrides });

describe('manual attendance entry', () => {
  test('HR can\'t enter another HR\'s or an Admin\'s attendance; an Admin can; HR still can for employees', async () => {
    expect(await run(attendanceController.manualEntry, { user: HR, body: entry('hr2') })).toBeInstanceOf(ForbiddenError);
    expect(await run(attendanceController.manualEntry, { user: HR, body: entry('admin1') })).toBeInstanceOf(ForbiddenError);
    expect(attendanceService.manualEntry).not.toHaveBeenCalled();
    expect(await run(attendanceController.manualEntry, { user: ADMIN, body: entry('hr2') })).toBeNull();
    expect(await run(attendanceController.manualEntry, { user: HR, body: entry('emp1') })).toBeNull();
    expect(attendanceService.manualEntry).toHaveBeenCalledTimes(2);
  });

  test('the times must make sense', async () => {
    const bad = [
      { check_out_time: hoursAgo(11) }, // before check-in
      { check_in_time: hoursAgo(30), check_out_time: hoursAgo(1) }, // 29-hour day
      { check_in_time: new Date(Date.now() + 3 * 3600e3).toISOString(), check_out_time: null }, // future
      { check_in_time: 'yesterday morning' },
      { break_minutes: -5 },
    ];
    for (const overrides of bad) {
      // eslint-disable-next-line no-await-in-loop
      expect(await run(attendanceController.manualEntry, { user: ADMIN, body: entry('emp1', overrides) })).toBeInstanceOf(BadRequestError);
    }
    expect(attendanceService.manualEntry).not.toHaveBeenCalled();
  });
});

describe('leave balance', () => {
  test('HR can\'t change another HR\'s leave balance; an Admin can; HR still can for employees', async () => {
    const body = { year: 2026, allocations: { EL: 60 } };
    expect(await run(leaveController.setBalance, { user: HR, body, params: { employeeId: 'hr2' } })).toBeInstanceOf(ForbiddenError);
    expect(leaveService.setEmployeeAllocations).not.toHaveBeenCalled();
    expect(await run(leaveController.setBalance, { user: ADMIN, body, params: { employeeId: 'hr2' } })).toBeNull();
    expect(await run(leaveController.setBalance, { user: HR, body, params: { employeeId: 'emp1' } })).toBeNull();
    expect(leaveService.setEmployeeAllocations).toHaveBeenCalledTimes(2);
  });
});
