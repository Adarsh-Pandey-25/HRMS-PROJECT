const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/whatsappInbound.service', () => ({ processWebhook: jest.fn(async () => {}) }));

const inbound = require('../../src/services/whatsappInbound.service');
const router = require('../../src/routes/whatsappWebhook.routes');
const { isSignedByMeta } = require('../../src/controllers/whatsappWebhook.controller');

const SECRET = 'app-secret-for-tests';
const sign = (body, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
const flush = () => new Promise((resolve) => setImmediate(resolve));

const app = express();
app.use('/api/whatsapp/webhook', router);

beforeEach(() => {
  process.env.WHATSAPP_ENABLED = 'true';
  process.env.WHATSAPP_APP_SECRET = SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me';
  inbound.processWebhook.mockClear();
});
afterAll(() => {
  ['WHATSAPP_ENABLED', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'].forEach((k) => delete process.env[k]);
});

describe('WhatsApp webhook', () => {
  test('answers Meta’s verification with the challenge when the verify token matches', async () => {
    const res = await request(app).get('/api/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '1158201444' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('1158201444');
  });

  test('refuses verification with a wrong token', async () => {
    const res = await request(app).get('/api/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': '1' });
    expect(res.status).toBe(403);
  });

  test('refuses an unsigned delivery and does not read it', async () => {
    const res = await request(app).post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .send('{"entry":[]}');
    expect(res.status).toBe(401);
    expect(inbound.processWebhook).not.toHaveBeenCalled();
  });

  test('refuses a delivery signed with another secret', async () => {
    const body = '{"entry":[]}';
    const res = await request(app).post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(body, 'someone-else'))
      .send(body);
    expect(res.status).toBe(401);
    expect(inbound.processWebhook).not.toHaveBeenCalled();
  });

  test('accepts a correctly signed delivery, answers at once and processes it', async () => {
    const payload = { object: 'whatsapp_business_account', entry: [{ changes: [] }] };
    const body = JSON.stringify(payload);
    const res = await request(app).post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(body))
      .send(body);
    expect(res.status).toBe(200);
    await flush();
    expect(inbound.processWebhook).toHaveBeenCalledWith(payload);
  });

  test('does nothing while WhatsApp is switched off', async () => {
    process.env.WHATSAPP_ENABLED = '';
    const body = '{}';
    const res = await request(app).post('/api/whatsapp/webhook')
      .set('X-Hub-Signature-256', sign(body))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(404);
    const verify = await request(app).get('/api/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '1' });
    expect(verify.status).toBe(403);
  });

  test('isSignedByMeta checks the exact bytes', () => {
    const body = Buffer.from('{"a":1}');
    expect(isSignedByMeta(body, sign(body), SECRET)).toBe(true);
    expect(isSignedByMeta(Buffer.from('{"a":2}'), sign(body), SECRET)).toBe(false);
    expect(isSignedByMeta(body, undefined, SECRET)).toBe(false);
    expect(isSignedByMeta(body, sign(body), '')).toBe(false);
  });
});
