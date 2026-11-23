/**
 * Owner's rule, 20 Nov 2026: approving a biometric machine's new IP makes its
 * kept punches count, so on WhatsApp the tap must come from a number the
 * approver connected themselves (JOIN with the code from their own SpaxSync
 * login) — never one HR typed in for them, which nobody proved is theirs.
 * Other approvals (leave, WFH, expenses) are unchanged.
 *
 * handleTap runs against an in-memory database; nothing is sent.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: (...a) => mockDb.current.from(...a) } }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/whatsappApi', () => ({ listTemplates: async () => [] }));
jest.mock('../../src/services/whatsappSettings.service', () => ({
  isAddOnEnabled: async () => true,
  getCompanySettings: async () => ({ enabled: true }),
}));
jest.mock('../../src/services/whatsappLink.service', () => ({
  getLink: async () => mockLink.current,
  normalizeIdentity: (identity) => identity,
}));
jest.mock('../../src/services/subscription.service', () => ({ isBillingSuspended: async () => false }));
jest.mock('../../src/services/featureOverride.service', () => ({ hasFeature: async () => true }));
jest.mock('../../src/services/auditLog.service', () => ({ logAudit: async () => {} }));
jest.mock('../../src/services/admsIpApproval.service', () => ({
  isApprover: async () => true,
  decide: (...a) => mockDecide(...a),
}));

const mockDb = { current: null };
const mockLink = { current: null };
const mockDecide = jest.fn(async () => ({ ip: '198.51.100.20', device: 'Main Gate', kept: 3, people: 2, since: '20 Nov, 9:30 AM' }));

const crypto = require('crypto');
const { makeFakeSupabase } = require('./helpers/fakeSupabase');
const approvals = require('../../src/services/whatsappApprovals.service');

const ADMIN_ID = 'a0000000-0000-4000-8000-000000000001';
const REQUEST_ID = 'b0000000-0000-4000-8000-000000000001';
const PHONE = '919876500001';
const CODE = 'abcdefghijklmnopqrstuv';

let tables;
beforeEach(() => {
  tables = {
    whatsapp_actions: [{
      id: 'act1',
      message_id: 'msg1',
      company_id: 'c1',
      approver_id: ADMIN_ID,
      kind: 'device_ip',
      record_id: REQUEST_ID,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      used_at: null,
      token_hash: crypto.createHash('sha256').update(CODE).digest('hex'),
    }],
    employees: [{ id: ADMIN_ID, company_id: 'c1', role: 'admin', is_active: true, first_name: 'Asha' }],
    companies: [{ id: 'c1', is_active: true }],
  };
  mockDb.current = makeFakeSupabase(tables);
  mockDecide.mockClear();
});

const tap = (decision = 'approve') => approvals.handleTap({ decision, code: CODE, identity: { phone: PHONE } });

describe('Approve / Reject on WhatsApp for a machine\'s new IP', () => {
  test('from a number HR typed in: refused and nothing changes (they decide in SpaxSync instead)', async () => {
    mockLink.current = { status: 'active', phone: PHONE, consent_source: 'hr_added' };
    const reply = await tap();
    expect(reply).toBe(approvals.REPLIES.notConfirmed);
    expect(mockDecide).not.toHaveBeenCalled();
    expect(tables.whatsapp_actions[0].used_at).toBeNull();
  });

  test('from a number reconnected with START (proves the SIM, not the person): refused too', async () => {
    mockLink.current = { status: 'active', phone: PHONE, consent_source: 'whatsapp_start' };
    expect(await tap()).toBe(approvals.REPLIES.notConfirmed);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  test('from the WhatsApp the approver connected themselves: approved, and the reply says how many punches now count', async () => {
    mockLink.current = { status: 'active', phone: PHONE, consent_source: 'whatsapp_join' };
    const reply = await tap();
    expect(mockDecide).toHaveBeenCalledWith(REQUEST_ID, 'approve', { companyId: 'c1', decidedBy: ADMIN_ID, via: 'whatsapp' });
    expect(reply).toContain('✅ Approved');
    expect(reply).toContain('The 3 punches kept since 20 Nov, 9:30 AM now count too');
    expect(tables.whatsapp_actions[0].used_at).toBeTruthy();
  });

  test('Reject says the punches were deleted', async () => {
    mockLink.current = { status: 'active', phone: PHONE, consent_source: 'whatsapp_join' };
    const reply = await tap('reject');
    expect(mockDecide).toHaveBeenCalledWith(REQUEST_ID, 'reject', expect.objectContaining({ via: 'whatsapp' }));
    expect(reply).toContain('Its 3 punches were deleted');
  });

  test('from any other number: not theirs', async () => {
    mockLink.current = { status: 'active', phone: '919999999999', consent_source: 'whatsapp_join' };
    expect(await tap()).toBe(approvals.REPLIES.notYours);
    expect(mockDecide).not.toHaveBeenCalled();
  });
});
