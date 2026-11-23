/**
 * Owner's bug report, 23 Nov 2026: an employee added to a subsidiary could
 * not be mapped to the parent office's biometric machine ("Employee not
 * found"), and their punches would have been dropped as another company's.
 * A machine's company and its subsidiaries now share it; any other company
 * still can't. In-memory database only.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: (...a) => mockDb.current.from(...a) } }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/tenant.service', () => ({
  getOrgCompanyIds: async (id) => ({ parent: ['parent', 'child'], child: ['child'], other: ['other'] }[id] || [id]),
}));
jest.mock('../../src/services/attendance.service', () => ({
  getAttendanceConfig: async () => ({ shifts: [] }),
  resolveShiftStart: () => '09:30',
  getEmployeeShiftStart: async () => '09:30',
  recomputeBiometricWindow: jest.fn(async () => {}),
}));
jest.mock('../../src/services/auditLog.service', () => ({ auditFromRequest: jest.fn(), logAudit: async () => {} }));
jest.mock('../../src/services/featureOverride.service', () => ({ hasFeature: async () => true, getDataCollectionMode: async () => 'continue' }));
jest.mock('../../src/services/settings.service', () => ({ getSetting: async () => null, setSetting: async () => ({ error: null }) }));
jest.mock('../../src/services/emailRecipients.service', () => ({ getPlatformAlertTo: async () => 'ops@spaxsync.test' }));
jest.mock('../../src/services/email.service', () => ({ sendEmail: jest.fn(async () => ({ success: true })) }));

const mockDb = { current: null };

const { makeFakeSupabase } = require('./helpers/fakeSupabase');
const controller = require('../../src/controllers/deviceMapping.controller');
const admsService = require('../../src/services/adms.service');
const { NotFoundError } = require('../../src/utils/errors');

const SERIAL = 'NFZ8244800715';
let tables;

beforeEach(() => {
  tables = {
    device_heartbeats: [{ device_serial: SERIAL, company_id: 'parent', claimed_at: null }],
    employees: [
      { id: 'e-parent', company_id: 'parent', first_name: 'Asha', last_name: 'P' },
      { id: 'e-child', company_id: 'child', first_name: 'Ravi', last_name: 'S' },
      { id: 'e-other', company_id: 'other', first_name: 'Neha', last_name: 'O' },
    ],
    device_employee_mapping: [],
    device_punches: [{ id: 'old1', device_serial: SERIAL, device_user_id: '12', employee_id: null, company_id: null, punch_time: '2026-11-21T03:45:00.000Z' }],
  };
  mockDb.current = makeFakeSupabase(tables);
});

const map = async (employeeId, deviceUserId = '12') => {
  const req = { body: { device_user_id: deviceUserId, employee_id: employeeId, device_serial: SERIAL }, user: { id: 'hr1', role: 'hr', company_id: 'parent' }, headers: {} };
  let payload = null;
  const res = { status() { return res; }, json(p) { payload = p; return res; } };
  const next = jest.fn();
  await controller.create(req, res, next);
  return { payload, error: next.mock.calls[0]?.[0] || null };
};

test('the parent company maps a subsidiary employee to its machine; their earlier punches move to the subsidiary', async () => {
  const { payload, error } = await map('e-child');
  expect(error).toBeNull();
  expect(payload.success).toBe(true);
  expect(tables.device_employee_mapping).toEqual([expect.objectContaining({ device_user_id: '12', employee_id: 'e-child', device_serial: SERIAL })]);
  expect(tables.device_punches[0]).toMatchObject({ employee_id: 'e-child', company_id: 'child' });
});

test('an employee of an unrelated company still can\'t be mapped', async () => {
  const { error } = await map('e-other');
  expect(error).toBeInstanceOf(NotFoundError);
  expect(tables.device_employee_mapping).toHaveLength(0);
});

test('live punches: a subsidiary employee\'s are saved to the subsidiary; an unrelated company\'s are dropped', async () => {
  tables.device_employee_mapping.push(
    { device_serial: SERIAL, device_user_id: '12', employee_id: 'e-child', employees: { company_id: 'child' } },
    { device_serial: SERIAL, device_user_id: '99', employee_id: 'e-other', employees: { company_id: 'other' } },
  );
  const at = new Date(Date.now() - 60 * 1000).toISOString();
  await admsService.savePunches([
    { device_user_id: '12', punch_time: at, punch_type: 'checkin', device_serial: SERIAL },
    { device_user_id: '99', punch_time: at, punch_type: 'checkin', device_serial: SERIAL },
  ], SERIAL, 'parent');
  const saved = tables.device_punches.filter((p) => p.punch_time === at);
  expect(saved).toEqual([expect.objectContaining({ device_user_id: '12', employee_id: 'e-child', company_id: 'child' })]);
});
