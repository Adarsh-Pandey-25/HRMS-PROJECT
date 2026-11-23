/**
 * Security audit finding #1: biometric punches (eSSL push / ADMS,
 * POST /iclock/cdata) were accepted on the device serial alone — and the
 * serial is printed on the device. The protocol can't carry a login or a
 * custom header, so each registered device is pinned to the public IP it
 * reports from: the first request pins it, and a request from any other IP
 * waits for someone to decide.
 *
 * Owner's rules, 20 Nov 2026 (admsIpApproval.service.js): a device's punches
 * from a new IP are kept, not refused (the device didn't always send refused
 * punches again), one request per device and IP. Approve: they count, at
 * their own times, but only from when the device was last seen on its
 * allowed IP. Reject: they are deleted. Approve / Reject buttons on WhatsApp
 * only for approvers who connected WhatsApp themselves. Before the migration
 * runs a push from a new IP is refused with "NOK", as before. Punches the
 * server never received can be added from the machine's own file (USB).
 *
 * Requests go through the real /iclock router on an Express app set up like
 * production (trust proxy 1 behind nginx). No database, no .env, and nothing
 * is sent on WhatsApp (the outbox is a stand-in).
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: (...a) => mockDb.current.from(...a) } }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/email.service', () => ({ sendEmail: (...a) => mockMail.send(...a) }));
jest.mock('../../src/services/emailRecipients.service', () => ({
  getAdminEmailRecipients: async (companyId) => (companyId === 'c1' ? [{ email: 'owner@acme.test', role: 'admin' }] : []),
  getHrEmailRecipients: async () => [],
  getPlatformAlertTo: async () => 'ops@spaxsync.test',
}));
jest.mock('../../src/services/settings.service', () => {
  const store = new Map();
  return {
    getSetting: async (key) => (store.has(key) ? store.get(key) : null),
    setSetting: async (key, value) => { store.set(key, value); return { data: null, error: null }; },
    __reset: () => store.clear(),
  };
});
jest.mock('../../src/services/featureOverride.service', () => ({ hasFeature: async () => true, getDataCollectionMode: async () => 'continue' }));
jest.mock('../../src/services/auditLog.service', () => ({ auditFromRequest: (...a) => mockAudit.push(a), logAudit: async () => {} }));
jest.mock('../../src/services/attendance.service', () => ({
  getEmployeeShiftStart: async () => '09:30',
  recomputeBiometricWindow: async () => {},
}));
jest.mock('../../src/services/whatsappOutbox.service', () => ({ queueEvent: (...a) => mockOutbox.queueEvent(...a) }));

const mockOutbox = { queueEvent: jest.fn(async () => 1) };
const mockDb = { current: null };
const mockMail = { sent: [], send: async (m) => { mockMail.sent.push(m); return { success: true }; } };
const mockAudit = [];

const express = require('express');
const request = require('supertest');
const moment = require('moment-timezone');
const { makeFakeSupabase } = require('./helpers/fakeSupabase');
const logger = require('../../src/utils/logger');
const settingsService = require('../../src/services/settings.service');
const admsService = require('../../src/services/adms.service');
const ipApproval = require('../../src/services/admsIpApproval.service');
const admsController = require('../../src/controllers/adms.controller');
const {
  ConflictError, NotFoundError, BadRequestError, ForbiddenError,
} = require('../../src/utils/errors');

const SERIAL = 'NFZ8244800715';
const OFFICE_IP = '203.0.113.10';
const OTHER_IP = '198.51.100.20';
const THIRD_IP = '192.0.2.30';
const CF_EDGE = '172.70.1.2';
const IST = 'Asia/Kolkata';

const buildApp = () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/iclock', require('../../src/routes/adms.routes'));
  return app;
};

/** One ATTLOG line in device-local IST, `offsetMinutes` from now. */
const punchLine = (userId, offsetMinutes) => {
  const at = moment().tz(IST).add(offsetMinutes, 'minutes').format('YYYY-MM-DD HH:mm:ss');
  return `${userId}\t${at}\t0\t1`;
};

/** A push as nginx forwards it: the source IP is appended to X-Forwarded-For. */
const push = (app, { serial = SERIAL, ip = OFFICE_IP, body = punchLine(1, -60), query = '', headers = {} } = {}) => {
  let req = request(app)
    .post(`/iclock/cdata?SN=${encodeURIComponent(serial)}&table=ATTLOG${query}`)
    .set('X-Forwarded-For', ip)
    .set('Content-Type', 'text/plain');
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  return req.send(body);
};

const heartbeat = (app, { serial = SERIAL, ip = OFFICE_IP } = {}) =>
  request(app).get(`/iclock/getrequest?SN=${encodeURIComponent(serial)}`).set('X-Forwarded-For', ip);

const device = (overrides = {}) => ({
  device_serial: SERIAL,
  company_id: 'c1',
  name: 'Main Gate',
  location: 'Reception',
  device_secret: null,
  allowed_ip: null,
  pending_ip: null,
  pending_ip_seen_at: null,
  ip_pinned_at: null,
  last_seen_at: null,
  ...overrides,
});

let tables;
let app;

beforeEach(() => {
  tables = {
    device_heartbeats: [device()],
    device_employee_mapping: [{ device_serial: SERIAL, device_user_id: '1', employee_id: 'e1', employees: { company_id: 'c1' } }],
    device_punches: [],
  };
  mockDb.current = makeFakeSupabase(tables);
  mockMail.sent.length = 0;
  mockAudit.length = 0;
  settingsService.__reset();
  jest.clearAllMocks();
  app = buildApp();
});

