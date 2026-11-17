/**
 * Security audit finding #2: the office-network check-in trusted headers the
 * client can type. Behind nginx every forwarding header (X-Forwarded-For,
 * X-Real-IP, CF-Connecting-IP, True-Client-IP, X-Client-IP) was added to a
 * list of "client IPs", and a match on any one of them passed — so an
 * employee at home sent "X-Client-IP: <office IP>" and checked in as in the
 * office.
 *
 * Production traffic: Cloudflare -> SNI router -> nginx (real IP from the
 * PROXY protocol, X-Forwarded-For $proxy_add_x_forwarded_for) -> Express with
 * trust proxy 1. These tests build the same Express setting and send what
 * nginx would forward: the client's own X-Forwarded-For with nginx's
 * $remote_addr appended last.
 *
 * No database and no .env: dotenv and Supabase are stand-ins.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: (...a) => mockDb.current.from(...a) } }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/email.service', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()),
}));
jest.mock('../../src/services/featureOverride.service', () => ({ hasFeature: async () => true, getDataCollectionMode: async () => 'continue' }));
jest.mock('../../src/services/auditLog.service', () => ({ auditFromRequest: () => {}, logAudit: async () => {} }));

const mockDb = { current: null };

const express = require('express');
const request = require('supertest');
const { makeFakeSupabase } = require('./helpers/fakeSupabase');
const helpers = require('../../src/utils/helpers');
const { attachClientIp } = require('../../src/middleware/ipValidation.middleware');
const attendanceService = require('../../src/services/attendance.service');
const attendanceController = require('../../src/controllers/attendance.controller');

const OFFICE = '203.0.113.5'; // inside the company's whitelisted 203.0.113.0/24
const HOME = '198.51.100.7';
const CF_EDGE_V4 = '172.70.1.2'; // inside Cloudflare's 172.64.0.0/13
const CF_EDGE_V6 = '2606:4700:10::1'; // inside Cloudflare's 2606:4700::/32

const useWhitelist = (...cidrs) => {
  mockDb.current = makeFakeSupabase({
    ip_whitelist: cidrs.map((cidr) => ({ company_id: 'c1', cidr, is_active: true })),
  });
};

/** Express exactly as production runs it, with nginx's attachClientIp step and the real office check. */
const buildApp = () => {
  const app = express();
  app.set('trust proxy', 1);
  app.get('/check', attachClientIp, async (req, res) => {
    const result = await attendanceService.isOfficeIpAllowed(req.clientIp, 'c1');
    res.json({ ip: req.clientIp, ips: req.clientIps, ...result });
  });
  return app;
};

/** nginx appends the address it saw ($remote_addr) to whatever X-Forwarded-For the client sent. */
const viaNginx = (req, { remoteAddr, clientXff }) => req.set('X-Forwarded-For', clientXff ? `${clientXff}, ${remoteAddr}` : remoteAddr);

beforeEach(() => {
  useWhitelist('203.0.113.0/24');
  delete process.env.TRUSTED_PROXY_CIDRS;
});

