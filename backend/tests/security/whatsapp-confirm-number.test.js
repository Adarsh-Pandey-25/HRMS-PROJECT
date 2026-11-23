/**
 * Owner's request, 23 Nov 2026: a WhatsApp number HR typed in can't approve
 * anything. Approve / Reject buttons go only to a number the person confirmed
 * — with JOIN, or with a 6-digit code SpaxSync sends on WhatsApp and they type
 * into their profile. When the company's setting is on, an approver who isn't
 * confirmed is sent a code by itself before an approval. HR changing a
 * code-confirmed number makes it unconfirmed again.
 *
 * In-memory database; the outbox is a stand-in, so nothing is sent.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: (...a) => mockDb.current.from(...a) } }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/config/whatsapp', () => {
  const cfg = { enabled: true, accessToken: 'test', phoneNumberId: '1', environment: 'test' };
  return {
    DEFAULT_API_VERSION: 'v21.0',
    digitsOnly: (v) => String(v || '').replace(/\D/g, ''),
    getConfig: () => cfg,
    missingSettings: () => [],
    canSend: (c = cfg) => c.enabled && Boolean(c.accessToken && c.phoneNumberId),
    isRecipientAllowed: () => true,
  };
});
jest.mock('../../src/services/whatsappApi', () => ({
  listTemplates: async () => [{ name: 'whatsapp_verify_code', status: 'APPROVED', language: 'en' }],
}));
jest.mock('../../src/services/whatsappOutbox.service', () => ({ queueEvent: (...a) => mockOutbox.queueEvent(...a) }));
jest.mock('../../src/services/whatsappSettings.service', () => ({
  isAddOnEnabled: async () => true,
  getCompanySettings: async () => ({ enabled: true, groups: {} }),
}));
jest.mock('../../src/services/settings.service', () => {
  const store = new Map();
  return {
    getSetting: async (key, fallback, companyId) => (store.has(`${companyId}:${key}`) ? store.get(`${companyId}:${key}`) : null),
    setSetting: async (key, value, by, companyId) => { store.set(`${companyId}:${key}`, value); return { error: null }; },
    __reset: () => store.clear(),
  };
});

const mockDb = { current: null };
const mockOutbox = { queueEvent: jest.fn(async () => 1) };

const { makeFakeSupabase } = require('./helpers/fakeSupabase');
const settingsService = require('../../src/services/settings.service');
const verify = require('../../src/services/whatsappVerify.service');
const approvals = require('../../src/services/whatsappApprovals.service');
const linkService = require('../../src/services/whatsappLink.service');

const ADMIN = 'a0000000-0000-4000-8000-000000000001';
const HR = 'a0000000-0000-4000-8000-000000000002';
const MANAGER = 'a0000000-0000-4000-8000-000000000003';
const RECORD = 'b0000000-0000-4000-8000-000000000001';
const link = (subjectId, consentSource, phone) => ({
  id: `link-${subjectId}`, subject_type: 'employee', subject_id: subjectId, company_id: 'c1', phone, bsuid: null, status: 'active', consent_source: consentSource,
});

let tables;
beforeEach(() => {
  tables = {
    whatsapp_links: [
      link(ADMIN, 'whatsapp_join', '919876500001'),
      link(HR, 'hr_added', '919876500002'),
      link(MANAGER, 'hr_added', '919876500003'),
    ],
    whatsapp_actions: [],
  };
  mockDb.current = makeFakeSupabase(tables);
  mockOutbox.queueEvent.mockClear();
  verify._resetForTests();
  settingsService.__reset();
});

const row = (id) => tables.whatsapp_links.find((l) => l.subject_id === id);
/** The code in the last verification message queued. */
const lastCode = async () => {
  const event = mockOutbox.queueEvent.mock.calls.map((c) => c[0]).filter((e) => e.template === 'whatsapp_verify_code').pop();
  return event ? (await event.params({}))[0] : null;
};

