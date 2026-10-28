const { makeFakeSupabase } = require('./fakeSupabase');

let mockDb;
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: new Proxy({}, { get: (_t, prop) => mockDb[prop] }) }));
jest.mock('../../src/config/database', () => ({ env: 'test', timezone: 'Asia/Kolkata' }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/whatsappApi', () => {
  const actual = jest.requireActual('../../src/services/whatsappApi');
  return { ...actual, sendTemplate: jest.fn() };
});
jest.mock('../../src/services/whatsappSettings.service', () => ({
  setPaused: jest.fn(async () => ({ paused: true })),
  getPlatformState: jest.fn(async () => ({ paused: false })),
}));

const api = require('../../src/services/whatsappApi');
const settings = require('../../src/services/whatsappSettings.service');
const worker = require('../../src/services/whatsappWorker');

const PHONE = '919876543210';
const row = (fields = {}) => ({
  id: 'w1', subject_type: 'employee', subject_id: 'e1', recipient: PHONE, recipient_kind: 'phone',
  template: 'leave_approved', message_group: 'leave', event_key: 'leave_approved', attempts: 1,
  params: ['Priya', 'Casual Leave', '3–4 Nov 2026', 'Rahul', 'Spaxads'], status: 'sending',
  ...fields,
});

const cfg = () => require('../../src/config/whatsapp').getConfig();

beforeEach(() => {
  process.env.NODE_ENV = 'development';
  process.env.WHATSAPP_ALLOWED_RECIPIENTS = PHONE;
  api.sendTemplate.mockReset();
  settings.setPaused.mockClear();
  mockDb = makeFakeSupabase({
    whatsapp_messages: [row()],
    whatsapp_links: [{ id: 'k1', subject_type: 'employee', subject_id: 'e1', phone: PHONE, status: 'active', groups: {} }],
  });
});
afterAll(() => { delete process.env.NODE_ENV; delete process.env.WHATSAPP_ALLOWED_RECIPIENTS; });

const stored = () => mockDb.tables.whatsapp_messages[0];
const apiError = (code, retryable, pauseSending) => new api.WhatsAppApiError('x', { code, title: `error ${code}`, retryable, pauseSending });

describe('sendRow', () => {
  test('sends and records Meta’s message id', async () => {
    api.sendTemplate.mockResolvedValue({ waMessageId: 'wamid.9' });
    await worker.sendRow(row(), cfg());
    expect(api.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      phone: PHONE, template: 'leave_approved', language: 'en', params: row().params, quickReplyPayload: null,
    }));
    expect(stored()).toMatchObject({ status: 'sent', wa_message_id: 'wamid.9' });
  });

  test('a STOP that arrived after queueing still wins', async () => {
    mockDb.tables.whatsapp_links[0].status = 'opted_out';
    await worker.sendRow(row(), cfg());
    expect(api.sendTemplate).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ status: 'skipped', skip_reason: 'not_connected' });
  });

  test('a group switched off after queueing is respected', async () => {
    mockDb.tables.whatsapp_links[0].groups = { leave: false };
    await worker.sendRow(row(), cfg());
    expect(stored()).toMatchObject({ status: 'skipped', skip_reason: 'group_off' });
  });

  test('outside production, a number off the test list is never sent to', async () => {
    process.env.WHATSAPP_ALLOWED_RECIPIENTS = '911111111111';
    await worker.sendRow(row(), cfg());
    expect(api.sendTemplate).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ status: 'skipped', skip_reason: 'not_on_test_allow_list' });
  });

  test('marketing templates carry the stop button payload', async () => {
    api.sendTemplate.mockResolvedValue({ waMessageId: 'wamid.10' });
    await worker.sendRow(row({ template: 'company_announcement', message_group: 'company_news', params: ['Priya', 'Spaxads', '“Hi”'] }), cfg());
    expect(api.sendTemplate.mock.calls[0][0].quickReplyPayload).toBe('WA_STOP_MARKETING');
  });

  test('"account deactivated" is the last message that person gets', async () => {
    api.sendTemplate.mockResolvedValue({ waMessageId: 'wamid.11' });
    await worker.sendRow(row({ template: 'account_deactivated', message_group: 'account', event_key: 'account_deactivated', params: ['Priya', 'Spaxads'] }), cfg());
    expect(mockDb.tables.whatsapp_links[0].status).toBe('closed');
  });
});

describe('handleSendError', () => {
  test('a token or account problem pauses sending and keeps the message for later', async () => {
    await worker.handleSendError(row(), apiError(190, false, true), 'dev:test');
    expect(settings.setPaused).toHaveBeenCalledWith('dev:test', true, expect.objectContaining({ by: 'system' }));
    expect(stored()).toMatchObject({ status: 'queued', error_code: '190' });
  });

  test('"try again later" is retried with a growing wait', async () => {
    const before = Date.now();
    await worker.handleSendError(row({ attempts: 1 }), apiError(130429, true, false), 'dev:test');
    expect(stored().status).toBe('queued');
    expect(new Date(stored().next_attempt_at).getTime()).toBeGreaterThanOrEqual(before + 59 * 1000);
  });

  test('after the last attempt it is marked failed', async () => {
    await worker.handleSendError(row({ attempts: worker.MAX_ATTEMPTS }), apiError(131000, true, false), 'dev:test');
    expect(stored()).toMatchObject({ status: 'failed', error_code: '131000' });
  });

  test('a permanent problem fails that one message only', async () => {
    await worker.handleSendError(row(), apiError(131026, false, false), 'dev:test');
    expect(stored()).toMatchObject({ status: 'failed', error_code: '131026' });
    expect(settings.setPaused).not.toHaveBeenCalled();
  });

  test('someone who told WhatsApp to stop marketing gets no more news or celebrations', async () => {
    await worker.handleSendError(row(), apiError(131050, false, false), 'dev:test');
    expect(mockDb.tables.whatsapp_links[0].groups).toEqual({ company_news: false, my_celebrations: false, team_celebrations: false });
  });
});
