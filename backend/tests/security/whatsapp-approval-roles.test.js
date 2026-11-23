/**
 * Owner's request, 23 Nov 2026: Settings → Integrations → WhatsApp → "Who
 * gets approval requests on WhatsApp", tick boxes Managers, HR and Admins,
 * all ticked by default (how it worked before). Unticking a role stops only
 * the WhatsApp message of a leave, WFH, expense or attendance-correction
 * request to people with that role: the in-app notification and email still
 * go, every other WhatsApp message still goes, and a biometric machine's new
 * IP keeps its own list. At least one box must stay ticked.
 *
 * Runs the real path — in-app notification → WhatsApp copy → outbox — on an
 * in-memory database; nothing is sent.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: (...a) => mockDb.current.from(...a) } }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/config/whatsapp', () => {
  const cfg = { enabled: true, accessToken: 'test', phoneNumberId: '1', businessNumber: '919800000000', environment: 'test' };
  return {
    DEFAULT_API_VERSION: 'v21.0',
    digitsOnly: (v) => String(v || '').replace(/\D/g, ''),
    getConfig: () => cfg,
    missingSettings: () => [],
    canSend: (c = cfg) => c.enabled && Boolean(c.accessToken && c.phoneNumberId),
    isRecipientAllowed: () => true,
  };
});
jest.mock('../../src/services/whatsappApi', () => ({ listTemplates: async () => [] }));
jest.mock('../../src/services/whatsappSettings.service', () => ({
  isAddOnEnabled: async () => true,
  getCompanySettings: async () => ({ enabled: true, groups: {}, updatedAt: null }),
  getPlatformState: async () => ({ paused: false }),
}));
jest.mock('../../src/services/settings.service', () => {
  const store = new Map();
  return {
    getSetting: async (key, fallback, companyId) => (store.has(`${companyId}:${key}`) ? store.get(`${companyId}:${key}`) : fallback),
    setSetting: async (key, value, by, companyId) => { store.set(`${companyId}:${key}`, value); return { data: { value }, error: null }; },
    __reset: () => store.clear(),
  };
});
jest.mock('../../src/services/email.service', () => ({ notificationEmail: (...a) => mockEmail(...a) }));
jest.mock('../../src/services/auditLog.service', () => ({
  auditFromRequest: (...a) => mockAudit(...a),
  logAudit: async () => {},
}));
// The WhatsApp copy runs in the background; here each job is kept so the test can wait for it.
jest.mock('../../src/utils/background', () => ({
  runInBackground: (label, work) => { mockBackground.push(Promise.resolve().then(work)); },
}));

const mockDb = { current: null };
const mockEmail = jest.fn(async () => ({}));
const mockAudit = jest.fn();
const mockBackground = [];

const { makeFakeSupabase } = require('./helpers/fakeSupabase');
const settingsService = require('../../src/services/settings.service');
const notificationService = require('../../src/services/notification.service');
const outbox = require('../../src/services/whatsappOutbox.service');
const approvals = require('../../src/services/whatsappApprovals.service');
const controller = require('../../src/controllers/whatsapp.controller');

const ADMIN = 'a0000000-0000-4000-8000-000000000001';
const HR = 'a0000000-0000-4000-8000-000000000002';
const MANAGER = 'a0000000-0000-4000-8000-000000000003';
// Role "employee", but someone's reporting manager: counts as a manager.
const LEAD = 'a0000000-0000-4000-8000-000000000004';
const EMP = 'a0000000-0000-4000-8000-000000000005';
const LEAVE = 'b0000000-0000-4000-8000-000000000001';
const WFH_BATCH = 'b0000000-0000-4000-8000-000000000002';
const CLAIM = 'b0000000-0000-4000-8000-000000000003';
const CORRECTION = 'b0000000-0000-4000-8000-000000000004';
const TICKET = 'b0000000-0000-4000-8000-000000000005';
const IP_REQUEST = 'b0000000-0000-4000-8000-000000000006';
const APPROVERS = [ADMIN, HR, MANAGER, LEAD];

const employee = (id, role, firstName) => ({
  id, role, first_name: firstName, last_name: 'Test', email: `${firstName.toLowerCase()}@acme.test`, is_active: true, company_id: 'c1',
});
const link = (subjectId, i) => ({
  id: `link-${i}`, subject_type: 'employee', subject_id: subjectId, company_id: 'c1', phone: `91987650000${i}`, bsuid: null, status: 'active', groups: null, consent_source: 'whatsapp_join',
});

let tables;
beforeEach(() => {
  tables = {
    companies: [{ id: 'c1', name: 'Acme', is_active: true }],
    employees: [
      employee(ADMIN, 'admin', 'Asha'),
      employee(HR, 'hr', 'Hema'),
      employee(MANAGER, 'manager', 'Manoj'),
      employee(LEAD, 'employee', 'Lalit'),
      { ...employee(EMP, 'employee', 'Eshan'), manager_id: MANAGER },
    ],
    whatsapp_links: APPROVERS.map(link),
    whatsapp_messages: [],
    whatsapp_actions: [],
    notifications: [],
    leaves: [{
      id: LEAVE, employee_id: EMP, company_id: 'c1', leave_type: 'CL', from_date: '2026-11-25', to_date: '2026-11-25', status: 'pending', reason: 'Family function',
    }],
    wfh_day_requests: [{ id: 'wfh-day-1', batch_id: WFH_BATCH, employee_id: EMP, work_date: '2026-11-26', reason: 'Plumber visit' }],
    reimbursements: [{ id: CLAIM, employee_id: EMP, reimbursement_type: 'travel', status: 'pending', description: 'Client visit' }],
    helpdesk_tickets: [
      {
        id: CORRECTION, subject: 'Attendance correction — 2026-11-20', raised_by: EMP, status: 'open', category: 'hr',
        description: 'Requested check-in: 09:30\nRequested check-out: 18:30\nReason: Forgot to punch',
      },
      { id: TICKET, subject: 'Laptop is slow', raised_by: EMP, status: 'open', category: 'it', description: 'Please check' },
    ],
  };
  mockDb.current = makeFakeSupabase(tables);
  settingsService.__reset();
  mockEmail.mockClear();
  mockAudit.mockClear();
  mockBackground.length = 0;
});

/** Waits for the WhatsApp copies (and the notification emails) started in the background. */
const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    while (mockBackground.length) await Promise.all(mockBackground.splice(0));
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setImmediate(r));
  }
};

