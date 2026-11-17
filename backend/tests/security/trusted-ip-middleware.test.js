// req.ip is the real visitor for the whole app (audit log, login records,
// rate limits), never the Cloudflare edge and never a forged header.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));

const express = require('express');
const request = require('supertest');
const { useTrustedClientIp, getTrustedClientIp } = require('../../src/utils/helpers');

const EDGE = '172.70.1.2'; // inside Cloudflare's 172.64.0.0/13
const HOME = '49.36.10.20';
const OFFICE = '203.0.113.7';

// Production shape: nginx appends its peer to X-Forwarded-For, trust proxy 1.
const app = (seenByNginx) => {
  const a = express();
  a.set('trust proxy', 1);
  a.use((req, _res, next) => {
    const xff = req.headers['x-forwarded-for'];
    req.headers['x-forwarded-for'] = xff ? `${xff}, ${seenByNginx}` : seenByNginx;
    next();
  });
  a.use(useTrustedClientIp);
  a.get('/', (req, res) => res.json({ ip: req.ip, again: getTrustedClientIp(req) }));
  return a;
};

test('through Cloudflare: req.ip is the visitor from CF-Connecting-IP', async () => {
  const res = await request(app(EDGE)).get('/').set('CF-Connecting-IP', HOME);
  expect(res.body).toEqual({ ip: HOME, again: HOME });
});

test('forged headers from home never become req.ip', async () => {
  const res = await request(app(EDGE)).get('/')
    .set('CF-Connecting-IP', HOME)
    .set('X-Forwarded-For', OFFICE)
    .set('X-Client-IP', OFFICE)
    .set('True-Client-IP', OFFICE)
    .set('X-Real-IP', OFFICE);
  expect(res.body.ip).toBe(HOME);
});

test('straight to the origin: a forged CF-Connecting-IP is ignored', async () => {
  const res = await request(app(HOME)).get('/').set('CF-Connecting-IP', OFFICE);
  expect(res.body).toEqual({ ip: HOME, again: HOME });
});