afterEach(() => ipApproval._resetForTests());

const row = () => tables.device_heartbeats.find((d) => d.device_serial === SERIAL);
const warnings = () => logger.warn.mock.calls.map((c) => String(c[0]));

/** Runs a controller as a signed-in user; resolves with the JSON reply or the error passed to next(). */
const callAs = async (handler, { serial = SERIAL, body = {}, user = { id: 'admin1', role: 'admin', company_id: 'c1' } } = {}) => {
  const req = { params: { serial }, body, user, ip: '127.0.0.1', headers: {} };
  let payload = null;
  const res = { status() { return res; }, json(p) { payload = p; return res; } };
  const next = jest.fn();
  await handler(req, res, next);
  return { payload, error: next.mock.calls[0]?.[0] || null };
};

const settle = async () => { for (let i = 0; i < 25; i += 1) await new Promise((r) => setImmediate(r)); };

describe('pinning on first contact', () => {
  test('a registered device with no IP yet is pinned to the IP of its first push, and its punches are saved', async () => {
    const res = await push(app);
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
    expect(row().allowed_ip).toBe(OFFICE_IP);
    expect(row().ip_pinned_at).toBeTruthy();
    expect(tables.device_punches).toHaveLength(1);
    expect(tables.device_punches[0]).toMatchObject({ device_user_id: '1', employee_id: 'e1', company_id: 'c1' });
  });

  test('a heartbeat pins too, so the real device usually pins before anyone else can push', async () => {
    const res = await heartbeat(app);
    expect(res.text).toBe('OK\nGetRequest:ATTLOG');
    expect(row().allowed_ip).toBe(OFFICE_IP);
    expect(row().last_seen_at).toBeTruthy();
  });

  test('through Cloudflare the device pins to CF-Connecting-IP, never to the edge address', async () => {
    const noHeader = await push(app, { ip: CF_EDGE });
    expect(noHeader.status).toBe(403);
    expect(row().allowed_ip).toBeNull();

    const res = await push(app, { ip: CF_EDGE, headers: { 'CF-Connecting-IP': OFFICE_IP } });
    expect(res.status).toBe(200);
    expect(row().allowed_ip).toBe(OFFICE_IP);
  });

  test('a forged X-Forwarded-For entry does not choose the pinned IP', async () => {
    // Client sends "X-Forwarded-For: <office>", nginx appends the real source.
    await push(app, { ip: `${OFFICE_IP}, ${OTHER_IP}` });
    expect(row().allowed_ip).toBe(OTHER_IP);
  });
});

describe('a push from a different IP', () => {
  beforeEach(() => {
    Object.assign(row(), { allowed_ip: OFFICE_IP, ip_pinned_at: '2026-11-01T00:00:00.000Z' });
  });

  test('is kept, not counted (the device is told OK), opens a request for that IP, emails the admins once and logs it', async () => {
    const line = punchLine(1, -60);
    const res = await push(app, { ip: OTHER_IP, body: line });
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
    expect(tables.device_punches).toHaveLength(0);
    expect(tables.adms_kept_punches).toHaveLength(1);
    expect(tables.adms_kept_punches[0]).toMatchObject({ device_serial: SERIAL, company_id: 'c1', source_ip: OTHER_IP, device_user_id: '1' });
    expect(tables.adms_ip_requests).toHaveLength(1);
    expect(tables.adms_ip_requests[0]).toMatchObject({ status: 'pending', ip: OTHER_IP, previous_ip: OFFICE_IP, company_id: 'c1' });
    expect(tables.adms_ip_requests[0].window_start).toBeTruthy();
    expect(row()).toMatchObject({ allowed_ip: OFFICE_IP, pending_ip: OTHER_IP });

    expect(mockMail.sent).toHaveLength(1);
    expect(mockMail.sent[0]).toMatchObject({ type: 'adms_device_new_ip', to: 'owner@acme.test' });
    expect(mockMail.sent[0].html).toContain(OTHER_IP);
    expect(mockMail.sent[0].html).toContain('1 punch by 1 person');
    expect(mockMail.sent[0].html).toContain('kept, not counted');
    expect(warnings().some((w) => w.includes(`pinned to ${OFFICE_IP} but called from ${OTHER_IP}`))).toBe(true);

    // The device sends the same punch again: still one kept, one request, no second email, no platform alert.
    const again = await push(app, { ip: OTHER_IP, body: line });
    expect(again.status).toBe(200);
    expect(tables.adms_kept_punches).toHaveLength(1);
    expect(tables.adms_ip_requests).toHaveLength(1);
    expect(mockMail.sent).toHaveLength(1);
    expect(mockMail.sent.some((m) => m.type === 'adms_unauthorized_alert')).toBe(false);
  });

  test('the pinned IP keeps working meanwhile', async () => {
    await push(app, { ip: OTHER_IP });
    const res = await push(app, { ip: OFFICE_IP });
    expect(res.status).toBe(200);
    expect(tables.device_punches).toHaveLength(1);
  });

  test('a heartbeat from the new IP does not mark the device online and gets no command, but the approvers are asked at once', async () => {
    const res = await heartbeat(app, { ip: OTHER_IP });
    expect(res.text).toBe('OK');
    expect(row().last_seen_at).toBeNull();
    expect(row().pending_ip).toBe(OTHER_IP);
    expect(tables.adms_ip_requests).toHaveLength(1);
    expect(mockMail.sent).toHaveLength(1);
    expect(mockMail.sent[0].html).toContain('no punches yet');
  });
});