/** The in-app notification each kind of approval request sends to its approvers. */
const REQUESTS = {
  leave: { type: 'LEAVE', title: 'Leave request submitted', meta: { leave_id: LEAVE } },
  wfh: { type: 'ATTENDANCE', title: 'WFH request pending', meta: { wfh_batch_id: WFH_BATCH, work_date: '2026-11-26' } },
  expense: { type: 'REIMBURSEMENT', title: 'Reimbursement submitted', meta: { reimbursement_id: CLAIM } },
  regularization: { type: 'TICKET', title: 'New helpdesk ticket', meta: { ticket_id: CORRECTION } },
};
const KIND_OF_KEY = {
  leave_approval_waiting: 'leave', wfh_approval_waiting: 'wfh', expense_approval_waiting: 'expense', regularization_waiting: 'regularization',
};

const askApprovers = async (kind, to = APPROVERS) => {
  const r = REQUESTS[kind];
  await notificationService.createNotifications(to.map((user_id) => ({
    user_id, type: r.type, title: r.title, message: 'A request needs review.', link: '/approvals', meta: r.meta,
  })));
  await settle();
};

/** Who was queued a WhatsApp approval request for this kind. */
const whatsappTo = (kind) => tables.whatsapp_messages
  .filter((m) => m.template === 'approval_request' && KIND_OF_KEY[m.event_key] === kind)
  .map((m) => m.subject_id)
  .sort();

const call = async (handler, { user = { id: ADMIN, role: 'admin', company_id: 'c1' }, body = {} } = {}) => {
  const req = { user, body, headers: {}, ip: null, get: () => undefined };
  let payload = null;
  const res = { status() { return res; }, json(p) { payload = p; return res; } };
  const next = jest.fn();
  await handler(req, res, next);
  return { payload, error: next.mock.calls[0]?.[0] || null };
};

const tick = (approvalRoles) => call(controller.updateCompany, { body: { approvalRoles } });

describe('by default, every approver gets approval requests on WhatsApp (as before)', () => {
  test.each(Object.keys(REQUESTS))('%s: managers, HR and admins all get it, with buttons', async (kind) => {
    await askApprovers(kind);
    expect(whatsappTo(kind)).toEqual([...APPROVERS].sort());
    expect(tables.whatsapp_actions.map((a) => a.approver_id).sort()).toEqual([...APPROVERS].sort());
  });

  test('the card shows all three ticked', async () => {
    const { payload, error } = await call(controller.getCompany);
    expect(error).toBeNull();
    expect(payload.data.approvalRoles).toEqual(['manager', 'hr', 'admin']);
  });
});