describe('confirming a number with a code', () => {
  test('a code goes to the person\'s WhatsApp; typing it in confirms the number for approvals', async () => {
    const sent = await verify.sendCode(HR);
    expect(sent).toMatchObject({ sent: true });
    const event = mockOutbox.queueEvent.mock.calls[0][0];
    expect(event).toMatchObject({ template: 'whatsapp_verify_code', group: 'account', recipients: [{ subjectType: 'employee', subjectId: HR }] });
    const code = await lastCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(verify.codeWaitingUntil(HR)).toBeTruthy();

    expect([...(await verify.confirmedEmployeeIds([ADMIN, HR]))]).toEqual([ADMIN]);
    await verify.confirmCode(HR, code);
    expect(row(HR).consent_source).toBe('whatsapp_code');
    expect([...(await verify.confirmedEmployeeIds([ADMIN, HR]))].sort()).toEqual([ADMIN, HR].sort());
    // Used once only.
    await expect(verify.confirmCode(HR, code)).rejects.toThrow(/expired or no code was sent/);
  });

  test('wrong codes: 5 tries, then the code is gone even if the right one follows', async () => {
    await verify.sendCode(HR);
    const code = await lastCode();
    const wrong = String((Number(code) + 1) % 900000 + 100000);
    for (let i = 4; i >= 1; i -= 1) {
      // eslint-disable-next-line no-await-in-loop
      await expect(verify.confirmCode(HR, wrong)).rejects.toThrow(new RegExp(`${i} tr`));
    }
    await expect(verify.confirmCode(HR, wrong)).rejects.toThrow(/Ask for a new one/);
    await expect(verify.confirmCode(HR, code)).rejects.toThrow(/expired or no code was sent/);
    expect(row(HR).consent_source).toBe('hr_added');
  });

  test('the code only confirms the number it was sent to', async () => {
    await verify.sendCode(HR);
    const code = await lastCode();
    row(HR).phone = '919999999999'; // HR changed the number meanwhile
    await expect(verify.confirmCode(HR, code)).rejects.toThrow(/number changed/);
    expect(row(HR).consent_source).toBe('hr_added');
  });

  test('asking again within a minute is refused; a JOIN-connected number needs no code', async () => {
    await verify.sendCode(HR);
    await expect(verify.sendCode(HR)).rejects.toThrow(/wait/);
    expect(await verify.sendCode(ADMIN)).toEqual({ alreadyConfirmed: true });
    expect(mockOutbox.queueEvent).toHaveBeenCalledTimes(1);
  });

  test('HR changing a code-confirmed number makes it unconfirmed again; a JOIN link is left as it is', async () => {
    row(HR).consent_source = 'whatsapp_code';
    await linkService.followNumberChange({ employeeId: HR, phone: '9876511111' });
    expect(row(HR)).toMatchObject({ phone: '919876511111', consent_source: 'hr_added' });
    await linkService.followNumberChange({ employeeId: ADMIN, phone: '9876522222' });
    expect(row(ADMIN)).toMatchObject({ phone: '919876500001', consent_source: 'whatsapp_join' });
  });
});

describe('approvals on WhatsApp', () => {
  const approvalRows = () => [ADMIN, HR, MANAGER].map((id, i) => ({ id: `msg${i}`, subject_type: 'employee', subject_id: id, company_id: 'c1' }));

  test('only confirmed approvers get buttons; the others are sent a code (setting on by default), once a day', async () => {
    await approvals.createActions(approvalRows(), { kind: 'leave', recordId: RECORD });
    expect(tables.whatsapp_actions.map((a) => a.approver_id)).toEqual([ADMIN]);
    await new Promise((r) => setImmediate(r));
    const sentTo = () => mockOutbox.queueEvent.mock.calls.map((c) => c[0]).filter((e) => e.template === 'whatsapp_verify_code').map((e) => e.recipients[0].subjectId).sort();
    expect(sentTo()).toEqual([HR, MANAGER].sort());

    // A second approval the same day: no second code.
    await approvals.createActions(approvalRows(), { kind: 'leave', recordId: RECORD });
    await new Promise((r) => setImmediate(r));
    expect(sentTo()).toHaveLength(2);
  });

  test('with the setting off, nobody is sent a code (they can still ask from their profile)', async () => {
    await verify.setConfirmByCode('c1', false, ADMIN);
    expect(await verify.confirmByCodeOn('c1')).toBe(false);
    await approvals.createActions(approvalRows(), { kind: 'expense', recordId: RECORD });
    await new Promise((r) => setImmediate(r));
    expect(mockOutbox.queueEvent).not.toHaveBeenCalled();
    expect(tables.whatsapp_actions.map((a) => a.approver_id)).toEqual([ADMIN]);
    expect(await verify.sendCode(HR)).toMatchObject({ sent: true });
  });

  test('a tap from a number that isn\'t confirmed is refused, for any approval', async () => {
    const crypto = require('crypto');
    const code = 'abcdefghijklmnopqrstuv';
    tables.whatsapp_actions.push({
      id: 'act1', message_id: 'msg1', company_id: 'c1', approver_id: HR, kind: 'leave', record_id: RECORD,
      expires_at: new Date(Date.now() + 3600e3).toISOString(), used_at: null, token_hash: crypto.createHash('sha256').update(code).digest('hex'),
    });
    const reply = await approvals.handleTap({ decision: 'approve', code, identity: { phone: '919876500002' } });
    expect(reply).toBe(approvals.REPLIES.notConfirmed);
    expect(tables.whatsapp_actions[0].used_at).toBeNull();
  });
});

describe('the company setting and the profile endpoints', () => {
  const call = async (handler, { user, body = {}, impersonation = null }) => {
    const req = { user, body, headers: {}, impersonation, get: () => undefined };
    let payload = null;
    const res = { status() { return res; }, json(p) { payload = p; return res; } };
    const next = jest.fn();
    await handler(req, res, next);
    return { payload, error: next.mock.calls[0]?.[0] || null };
  };

  test('nobody can confirm or change WhatsApp while a super-admin is signed in as them', async () => {
    const controller = require('../../src/controllers/whatsapp.controller');
    const user = { id: HR, role: 'hr', company_id: 'c1' };
    for (const handler of [controller.sendConfirmCode, controller.confirmNumber, controller.startLink, controller.disconnect]) {
      // eslint-disable-next-line no-await-in-loop
      const { error } = await call(handler, { user, body: { code: '123456' }, impersonation: { superAdminId: 'sa1' } });
      expect(error?.message).toMatch(/not while signed in as them/);
    }
    expect(mockOutbox.queueEvent).not.toHaveBeenCalled();
  });
});