describe('getTrustedClientIp', () => {
  const req = (ip, headers = {}) => ({ ip, headers });

  test('ignores X-Forwarded-For, X-Real-IP, True-Client-IP and X-Client-IP', () => {
    expect(helpers.getTrustedClientIp(req(HOME, {
      'x-forwarded-for': OFFICE, 'x-real-ip': OFFICE, 'true-client-ip': OFFICE, 'x-client-ip': OFFICE,
    }))).toBe(HOME);
  });

  test('ignores CF-Connecting-IP from a peer that is not Cloudflare', () => {
    expect(helpers.getTrustedClientIp(req(HOME, { 'cf-connecting-ip': OFFICE }))).toBe(HOME);
  });

  test('uses CF-Connecting-IP when the peer is a Cloudflare edge (IPv4 and IPv6)', () => {
    expect(helpers.getTrustedClientIp(req(CF_EDGE_V4, { 'cf-connecting-ip': OFFICE }))).toBe(OFFICE);
    expect(helpers.getTrustedClientIp(req(CF_EDGE_V6, { 'cf-connecting-ip': '2001:db8:1::5' }))).toBe('2001:db8:1::5');
  });

  test('a Cloudflare peer with no usable CF-Connecting-IP falls back to the peer', () => {
    expect(helpers.getTrustedClientIp(req(CF_EDGE_V4))).toBe(CF_EDGE_V4);
    expect(helpers.getTrustedClientIp(req(CF_EDGE_V4, { 'cf-connecting-ip': 'not-an-ip' }))).toBe(CF_EDGE_V4);
    expect(helpers.getTrustedClientIp(req(CF_EDGE_V4, { 'cf-connecting-ip': `${OFFICE}, ${HOME}` }))).toBe(CF_EDGE_V4);
  });

  test('normalises ::ffff: IPv4-mapped addresses, for the peer and the header', () => {
    expect(helpers.getTrustedClientIp(req(`::ffff:${HOME}`))).toBe(HOME);
    expect(helpers.getTrustedClientIp(req(`::ffff:${CF_EDGE_V4}`, { 'cf-connecting-ip': `::ffff:${OFFICE}` }))).toBe(OFFICE);
  });

  test('TRUSTED_PROXY_CIDRS adds proxies whose CF-Connecting-IP is believed', () => {
    expect(helpers.getTrustedClientIp(req('192.0.2.10', { 'cf-connecting-ip': OFFICE }))).toBe('192.0.2.10');
    process.env.TRUSTED_PROXY_CIDRS = '192.0.2.0/24, 2001:db8:ffff::/48';
    expect(helpers.getTrustedClientIp(req('192.0.2.10', { 'cf-connecting-ip': OFFICE }))).toBe(OFFICE);
    expect(helpers.getTrustedClientIp(req('2001:db8:ffff::9', { 'cf-connecting-ip': OFFICE }))).toBe(OFFICE);
  });

  test('getClientIps / getClientIp (kept for older callers) return only the trusted IP', () => {
    const forged = req(HOME, { 'x-forwarded-for': `${OFFICE}, 10.0.0.1`, 'x-client-ip': OFFICE });
    expect(helpers.getClientIps(forged)).toEqual([HOME]);
    expect(helpers.getClientIp(forged)).toBe(HOME);
  });
});