describe('unticking HR', () => {
  beforeEach(async () => {
    const { payload, error } = await tick(['manager', 'admin']);
    expect(error).toBeNull();
    expect(payload.data.approvalRoles).toEqual(['manager', 'admin']);
  });

  test.each(Object.keys(REQUESTS))('%s: HR gets no WhatsApp approval request; managers and admins still do', async (kind) => {
    await askApprovers(kind);
    expect(whatsappTo(kind)).toEqual([ADMIN, MANAGER, LEAD].sort());
    expect(tables.whatsapp_actions.map((a) => a.approver_id)).not.toContain(HR);
  });

  test('HR still gets the in-app notification and its email', async () => {
    await askApprovers('leave');
    expect(tables.notifications.filter((n) => n.user_id === HR)).toHaveLength(1);
    expect(mockEmail.mock.calls.map(([to]) => to.id)).toContain(HR);
    expect(tables.whatsapp_messages.some((m) => m.subject_id === HR)).toBe(false);
  });

  test('every other WhatsApp message still reaches HR', async () => {
    // HR's own leave decided, and an ordinary helpdesk ticket.
    await notificationService.createNotification({ user_id: HR, type: 'LEAVE', title: 'Leave approved', message: 'Approved', meta: { leave_id: LEAVE } });
    await notificationService.createNotification({ user_id: HR, type: 'TICKET', title: 'New helpdesk ticket', message: 'New', meta: { ticket_id: TICKET } });
    await settle();
    const toHr = tables.whatsapp_messages.filter((m) => m.subject_id === HR).map((m) => m.template).sort();
    expect(toHr).toEqual(['leave_approved', 'ticket_new']);

    // A biometric machine's new IP has its own list of approvers.
    const queued = await outbox.queueEvent({
      eventKey: 'device_ip_approval',
      source: 'adms:new_ip',
      recordKey: IP_REQUEST,
      template: 'approval_request',
      group: 'security',
      recipients: [{ subjectType: 'employee', subjectId: HR }],
      params: async () => ['Hema', 'the biometric machine Main Gate', 'Acme', 'a new internet address', 'So far no punches yet'],
      action: { kind: 'device_ip', recordId: IP_REQUEST },
    });
    expect(queued).toBe(1);
    expect(tables.whatsapp_actions.filter((a) => a.kind === 'device_ip').map((a) => a.approver_id)).toEqual([HR]);
  });

  test('the change is in the audit log', () => {
    expect(mockAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actionType: 'whatsapp.approval_roles',
      targetType: 'setting',
      targetId: 'whatsapp_approval_roles',
      beforeState: { roles: ['manager', 'hr', 'admin'] },
      afterState: { roles: ['manager', 'admin'] },
    }));
  });
});

describe('unticking Managers', () => {
  test('stops it for managers and anyone asked as a reporting manager; HR and admins still get it', async () => {
    await tick(['hr', 'admin']);
    await askApprovers('expense');
    expect(whatsappTo('expense')).toEqual([ADMIN, HR].sort());
  });
});

describe('at least one box stays ticked', () => {
  test('saving with nothing ticked is refused and nothing changes', async () => {
    await tick(['admin']);
    mockAudit.mockClear();
    const { error } = await tick([]);
    expect(error?.statusCode).toBe(400);
    expect(error?.message).toMatch(/at least one/i);
    expect(await approvals.getApprovalRoles('c1')).toEqual(['admin']);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  test('unknown roles and wrong shapes are refused', async () => {
    for (const bad of [['owner'], 'hr', { roles: ['hr'] }, null]) {
      // eslint-disable-next-line no-await-in-loop
      const { error } = await tick(bad);
      expect(error?.statusCode).toBe(400);
    }
    expect(await approvals.getApprovalRoles('c1')).toEqual(['manager', 'hr', 'admin']);
  });

  test('the service refuses an empty list too; an empty value stored another way counts as all three', async () => {
    await expect(approvals.setApprovalRoles('c1', [], ADMIN)).rejects.toThrow(/at least one/i);
    await settingsService.setSetting(approvals.APPROVAL_ROLES_KEY, { roles: [] }, ADMIN, 'c1');
    expect(await approvals.getApprovalRoles('c1')).toEqual(['manager', 'hr', 'admin']);
  });

  test('the existing confirm-by-code switch still saves on its own', async () => {
    const { payload, error } = await call(controller.updateCompany, { body: { confirmApproversByCode: false } });
    expect(error).toBeNull();
    expect(payload.data).toMatchObject({ confirmApproversByCode: false, approvalRoles: ['manager', 'hr', 'admin'] });
  });
});
