const { makeFakeSupabase } = require('./fakeSupabase');

let mockDb;
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: new Proxy({}, { get: (_t, prop) => mockDb[prop] }) }));
jest.mock('../../src/config/database', () => ({ env: 'test', timezone: 'Asia/Kolkata' }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { queueEvent } = require('../../src/services/whatsappOutbox.service');
const settings = require('../../src/services/whatsappSettings.service');

const ALLOWED = '919876543210';
const OTHER = '919111111111';

const seed = (overrides = {}) => makeFakeSupabase({
  whatsapp_links: [
    { id: 'k1', subject_type: 'employee', subject_id: 'e1', company_id: 'c1', phone: ALLOWED, bsuid: null, status: 'active', groups: {} },
    { id: 'k2', subject_type: 'employee', subject_id: 'e2', company_id: 'c1', phone: OTHER, bsuid: null, status: 'active', groups: {} },
  ],
  employees: [
    { id: 'e1', first_name: 'Priya', last_name: 'Verma', role: 'employee', is_active: true, company_id: 'c1' },
    { id: 'e2', first_name: 'Rahul', last_name: 'Sharma', role: 'manager', is_active: true, company_id: 'c1' },
    { id: 'e3', first_name: 'Nobody', last_name: 'Connected', role: 'employee', is_active: true, company_id: 'c1' },
  ],
  companies: [{ id: 'c1', name: 'Spaxads', is_active: true }],
  company_feature_overrides: [{ company_id: 'c1', feature_key: 'whatsapp_notifications', enabled: true }],
  company_billing_subscriptions: [],
  company_whatsapp_settings: [],
  platform_whatsapp_state: [],
  whatsapp_messages: [],
  ...overrides,
});

const event = (fields = {}) => ({
  eventKey: 'leave_approved',
  source: 'email:leave_approved',
  recordKey: 'leave-1',
  template: 'leave_approved',
  group: 'leave',
  recipients: [{ subjectType: 'employee', subjectId: 'e1' }],
  params: async ({ person }) => [person.first_name, 'Casual Leave', '3–4 Nov 2026', 'Rahul Sharma', 'Spaxads'],
  ...fields,
});

beforeEach(() => {
  process.env.WHATSAPP_ENABLED = 'true';
  process.env.WHATSAPP_ACCESS_TOKEN = 'token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'PN1';
  process.env.NODE_ENV = 'development';
  process.env.WHATSAPP_ALLOWED_RECIPIENTS = ALLOWED;
  settings._forgetCache();
  mockDb = seed();
});
afterAll(() => {
  ['WHATSAPP_ENABLED', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'NODE_ENV', 'WHATSAPP_ALLOWED_RECIPIENTS']
    .forEach((k) => delete process.env[k]);
});

describe('queueEvent', () => {
  test('queues one message for a connected person, tagged with this machine’s environment', async () => {
    expect(await queueEvent(event())).toBe(1);
    const [row] = mockDb.tables.whatsapp_messages;
    expect(row).toMatchObject({
      subject_id: 'e1', recipient: ALLOWED, recipient_kind: 'phone', template: 'leave_approved',
      category: 'utility', message_group: 'leave', status: 'queued',
      params: ['Priya', 'Casual Leave', '3–4 Nov 2026', 'Rahul Sharma', 'Spaxads'],
    });
    expect(row.environment).toMatch(/^dev:/);
    expect(row.dedupe_key).toBe('leave_approved:leave-1:employee:e1');
  });

  test('the same event never queues twice (email + in-app copy of one leave approval)', async () => {
    await queueEvent(event({ source: 'notification:LEAVE' }));
    expect(await queueEvent(event({ source: 'email:leave_approved' }))).toBe(0);
    expect(mockDb.tables.whatsapp_messages).toHaveLength(1);
  });

  test('nothing at all while WhatsApp is switched off', async () => {
    process.env.WHATSAPP_ENABLED = '';
    expect(await queueEvent(event())).toBe(0);
    expect(mockDb.calls).toHaveLength(0);
  });

  test('on a developer machine, numbers off the test list are skipped', async () => {
    const queued = await queueEvent(event({ recipients: [{ subjectType: 'employee', subjectId: 'e1' }, { subjectType: 'employee', subjectId: 'e2' }] }));
    expect(queued).toBe(1);
    expect(mockDb.tables.whatsapp_messages.map((r) => r.subject_id)).toEqual(['e1']);
  });

  test('people who never connected are skipped', async () => {
    expect(await queueEvent(event({ recipients: [{ subjectType: 'employee', subjectId: 'e3' }] }))).toBe(0);
  });

  test('the paid add-on must be on for the company', async () => {
    mockDb = seed({ company_feature_overrides: [] }); // no override, no plan → off
    expect(await queueEvent(event())).toBe(0);
  });

  test('the company switch and the company’s groups are respected', async () => {
    mockDb = seed({ company_whatsapp_settings: [{ company_id: 'c1', enabled: false, groups: {} }] });
    expect(await queueEvent(event())).toBe(0);
    settings._forgetCache();
    mockDb = seed({ company_whatsapp_settings: [{ company_id: 'c1', enabled: true, groups: { leave: false } }] });
    expect(await queueEvent(event())).toBe(0);
  });

  test('the person’s own group switch is respected', async () => {
    mockDb.tables.whatsapp_links[0].groups = { leave: false };
    expect(await queueEvent(event())).toBe(0);
  });

  test('a deactivated person gets only the account notice', async () => {
    mockDb.tables.employees[0].is_active = false;
    expect(await queueEvent(event())).toBe(0);
    expect(await queueEvent(event({
      eventKey: 'account_deactivated', template: 'account_deactivated', group: 'account', recordKey: 'x',
      params: async () => ['Priya', 'Spaxads'],
    }))).toBe(1);
  });

  test('nothing is queued while sending is paused for this environment', async () => {
    const { environment } = require('../../src/config/whatsapp').getConfig();
    mockDb.tables.platform_whatsapp_state.push({ environment, paused: true });
    expect(await queueEvent(event())).toBe(0);
  });

  test('a message with the wrong number of values is never queued', async () => {
    expect(await queueEvent(event({ params: async () => ['only one'] }))).toBe(0);
  });

  test('values are cleaned so Meta accepts them', async () => {
    await queueEvent(event({ params: async () => ['Priya\nVerma', '  Casual   Leave ', '', 'Rahul', 'Spaxads'] }));
    expect(mockDb.tables.whatsapp_messages[0].params).toEqual(['Priya Verma', 'Casual Leave', '—', 'Rahul', 'Spaxads']);
  });

  test('an unknown template is never queued', async () => {
    expect(await queueEvent(event({ template: 'does_not_exist' }))).toBe(0);
  });
});