describe('office-network check through Express (trust proxy 1, behind nginx)', () => {
  test('an employee at home forging X-Client-IP / True-Client-IP / X-Real-IP / X-Forwarded-For is refused', async () => {
    const res = await viaNginx(request(buildApp()).get('/check'), { remoteAddr: HOME, clientXff: OFFICE })
      .set('X-Client-IP', OFFICE)
      .set('True-Client-IP', OFFICE)
      .set('X-Real-IP', OFFICE);
    expect(res.body).toMatchObject({ ip: HOME, ips: [HOME], ok: false, reason: 'no_match' });
  });

  test('CF-Connecting-IP sent straight to the origin (not through Cloudflare) is ignored', async () => {
    const res = await viaNginx(request(buildApp()).get('/check'), { remoteAddr: HOME }).set('CF-Connecting-IP', OFFICE);
    expect(res.body).toMatchObject({ ip: HOME, ok: false });
  });

  test('through Cloudflare, the office IP in CF-Connecting-IP passes and a home IP does not', async () => {
    const inOffice = await viaNginx(request(buildApp()).get('/check'), { remoteAddr: CF_EDGE_V4, clientXff: HOME })
      .set('CF-Connecting-IP', OFFICE);
    expect(inOffice.body).toMatchObject({ ip: OFFICE, ok: true, reason: 'matched' });

    const atHome = await viaNginx(request(buildApp()).get('/check'), { remoteAddr: CF_EDGE_V4, clientXff: OFFICE })
      .set('CF-Connecting-IP', HOME);
    expect(atHome.body).toMatchObject({ ip: HOME, ok: false });
  });

  test('a direct visit from the office still passes', async () => {
    const res = await viaNginx(request(buildApp()).get('/check'), { remoteAddr: OFFICE });
    expect(res.body).toMatchObject({ ip: OFFICE, ok: true });
  });

  test('IPv6: office range matches through Cloudflare, directly, and a forged header does not', async () => {
    useWhitelist('2001:db8:1::/48');
    const viaCf = await viaNginx(request(buildApp()).get('/check'), { remoteAddr: CF_EDGE_V6 }).set('CF-Connecting-IP', '2001:db8:1::5');
    expect(viaCf.body).toMatchObject({ ip: '2001:db8:1::5', ok: true });

    const direct = await viaNginx(request(buildApp()).get('/check'), { remoteAddr: '2001:db8:1::5' });
    expect(direct.body).toMatchObject({ ip: '2001:db8:1::5', ok: true });

    const forged = await viaNginx(request(buildApp()).get('/check'), { remoteAddr: '2001:db8:9::1', clientXff: '2001:db8:1::5' })
      .set('X-Client-IP', '2001:db8:1::5');
    expect(forged.body).toMatchObject({ ip: '2001:db8:9::1', ok: false });
  });

  test('IPv4-mapped IPv6 from nginx (::ffff:a.b.c.d) matches an IPv4 whitelist', async () => {
    const res = await viaNginx(request(buildApp()).get('/check'), { remoteAddr: `::ffff:${OFFICE}` });
    expect(res.body).toMatchObject({ ip: OFFICE, ok: true });
  });

  test('a whitelisted Cloudflare edge address never counts as the office', async () => {
    // The check-in page used to show the edge address as "your IP", so a whitelist may hold one.
    useWhitelist(`${CF_EDGE_V4}/32`);
    const res = await viaNginx(request(buildApp()).get('/check'), { remoteAddr: CF_EDGE_V4 });
    expect(res.body).toMatchObject({ ip: CF_EDGE_V4, ok: false });
  });
});

describe('isOfficeIpAllowed', () => {
  test('ignores any list of IPs passed alongside the trusted one', async () => {
    const result = await attendanceService.isOfficeIpAllowed(HOME, 'c1', [OFFICE]);
    expect(result).toEqual({ ok: false, reason: 'no_match' });
  });
});

describe('attendance controller', () => {
  afterEach(() => jest.restoreAllMocks());

  test('check-in hands the service only the trusted IP, whatever the body or headers say', async () => {
    const spy = jest.spyOn(attendanceService, 'checkIn').mockResolvedValue({ id: 'a1' });
    const req = {
      ip: HOME,
      headers: { 'x-client-ip': OFFICE, 'x-forwarded-for': OFFICE, 'cf-connecting-ip': OFFICE },
      body: { method: 'web', clientIp: OFFICE, clientIps: [OFFICE] },
      user: { id: 'e1', company_id: 'c1' },
      authType: 'jwt',
    };
    const res = { status: () => res, json: () => res };
    const next = jest.fn();
    await attendanceController.checkIn(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith('e1', expect.objectContaining({ clientIp: HOME }));
  });

  test('check-out records the trusted IP too', async () => {
    const spy = jest.spyOn(attendanceService, 'checkOut').mockResolvedValue({ id: 'a1' });
    const req = {
      ip: CF_EDGE_V4,
      headers: { 'cf-connecting-ip': OFFICE, 'x-client-ip': HOME },
      body: { method: 'web' },
      clientIp: HOME, // whatever an earlier step set, the controller resolves it again
      user: { id: 'e1', company_id: 'c1' },
      authType: 'jwt',
    };
    const res = { status: () => res, json: () => res };
    await attendanceController.checkOut(req, res, jest.fn());
    expect(spy).toHaveBeenCalledWith('e1', expect.objectContaining({ clientIp: OFFICE }));
  });
});
