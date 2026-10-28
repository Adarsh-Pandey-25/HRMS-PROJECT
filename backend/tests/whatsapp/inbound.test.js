const { makeFakeSupabase } = require('./fakeSupabase');

let mockDb;
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: new Proxy({}, { get: (_t, prop) => mockDb[prop] }) }));
jest.mock('../../src/config/database', () => ({ env: 'test', timezone: 'Asia/Kolkata' }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/whatsappApi', () => ({ sendText: jest.fn(async () => ({ waMessageId: 'wamid.reply' })) }));
jest.mock('../../src/services/whatsappSettings.service', () => ({ touchWebhook: jest.fn(async () => {}) }));

const api = require('../../src/services/whatsappApi');
const inbound = require('../../src/services/whatsappInbound.service');
const linkService = require('../../src/services/whatsappLink.service');

const PHONE = '919876543210';

const delivery = (messages, extra = {}) => ({
  entry: [{
    changes: [{
      field: 'messages',
      value: {
        metadata: { phone_number_id: 'PN1' },
        contacts: [{ wa_id: PHONE, user_id: 'IN.user1' }],
        messages,
        ...extra,
      },
    }],
  }],
});
const text = (id, body, fields = {}) => ({ id, from: PHONE, from_user_id: 'IN.user1', type: 'text', text: { body }, ...fields });

beforeEach(() => {
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'PN1';
  process.env.NODE_ENV = 'development';
  process.env.WHATSAPP_ALLOWED_RECIPIENTS = PHONE;
  api.sendText.mockClear();
  mockDb = makeFakeSupabase({
    companies: [{ id: 'c1', name: 'Spaxads' }],
    whatsapp_link_codes: [{
      id: 'code1', code_hash: linkService.hashCode('ABCD2345'), subject_type: 'employee', subject_id: 'e1',
      company_id: 'c1', expires_at: new Date(Date.now() + 60000).toISOString(), used_at: null,
    }],
    whatsapp_links: [],
    whatsapp_inbound: [],
    whatsapp_messages: [{ id: 'm1', wa_message_id: 'wamid.out1', status: 'sent' }],
  });
});
afterAll(() => {
  ['WHATSAPP_PHONE_NUMBER_ID', 'NODE_ENV', 'WHATSAPP_ALLOWED_RECIPIENTS'].forEach((k) => delete process.env[k]);
});

describe('classify', () => {
  test.each([
    ['JOIN abcd2345', 'join'],
    ['join ABCD2345 ', 'join'],
    ['STOP', 'stop'],
    ['unsubscribe', 'stop'],
    ['Start', 'start'],
    ['help', 'help'],
    ['hello there', 'other'],
    ['JOIN', 'other'],
  ])('%p → %s', (body, action) => {
    expect(inbound.classify({ type: 'text', text: { body } }).action).toBe(action);
  });

  test('the marketing stop button', () => {
    expect(inbound.classify({ type: 'button', button: { payload: 'WA_STOP_MARKETING', text: 'Stop these updates' } }).action).toBe('stop_marketing');
  });
});

describe('processWebhook', () => {
  test('JOIN <code> links the WhatsApp to the person and confirms', async () => {
    await inbound.processWebhook(delivery([text('in1', 'JOIN abcd2345')]));
    const [link] = mockDb.tables.whatsapp_links;
    expect(link).toMatchObject({
      subject_type: 'employee', subject_id: 'e1', company_id: 'c1', phone: PHONE, bsuid: 'IN.user1', status: 'active',
    });
    expect(link.consented_at).toBeTruthy();
    expect(api.sendText).toHaveBeenCalledWith(expect.objectContaining({ phone: PHONE, text: expect.stringContaining('Connected') }));
    expect(api.sendText.mock.calls[0][0].text).toContain('Spaxads');
  });

  test('a code works only once, and Meta’s retry of the same message is ignored', async () => {
    await inbound.processWebhook(delivery([text('in1', 'JOIN ABCD2345')]));
    await inbound.processWebhook(delivery([text('in1', 'JOIN ABCD2345')])); // Meta retry: same id
    expect(api.sendText).toHaveBeenCalledTimes(1);
    await inbound.processWebhook(delivery([text('in2', 'JOIN ABCD2345')])); // reused code
    expect(api.sendText).toHaveBeenLastCalledWith(expect.objectContaining({ text: inbound.REPLIES.badCode }));
  });

  test('STOP turns every link for that WhatsApp off; START turns it back on', async () => {
    await inbound.processWebhook(delivery([text('in1', 'JOIN ABCD2345')]));
    await inbound.processWebhook(delivery([text('in2', 'STOP')]));
    expect(mockDb.tables.whatsapp_links[0].status).toBe('opted_out');
    expect(api.sendText).toHaveBeenLastCalledWith(expect.objectContaining({ text: inbound.REPLIES.stopped }));
    await inbound.processWebhook(delivery([text('in3', 'start')]));
    expect(mockDb.tables.whatsapp_links[0].status).toBe('active');
  });

  test('a person with a hidden number (username) is matched by BSUID; no reply goes outside the test list', async () => {
    mockDb.tables.whatsapp_links.push({ id: 'k1', subject_type: 'employee', subject_id: 'e2', phone: null, bsuid: 'IN.hidden', status: 'active', groups: {} });
    await inbound.processWebhook({
      entry: [{ changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: 'PN1' },
        contacts: [{ user_id: 'IN.hidden' }],
        messages: [{ id: 'in9', from_user_id: 'IN.hidden', type: 'text', text: { body: 'STOP' } }],
      } }] }],
    });
    expect(mockDb.tables.whatsapp_links.find((l) => l.id === 'k1').status).toBe('opted_out');
    expect(api.sendText).not.toHaveBeenCalled();
  });

  test('other messages get one polite reply a day, and their text is never stored', async () => {
    await inbound.processWebhook(delivery([text('in1', 'my salary is wrong')]));
    await inbound.processWebhook(delivery([text('in2', 'hello?')]));
    expect(api.sendText).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockDb.tables.whatsapp_inbound)).not.toContain('salary');
  });

  test('delivery statuses move forward only, and failures are recorded', async () => {
    const status = (s, extra = {}) => delivery([], { statuses: [{ id: 'wamid.out1', status: s, ...extra }] });
    await inbound.processWebhook(status('read', { pricing: { category: 'utility', billable: true } }));
    expect(mockDb.tables.whatsapp_messages[0]).toMatchObject({ status: 'read', pricing_category: 'utility', billable: true });
    await inbound.processWebhook(status('delivered'));
    expect(mockDb.tables.whatsapp_messages[0].status).toBe('read');
    await inbound.processWebhook(status('failed', { errors: [{ code: 131026, title: 'Message undeliverable' }] }));
    expect(mockDb.tables.whatsapp_messages[0]).toMatchObject({ status: 'failed', error_code: '131026' });
  });

  test('events for another business number are not ours', async () => {
    await inbound.processWebhook({
      entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'SOMEONE_ELSE' }, messages: [text('in1', 'STOP')] } }] }],
    });
    expect(api.sendText).not.toHaveBeenCalled();
    expect(mockDb.tables.whatsapp_inbound).toHaveLength(0);
  });

  test('a changed number keeps the person connected', async () => {
    await inbound.processWebhook(delivery([text('in1', 'JOIN ABCD2345')]));
    await inbound.processWebhook(delivery([{
      id: 'sys1', from: PHONE, type: 'system', system: { type: 'user_changed_number', new_wa_id: '919000000001' },
    }]));
    expect(mockDb.tables.whatsapp_links[0].phone).toBe('919000000001');
  });
});
