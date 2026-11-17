/**
 * Security audit finding #1: biometric punches (eSSL push / ADMS,
 * POST /iclock/cdata) were accepted on the device serial alone — and the
 * serial is printed on the device. The protocol can't carry a login or a
 * custom header, so each registered device is now pinned to the public IP it
 * reports from: the first request pins it, a request from any other IP is
 * refused ("NOK", which the device treats as a failed upload — it keeps the
 * punches and resends them) and held for an Admin to allow.
 *
 * Requests go through the real /iclock router on an Express app set up like
 * production (trust proxy 1 behind nginx). No database and no .env.
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
const admsController = require('../../src/controllers/adms.controller');
const { ConflictError, NotFoundError, BadRequestError } = require('../../src/utils/errors');

const SERIAL = 'NFZ8244800715';
const OFFICE_IP = '203.0.113.10';
const OTHER_IP = '198.51.100.20';
const CF_EDGE = '172.70.1.2';

const buildApp = () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/iclock', require('../../src/routes/adms.routes'));
  return app;
};

/** One ATTLOG line in device-local IST, `offsetMinutes` from now. */
const punchLine = (userId, offsetMinutes) => {
  const at = moment().tz('Asia/Kolkata').add(offsetMinutes, 'minutes').format('YYYY-MM-DD HH:mm:ss');
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

const row = () => tables.device_heartbeats.find((d) => d.device_serial === SERIAL);
const warnings = () => logger.warn.mock.calls.map((c) => String(c[0]));

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

  test('is refused with NOK, saves nothing, records the pending IP, emails the admins once and logs it', async () => {
    const res = await push(app, { ip: OTHER_IP });
    expect(res.status).toBe(403);
    expect(res.text).toBe('NOK');
    expect(tables.device_punches).toHaveLength(0);
    expect(row()).toMatchObject({ allowed_ip: OFFICE_IP, pending_ip: OTHER_IP });
    expect(row().pending_ip_seen_at).toBeTruthy();

    expect(mockMail.sent).toHaveLength(1);
    expect(mockMail.sent[0]).toMatchObject({ type: 'adms_device_new_ip', to: 'owner@acme.test' });
    expect(mockMail.sent[0].html).toContain(OTHER_IP);
    expect(warnings().some((w) => w.includes(`pinned to ${OFFICE_IP} but called from ${OTHER_IP}`))).toBe(true);

    // The device retries: still refused, no second email, no platform alert.
    const again = await push(app, { ip: OTHER_IP });
    expect(again.status).toBe(403);
    expect(mockMail.sent).toHaveLength(1);
    expect(mockMail.sent.some((m) => m.type === 'adms_unauthorized_alert')).toBe(false);
  });

  test('the pinned IP keeps working meanwhile', async () => {
    await push(app, { ip: OTHER_IP });
    const res = await push(app, { ip: OFFICE_IP });
    expect(res.status).toBe(200);
    expect(tables.device_punches).toHaveLength(1);
  });

  test('a heartbeat from the new IP does not mark the device online and gets no command', async () => {
    const res = await heartbeat(app, { ip: OTHER_IP });
    expect(res.text).toBe('OK');
    expect(row().last_seen_at).toBeNull();
    expect(row().pending_ip).toBe(OTHER_IP);
  });
});

describe('Allow new IP / Re-learn IP', () => {
  beforeEach(() => {
    Object.assign(row(), { allowed_ip: OFFICE_IP, pending_ip: OTHER_IP, pending_ip_seen_at: '2026-11-17T04:00:00.000Z' });
  });

  const call = async (handler, { serial = SERIAL, companyId = 'c1', body = {} } = {}) => {
    const req = { params: { serial }, body, user: { id: 'admin1', role: 'admin', company_id: companyId }, ip: '127.0.0.1', headers: {} };
    let payload = null;
    const res = { status() { return res; }, json(p) { payload = p; return res; } };
    const next = jest.fn();
    await handler(req, res, next);
    return { payload, error: next.mock.calls[0]?.[0] || null };
  };

  test('Allow new IP moves the pending IP to allowed, and punches from it are then accepted', async () => {
    const { payload, error } = await call(admsController.allowDeviceNewIp, { body: { ip: OTHER_IP } });
    expect(error).toBeNull();
    expect(payload.success).toBe(true);
    expect(row()).toMatchObject({ allowed_ip: OTHER_IP, pending_ip: null, pending_ip_seen_at: null });
    expect(mockAudit[0][1]).toMatchObject({ actionType: 'biometric_device.allow_new_ip', beforeState: { allowed_ip: OFFICE_IP }, afterState: { allowed_ip: OTHER_IP } });

    const res = await push(app, { ip: OTHER_IP });
    expect(res.status).toBe(200);
    expect(tables.device_punches).toHaveLength(1);
    const old = await push(app, { ip: OFFICE_IP, body: punchLine(1, -30) });
    expect(old.status).toBe(403);
  });

  test('allowing an IP other than the one waiting changes nothing', async () => {
    const { error } = await call(admsController.allowDeviceNewIp, { body: { ip: '192.0.2.99' } });
    expect(error).toBeInstanceOf(ConflictError);
    expect(row().allowed_ip).toBe(OFFICE_IP);

    const missing = await call(admsController.allowDeviceNewIp, { body: {} });
    expect(missing.error).toBeInstanceOf(BadRequestError);
  });

  test('another company cannot allow or reset this device', async () => {
    const allow = await call(admsController.allowDeviceNewIp, { companyId: 'c2', body: { ip: OTHER_IP } });
    expect(allow.error).toBeInstanceOf(NotFoundError);
    const relearn = await call(admsController.relearnDeviceIp, { companyId: 'c2' });
    expect(relearn.error).toBeInstanceOf(NotFoundError);
    expect(row()).toMatchObject({ allowed_ip: OFFICE_IP, pending_ip: OTHER_IP });
  });

  test('Re-learn IP clears the pin, and the next request pins a new one', async () => {
    const { error } = await call(admsController.relearnDeviceIp);
    expect(error).toBeNull();
    expect(row()).toMatchObject({ allowed_ip: null, pending_ip: null, ip_pinned_at: null });

    const res = await push(app, { ip: '192.0.2.50' });
    expect(res.status).toBe(200);
    expect(row().allowed_ip).toBe('192.0.2.50');
  });

  test('both actions sit behind HR/Admin and the biometric feature, like device registration', () => {
    const router = require('../../src/routes/attendance.routes');
    const routeFor = (path) => router.stack.find((l) => l.route?.path === path)?.route;
    for (const path of ['/adms/devices/:serial/allow-new-ip', '/adms/devices/:serial/relearn-ip']) {
      const route = routeFor(path);
      expect(route?.methods).toEqual({ post: true });
      const register = routeFor('/adms/devices/:serial');
      // Same guards as the register route: authenticate (router-wide), isHROrAdmin, requireFeature('biometric_adms').
      expect(route.stack.length).toBe(register.stack.length);
    }
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