describe('deciding a new IP (owner\'s rules, 20 Nov 2026)', () => {
  // A serial per test keeps each test's rows apart.
  let serialNo = 0;
  const ADMIN_ID = 'a0000000-0000-4000-8000-000000000001';
  const HR_ID = 'a0000000-0000-4000-8000-000000000002';
  const admin = { id: ADMIN_ID, company_id: 'c1', role: 'admin', is_active: true, email: 'owner@acme.test', first_name: 'Asha', last_name: 'Admin' };
  const hr = { id: HR_ID, company_id: 'c1', role: 'hr', is_active: true, email: 'hr@acme.test', first_name: 'Hari', last_name: 'HR' };
  const asAdmin = { id: ADMIN_ID, role: 'admin', company_id: 'c1' };

  const addDevice = (overrides = {}) => {
    serialNo += 1;
    const serial = `KEEPTEST${serialNo}`;
    tables.device_heartbeats.push(device({ device_serial: serial, allowed_ip: OFFICE_IP, ip_pinned_at: '2026-11-01T00:00:00.000Z', ...overrides }));
    tables.device_employee_mapping.push(
      { device_serial: serial, device_user_id: '1', employee_id: 'e1', employees: { company_id: 'c1' } },
      { device_serial: serial, device_user_id: '2', employee_id: 'e2', employees: { company_id: 'c1' } },
    );
    return { serial, dev: () => tables.device_heartbeats.find((d) => d.device_serial === serial) };
  };
  const requestsFor = (serial) => (tables.adms_ip_requests || []).filter((r) => r.device_serial === serial);
  const pendingFor = (serial, ip) => requestsFor(serial).find((r) => r.ip === ip && r.status === 'pending');
  const keptFor = (serial) => (tables.adms_kept_punches || []).filter((k) => k.device_serial === serial);
  const punchesFor = (serial) => tables.device_punches.filter((p) => p.device_serial === serial);

  beforeEach(() => {
    tables.employees = [{ ...admin }, { ...hr }];
    // The Admin connected WhatsApp with their JOIN code; HR's number was typed in for them.
    tables.whatsapp_links = [
      { subject_type: 'employee', subject_id: ADMIN_ID, status: 'active', consent_source: 'whatsapp_join' },
      { subject_type: 'employee', subject_id: HR_ID, status: 'active', consent_source: 'hr_added' },
    ];
  });

  test('Approve on the website: the kept punches count, at the times they were made', async () => {
    const { serial, dev } = addDevice();
    const line = punchLine(1, -90);
    expect((await push(app, { serial, ip: OTHER_IP, body: line })).status).toBe(200);
    expect(punchesFor(serial)).toHaveLength(0);

    const { payload, error } = await callAs(admsController.allowDeviceNewIp, { serial, body: { ip: OTHER_IP }, user: asAdmin });
    expect(error).toBeNull();
    expect(payload.message).toContain('The punch kept since');
    await settle();
    expect(punchesFor(serial)).toHaveLength(1);
    expect(punchesFor(serial)[0]).toMatchObject({ device_user_id: '1', employee_id: 'e1', company_id: 'c1' });
    expect(punchesFor(serial)[0].punch_time).toBe(admsService.parseAttlogBody(line, serial)[0].punch_time);
    expect(keptFor(serial)[0].released_at).toBeTruthy();
    expect(dev()).toMatchObject({ allowed_ip: OTHER_IP, pending_ip: null });
    expect(requestsFor(serial)[0]).toMatchObject({ status: 'approved', decided_via: 'website', decided_by: ADMIN_ID });
    expect(mockAudit.some(([, e]) => e.actionType === 'biometric_device.allow_new_ip')).toBe(true);
  });

  test('Reject deletes the kept punches; if that IP keeps sending, its punches are kept again but not announced for 7 days', async () => {
    const { serial, dev } = addDevice();
    await push(app, { serial, ip: OTHER_IP });
    expect(mockMail.sent).toHaveLength(2); // the Admin and HR
    expect(mockOutbox.queueEvent).toHaveBeenCalledTimes(2); // with buttons, and without

    const { payload, error } = await callAs(admsController.rejectDeviceNewIp, { serial, body: { ip: OTHER_IP }, user: asAdmin });
    expect(error).toBeNull();
    expect(payload.message).toContain('Its punch was deleted');
    expect(keptFor(serial)).toHaveLength(0);
    expect(dev()).toMatchObject({ allowed_ip: OFFICE_IP, pending_ip: null });
    expect(requestsFor(serial)[0]).toMatchObject({ status: 'rejected', decided_via: 'website', decided_by: ADMIN_ID });
    expect(mockAudit.some(([, e]) => e.actionType === 'biometric_device.reject_new_ip')).toBe(true);

    const again = await push(app, { serial, ip: OTHER_IP, body: punchLine(1, -10) });
    expect(again.status).toBe(200);
    expect(keptFor(serial)).toHaveLength(1);
    expect(pendingFor(serial, OTHER_IP)).toBeTruthy();
    expect(mockMail.sent).toHaveLength(2);
    expect(mockOutbox.queueEvent).toHaveBeenCalledTimes(2);
    expect(punchesFor(serial)).toHaveLength(0);
    const listed = (await ipApproval.listRequests('c1')).find((r) => r.deviceSerial === serial);
    expect(listed).toMatchObject({ ip: OTHER_IP, previousIp: OFFICE_IP, kept: 1, people: 1 });
    expect(listed.rejectedBefore).toBeTruthy();

    // Rejecting an IP that isn't waiting changes nothing.
    const wrong = await callAs(admsController.rejectDeviceNewIp, { serial, body: { ip: '192.0.2.99' }, user: asAdmin });
    expect(wrong.error).toBeInstanceOf(ConflictError);
    expect(keptFor(serial)).toHaveLength(1);
  });

  test('each new IP is its own request; approving one never counts another IP\'s punches', async () => {
    const { serial, dev } = addDevice();
    await push(app, { serial, ip: OTHER_IP, body: punchLine(1, -30) });
    await push(app, { serial, ip: THIRD_IP, body: punchLine(2, -20) });
    expect(requestsFor(serial).filter((r) => r.status === 'pending').map((r) => r.ip).sort()).toEqual([OTHER_IP, THIRD_IP].sort());
    expect(mockMail.sent).toHaveLength(4); // both IPs announced, to the Admin and HR

    const { error } = await callAs(admsController.allowDeviceNewIp, { serial, body: { ip: OTHER_IP }, user: asAdmin });
    expect(error).toBeNull();
    await settle();
    expect(punchesFor(serial).map((p) => p.device_user_id)).toEqual(['1']);
    expect(pendingFor(serial, THIRD_IP)).toBeTruthy();
    expect(keptFor(serial).find((k) => k.source_ip === THIRD_IP).released_at).toBeFalsy();
    expect(dev().allowed_ip).toBe(OTHER_IP);
  });

  test('back-dated punches never count: only from an hour before the machine was last seen on its allowed IP', async () => {
    const { serial } = addDevice({ last_seen_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() });
    const body = [punchLine(1, -3 * 24 * 60), punchLine(1, -120), punchLine(1, -10)].join('\n');
    expect((await push(app, { serial, ip: OTHER_IP, body })).status).toBe(200);
    expect(keptFor(serial)).toHaveLength(1);
    expect(warnings().some((w) => w.includes('dated before it was last seen on its allowed IP'))).toBe(true);

    await callAs(admsController.allowDeviceNewIp, { serial, body: { ip: OTHER_IP }, user: asAdmin });
    await settle();
    expect(punchesFor(serial)).toHaveLength(1);
    expect(new Date(punchesFor(serial)[0].punch_time).getTime()).toBeGreaterThan(Date.now() - 20 * 60 * 1000);
  });

  test('the window goes back at most 7 days, and one day for a machine never seen', () => {
    const now = Date.parse('2026-11-20T06:00:00.000Z');
    const hours = (n) => n * 60 * 60 * 1000;
    expect(ipApproval.windowStartFor({ last_seen_at: null }, now)).toBe(new Date(now - hours(24)).toISOString());
    expect(ipApproval.windowStartFor({ last_seen_at: new Date(now - hours(2)).toISOString() }, now)).toBe(new Date(now - hours(3)).toISOString());
    expect(ipApproval.windowStartFor({ last_seen_at: new Date(now - hours(30 * 24)).toISOString() }, now)).toBe(new Date(now - hours(7 * 24)).toISOString());
  });

  test('the approvers see both IPs, the punches so far, and a warning when the machine was still online on its old IP', async () => {
    const { serial } = addDevice({ last_seen_at: new Date(Date.now() - 60 * 1000).toISOString() });
    await push(app, { serial, ip: OTHER_IP, body: [punchLine(1, -5), punchLine(2, -3)].join('\n') });
    const request = pendingFor(serial, OTHER_IP);
    const withButtons = mockOutbox.queueEvent.mock.calls.map((c) => c[0]).find((e) => e.template === 'approval_request');
    expect(withButtons).toMatchObject({
      eventKey: 'device_ip_approval',
      group: 'security',
      recordKey: request.id,
      action: { kind: 'device_ip', recordId: request.id },
      recipients: [{ subjectType: 'employee', subjectId: ADMIN_ID }],
    });
    const params = await withButtons.params({ person: { first_name: 'Asha' }, company: { name: 'Acme Ltd' } });
    expect(params.slice(0, 4)).toEqual([
      'Asha', 'the biometric machine Main Gate', 'Acme Ltd', `a new internet address ${OTHER_IP}; before: ${OFFICE_IP}`,
    ]);
    expect(params[4]).toMatch(/^Careful: it was online on the old address at /);
    expect(params[4]).toContain('2 punches by 2 people');
    expect(params[4]).toContain('Reject deletes them');
    expect(params[4].length).toBeLessThanOrEqual(200);
    expect(mockMail.sent[0].html).toContain('<strong>Careful:</strong>');
    expect(mockMail.sent[0].html).toContain('2 punches by 2 people');
  });

  test('Approve / Reject buttons go only to approvers who connected WhatsApp themselves; the rest get the message without buttons', async () => {
    const { serial } = addDevice();
    await push(app, { serial, ip: OTHER_IP });
    const events = mockOutbox.queueEvent.mock.calls.map((c) => c[0]);
    expect(events).toHaveLength(2);
    const buttons = events.find((e) => e.template === 'approval_request');
    const plain = events.find((e) => e.template === 'approval_waiting');
    expect(buttons.recipients).toEqual([{ subjectType: 'employee', subjectId: ADMIN_ID }]);
    expect(plain.recipients).toEqual([{ subjectType: 'employee', subjectId: HR_ID }]);
    expect(plain.action).toBeUndefined();
    expect(plain.eventKey).not.toBe(buttons.eventKey);
    const values = await plain.params({ person: { first_name: 'Hari' }, company: { name: 'Acme Ltd' } });
    expect(values).toHaveLength(4);
    expect(values[3]).toContain(OTHER_IP);
    expect(values[3]).toContain('1 punch by 1 person');
  });

  test('WhatsApp Approve counts the kept punches once; a second tap or another company finds nothing to do', async () => {
    const { serial, dev } = addDevice();
    await push(app, { serial, ip: OTHER_IP });
    const req = pendingFor(serial, OTHER_IP);

    const result = await ipApproval.decide(req.id, 'approve', { companyId: 'c1', decidedBy: ADMIN_ID, via: 'whatsapp' });
    expect(result).toMatchObject({ ip: OTHER_IP, device: 'Main Gate', kept: 1, people: 1 });
    await settle();
    expect(dev()).toMatchObject({ allowed_ip: OTHER_IP, pending_ip: null });
    expect(punchesFor(serial)).toHaveLength(1);
    expect(requestsFor(serial)[0]).toMatchObject({ status: 'approved', decided_via: 'whatsapp', decided_by: ADMIN_ID });

    await expect(ipApproval.decide(req.id, 'reject', { companyId: 'c1', decidedBy: ADMIN_ID, via: 'whatsapp' }))
      .rejects.toBeInstanceOf(ConflictError);
    await expect(ipApproval.decide(req.id, 'approve', { companyId: 'c2', decidedBy: 'x', via: 'whatsapp' }))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(punchesFor(serial)).toHaveLength(1);
  });

  test('an old WhatsApp message cannot undo a newer change; the website decides on what it shows now', async () => {
    const { serial, dev } = addDevice();
    await push(app, { serial, ip: OTHER_IP });
    const req = pendingFor(serial, OTHER_IP);
    // Meanwhile the machine was moved to a third IP.
    Object.assign(dev(), { allowed_ip: '192.0.2.77' });

    await expect(ipApproval.decide(req.id, 'approve', { companyId: 'c1', decidedBy: ADMIN_ID, via: 'whatsapp' }))
      .rejects.toBeInstanceOf(ConflictError);
    expect(dev().allowed_ip).toBe('192.0.2.77');
    expect(pendingFor(serial, OTHER_IP)).toBeTruthy();
    await settle();
    expect(punchesFor(serial)).toHaveLength(0);

    const { error } = await callAs(admsController.allowDeviceNewIp, { serial, body: { ip: OTHER_IP }, user: asAdmin });
    expect(error).toBeNull();
    expect(dev().allowed_ip).toBe(OTHER_IP);
  });

  test('at most 5 new IPs wait per machine; a sixth is refused (NOK) and nothing is kept from it', async () => {
    const { serial } = addDevice();
    const statuses = [];
    for (const ip of ['192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4', '192.0.2.5', '192.0.2.6']) {
      // eslint-disable-next-line no-await-in-loop
      statuses.push((await push(app, { serial, ip })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 403]);
    expect(requestsFor(serial)).toHaveLength(ipApproval.MAX_OPEN_REQUESTS_PER_DEVICE);
    expect(keptFor(serial).some((k) => k.source_ip === '192.0.2.6')).toBe(false);
  });

  test('at most 5,000 punches are kept from one IP; beyond that the push is refused', async () => {
    const { serial } = addDevice();
    await push(app, { serial, ip: OTHER_IP });
    const at = new Date().toISOString();
    for (let i = 0; i < ipApproval.MAX_KEPT_PER_IP; i += 1) {
      tables.adms_kept_punches.push({
        id: `k${i}`, device_serial: serial, company_id: 'c1', source_ip: OTHER_IP, device_user_id: `u${i}`, punch_time: at, released_at: null,
      });
    }
    const res = await push(app, { serial, ip: OTHER_IP, body: punchLine(2, -1) });
    expect(res.status).toBe(403);
  });

  test('lines longer than a real device sends are dropped, and the raw line kept is capped', () => {
    const at = moment().tz(IST).format('YYYY-MM-DD HH:mm:ss');
    const parsed = admsService.parseAttlogBody([
      `${'9'.repeat(40)}\t${at}\t0\t1`,
      `1\t${at}\t0\t1\t${'x'.repeat(400)}`,
      `1\t${at}\t0\t1\t${'x'.repeat(600)}`,
    ].join('\n'), SERIAL);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].raw_data).toHaveLength(255);
  });

  test('releasing a machine clears its waiting IPs and kept punches', async () => {
    const { serial } = addDevice();
    await push(app, { serial, ip: OTHER_IP });
    expect(keptFor(serial)).toHaveLength(1);
    const { error } = await callAs(admsController.releaseDevice, { serial, user: asAdmin });
    expect(error).toBeNull();
    expect(keptFor(serial)).toHaveLength(0);
    expect(requestsFor(serial)).toHaveLength(0);
  });

  test('on the website only an Admin or someone chosen to approve decides', async () => {
    const { serial, dev } = addDevice();
    await push(app, { serial, ip: OTHER_IP });
    await ipApproval.saveApprovers('c1', { roles: ['admin'], employeeIds: [] }, ADMIN_ID);
    const asHr = { id: HR_ID, role: 'hr', company_id: 'c1' };

    const allow = await callAs(admsController.allowDeviceNewIp, { serial, body: { ip: OTHER_IP }, user: asHr });
    expect(allow.error).toBeInstanceOf(ForbiddenError);
    const reject = await callAs(admsController.rejectDeviceNewIp, { serial, body: { ip: OTHER_IP }, user: asHr });
    expect(reject.error).toBeInstanceOf(ForbiddenError);
    expect(dev().allowed_ip).toBe(OFFICE_IP);
    expect(keptFor(serial)).toHaveLength(1);

    const byAdmin = await callAs(admsController.allowDeviceNewIp, { serial, body: { ip: OTHER_IP }, user: asAdmin });
    expect(byAdmin.error).toBeNull();
  });

  test('before the kept-punches migration runs, a push from a new IP is refused with NOK, as before', async () => {
    ipApproval._resetForTests();
    mockDb.current = makeFakeSupabase(tables, { missingTables: ['adms_kept_punches', 'adms_ip_requests'] });
    const { serial } = addDevice();
    const res = await push(app, { serial, ip: OTHER_IP });
    expect(res.status).toBe(403);
    expect(res.text).toBe('NOK');
    expect(mockMail.sent[0].html).toContain('being refused until it is allowed');
    expect(mockOutbox.queueEvent).not.toHaveBeenCalled();
  });

  test('anything but punches from a new IP is answered OK and ignored, as from the allowed IP', async () => {
    const { serial } = addDevice();
    const res = await push(app, { serial, ip: OTHER_IP, query: '&table=OPERLOG', body: 'OPLOG 4\t0\t2026-11-20 09:00:00' });
    expect(res.status).toBe(200);
    expect(keptFor(serial)).toHaveLength(0);
  });

  test('route guards: deciding needs what managing devices needs; Re-learn is gone; only an Admin changes the approvers or adds a file', () => {
    const router = require('../../src/routes/attendance.routes');
    const { isAdmin } = require('../../src/middleware/role.middleware');
    const routeFor = (path, method = 'post') => router.stack.find((l) => l.route?.path === path && l.route.methods[method])?.route;
    const guards = (route) => route.stack.slice(0, -1).map((l) => l.handle);
    const register = guards(routeFor('/adms/devices/:serial', 'put'));
    for (const path of ['/adms/devices/:serial/allow-new-ip', '/adms/devices/:serial/reject-new-ip']) {
      const these = guards(routeFor(path));
      expect(these).toHaveLength(register.length);
      // isHROrAdmin, Settings → manage, Attendance → manage: the very same checks.
      expect(these.slice(0, 3)).toEqual(register.slice(0, 3));
    }
    expect(guards(routeFor('/adms/ip-approvers', 'get')).slice(0, 3)).toEqual(register.slice(0, 3));
    expect(routeFor('/adms/devices/:serial/relearn-ip')).toBeUndefined();
    expect(guards(routeFor('/adms/ip-approvers', 'put'))[0]).toBe(isAdmin);
    expect(guards(routeFor('/adms/devices/:serial/import-punches'))[0]).toBe(isAdmin);
  });
});

describe('who approves a new IP (Settings → Attendance → Biometric Devices)', () => {
  const id = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const person = (n, role, extra = {}) => ({
    id: id(n), company_id: 'c1', role, is_active: true, email: `p${n}@acme.test`, first_name: `P${n}`, last_name: 'X', ...extra,
  });

  beforeEach(() => {
    tables.employees = [
      person(1, 'admin'), person(2, 'hr'), person(3, 'employee'), person(4, 'employee', { company_id: 'c2' }),
      person(5, 'employee', { is_active: false }),
    ];
  });

  test('by default every HR and Admin of the company', async () => {
    expect(await ipApproval.getApprovers('c1')).toEqual({ roles: ['admin', 'hr'], employeeIds: [] });
    expect((await ipApproval.approverEmployees('c1')).map((e) => e.id).sort()).toEqual([id(1), id(2)]);
  });

  test('anyone else can be ticked; only active people of the company are kept', async () => {
    const saved = await ipApproval.saveApprovers('c1', { roles: ['admin'], employeeIds: [id(3), id(4), id(5), 'not-an-id', id(3)] }, id(1));
    expect(saved).toEqual({ roles: ['admin'], employeeIds: [id(3)] });
    expect((await ipApproval.approverEmployees('c1')).map((e) => e.id).sort()).toEqual([id(1), id(3)]);
    expect(await ipApproval.isApprover(person(3, 'employee'))).toBe(true);
    expect(await ipApproval.isApprover(person(2, 'hr'))).toBe(false);
    expect(await ipApproval.isApprover(person(3, 'employee', { is_active: false }))).toBe(false);
  });

  test('someone must be chosen', async () => {
    await expect(ipApproval.saveApprovers('c1', { roles: [], employeeIds: [] }, id(1))).rejects.toBeInstanceOf(BadRequestError);
    await expect(ipApproval.saveApprovers('c1', { roles: [], employeeIds: [id(4)] }, id(1))).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe('punches from a file downloaded from the machine (USB)', () => {
  const day = (offset) => moment().tz(IST).add(offset, 'days').format('YYYY-MM-DD');
  const atIst = (date, time) => moment.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm:ss', IST).toISOString();
  // attlog.dat as a ZKTeco / eSSL machine writes it: the user ID padded with spaces.
  const attlog = (userId, date, time) => `${String(userId).padStart(9)}\t${date} ${time}\t1\t0\t1\t0`;
  const importFile = (body) => callAs(admsController.importDevicePunches, { body });

  beforeEach(() => {
    Object.assign(row(), { allowed_ip: OFFICE_IP });
    tables.device_employee_mapping.push({ device_serial: SERIAL, device_user_id: '12', employee_id: 'e12', employees: { company_id: 'c1' } });
  });

  test('a preview adds nothing and shows what would be added, per day', async () => {
    const yesterday = day(-1);
    const twoDaysAgo = day(-2);
    tables.device_punches.push({ device_serial: SERIAL, device_user_id: '1', punch_time: atIst(twoDaysAgo, '09:02:11') });
    const lines = [
      attlog(1, twoDaysAgo, '09:02:11'), // already in SpaxSync
      attlog(1, twoDaysAgo, '18:31:40'),
      attlog(12, yesterday, '09:15:00'),
      attlog(77, yesterday, '09:20:00'), // not linked to an employee
      attlog(1, day(-10), '09:00:00'), // outside the dates
      'not a punch',
    ];
    const { payload, error } = await importFile({ lines, from: twoDaysAgo, to: yesterday });
    expect(error).toBeNull();
    expect(payload.data).toMatchObject({
      readable: 5, unreadable: 1, inDates: 4, alreadyThere: 1, toAdd: 3, people: 3, notLinkedCount: 1, notLinked: ['77'], dryRun: true, saved: 0,
    });
    expect(payload.data.days).toEqual([{ date: twoDaysAgo, count: 1 }, { date: yesterday, count: 2 }]);
    expect(tables.device_punches).toHaveLength(1);
    expect(mockAudit).toHaveLength(0);
  });

  test('adding saves only the missing punches (zero-padded IDs matched to the machine\'s), and running it again adds nothing', async () => {
    const yesterday = day(-1);
    const lines = [attlog(1, yesterday, '09:02:11'), attlog(1, yesterday, '18:31:40'), attlog('000000012', yesterday, '10:00:00')];
    const { payload, error } = await importFile({ lines, from: yesterday, to: yesterday, dryRun: false });
    expect(error).toBeNull();
    expect(payload.data).toMatchObject({ toAdd: 3, saved: 3, notLinkedCount: 0 });
    expect(tables.device_punches).toHaveLength(3);
    expect(tables.device_punches.find((p) => p.device_user_id === '12')).toMatchObject({ employee_id: 'e12', company_id: 'c1' });
    expect(mockAudit.some(([, e]) => e.actionType === 'biometric_device.import_punches')).toBe(true);

    const again = await importFile({ lines, from: yesterday, to: yesterday, dryRun: false });
    expect(again.payload.data).toMatchObject({ alreadyThere: 3, toAdd: 0, saved: 0 });
    expect(tables.device_punches).toHaveLength(3);
  });

  test('an eSSL export with EnNo and DateTime columns is read too', () => {
    const { punches, unreadable } = admsService.parseImportedLines([
      'No\tMchn\tEnNo\tName\tMode\tIOMd\tDateTime',
      '1\t1\t00000012\tAsha\t1\t0\t2026/11/19  09:01:02',
    ], SERIAL);
    expect(unreadable).toBe(0);
    expect(punches).toHaveLength(1);
    expect(punches[0]).toMatchObject({ device_user_id: '00000012', punch_time: atIst('2026-11-19', '09:01:02') });
  });

  test('dates are limited: not in the future, at most 31 days, within the last 62', async () => {
    const lines = [attlog(1, day(-1), '09:00:00')];
    for (const [from, to] of [[day(0), day(1)], [day(-40), day(-1)], [day(-70), day(-65)], [day(-1), day(-3)], ['yesterday', day(-1)]]) {
      // eslint-disable-next-line no-await-in-loop
      const { error } = await importFile({ lines, from, to });
      expect(error).toBeInstanceOf(BadRequestError);
    }
    const another = await callAs(admsController.importDevicePunches, {
      body: { lines, from: day(-1), to: day(-1) }, user: { id: 'x', role: 'admin', company_id: 'c2' },
    });
    expect(another.error).toBeInstanceOf(NotFoundError);
  });
});

describe('unregistered serials stay rejected', () => {
  test('an unknown serial is refused and no row is created, for punches and heartbeats', async () => {
    const res = await push(app, { serial: 'UNKNOWN123' });
    expect(res.status).toBe(403);
    expect(res.text).toBe('NOK');
    const hb = await heartbeat(app, { serial: 'UNKNOWN123' });
    expect(hb.text).toBe('OK');
    expect(tables.device_heartbeats.map((d) => d.device_serial)).toEqual([SERIAL]);
    expect(tables.device_punches).toHaveLength(0);
  });

  test('a released serial (no company) is refused', async () => {
    Object.assign(row(), { company_id: null });
    const res = await push(app);
    expect(res.status).toBe(403);
    expect(tables.device_punches).toHaveLength(0);
    expect(row().allowed_ip).toBeNull();
  });

  test('a malformed serial is refused before any lookup', async () => {
    const before = mockDb.current.calls.length;
    const res = await push(app, { serial: '<a href="//evil.test">x</a>' });
    expect(res.status).toBe(403);
    expect(mockDb.current.calls.slice(before).filter((c) => c.table === 'device_heartbeats')).toHaveLength(0);
  });
});

describe('device secret', () => {
  beforeEach(() => {
    Object.assign(row(), { device_secret: 's3cret-value', allowed_ip: OFFICE_IP });
  });

  test('a secret in the query string is ignored', async () => {
    const res = await push(app, { query: '&device_secret=s3cret-value' });
    expect(res.status).toBe(401);
    expect(tables.device_punches).toHaveLength(0);
  });

  test('the X-Device-Secret header is accepted only when it matches', async () => {
    const wrong = await push(app, { headers: { 'X-Device-Secret': 's3cret-valuf' } });
    expect(wrong.status).toBe(401);
    const short = await push(app, { headers: { 'X-Device-Secret': 's3' } });
    expect(short.status).toBe(401);
    const right = await push(app, { headers: { 'X-Device-Secret': 's3cret-value' } });
    expect(right.status).toBe(200);
    expect(tables.device_punches).toHaveLength(1);
  });
});

describe('punch timestamps', () => {
  test('a punch more than 10 minutes in the future is refused and logged; the rest of the push is saved', async () => {
    Object.assign(row(), { allowed_ip: OFFICE_IP });
    const body = [punchLine(1, -60), punchLine(1, 120)].join('\n');
    const res = await push(app, { body });
    expect(res.status).toBe(200);
    expect(tables.device_punches).toHaveLength(1);
    expect(warnings().some((w) => w.includes('more than 10 minutes in the future'))).toBe(true);
  });

  test('old backlog is kept; up to 10 minutes ahead is tolerated', () => {
    const now = Date.parse('2026-11-17T06:00:00.000Z');
    const at = (ms) => ({ device_user_id: '1', punch_time: new Date(now + ms).toISOString() });
    const kept = admsService.dropFuturePunches([
      at(-3 * 24 * 3600 * 1000), at(5 * 60 * 1000), at(10 * 60 * 1000), at(11 * 60 * 1000),
    ], SERIAL, now);
    expect(kept).toHaveLength(3);
  });
});

describe('alert emails escape device-supplied text', () => {
  test('the new-IP email', () => {
    const { html } = admsService.deviceNewIpEmail({
      deviceSerial: SERIAL, name: '<script>alert(1)</script>', location: '"><img src=x onerror=alert(1)>', allowedIp: OFFICE_IP, newIp: '<b>1.2.3.4</b>',
    });
    expect(html).not.toMatch(/<script|<img|<b>1/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  test('the platform alerts for rejected requests and save failures', () => {
    const evil = '<a href="https://evil.test">Click</a>';
    const unauthorized = admsService.unauthorizedDeviceAlertEmail(evil, `bad ${evil}`, { ip: evil });
    expect(unauthorized.html).not.toContain('<a href');
    expect(unauthorized.html).toContain('&lt;a href=&quot;https://evil.test&quot;&gt;Click&lt;/a&gt;');
    expect(unauthorized.subject).toContain('unknown device');
    expect(unauthorized.subject).not.toContain('<a');

    const failure = admsService.saveFailureAlertEmail(evil, evil);
    expect(failure.html).not.toContain('<a href');
    expect(failure.subject).not.toContain('<a');
  });

  test('a rejected push with a link as its serial produces an escaped platform alert', async () => {
    await push(app, { serial: '<a href="https://evil.test">Open</a>' });
    await new Promise((r) => setImmediate(r));
    const alert = mockMail.sent.find((m) => m.type === 'adms_unauthorized_alert');
    expect(alert).toBeTruthy();
    expect(alert.html).not.toContain('<a href');
    expect(alert.html).toContain('&lt;a href=');
  });
});

describe('before the migration runs', () => {
  test('pushes are refused (the device keeps them) rather than accepted unpinned', async () => {
    mockDb.current = makeFakeSupabase(tables, { missingColumns: ['allowed_ip'] });
    const res = await push(app);
    expect(res.status).toBe(403);
    expect(tables.device_punches).toHaveLength(0);
    expect(logger.error.mock.calls.some((c) => String(c[0]).includes('20261117_adms_device_ip_pinning.sql'))).toBe(true);
  });
});

describe('per-IP rate limit on /iclock', () => {
  test('one address changing SN on every request is still limited', async () => {
    process.env.ADMS_IP_RATE_LIMIT_MAX = '3';
    let limitedApp;
    jest.isolateModules(() => {
      const express2 = require('express');
      limitedApp = express2();
      limitedApp.set('trust proxy', 1);
      limitedApp.use('/iclock', require('../../src/routes/adms.routes'));
    });
    delete process.env.ADMS_IP_RATE_LIMIT_MAX;

    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      statuses.push((await heartbeat(limitedApp, { serial: `PROBE${i}`, ip: OTHER_IP })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
    const otherAddress = await heartbeat(limitedApp, { serial: 'PROBE9', ip: OFFICE_IP });
    expect(otherAddress.status).toBe(200);
  });
});
