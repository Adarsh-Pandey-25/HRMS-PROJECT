const { makeFakeSupabase } = require('./fakeSupabase');

let mockDb;
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: new Proxy({}, { get: (_t, prop) => mockDb[prop] }) }));
jest.mock('../../src/config/database', () => ({ env: 'test', timezone: 'Asia/Kolkata' }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/settings.service', () => ({
  getSetting: jest.fn(async (key) => {
    if (key === 'company_profile') return { name: 'Spaxads Digital Media' };
    if (key === 'leave_policy') return [{ code: 'CL', name: 'Casual Leave' }];
    return null;
  }),
}));

const { EMAIL_TYPES } = require('../../src/services/emailCatalog');
const {
  EMAIL_RULES, DIRECT_EMAIL_RULES, KNOWN_NOTIFICATION_TYPES, directEmailEvent, notificationEvents,
} = require('../../src/services/whatsappCatalog');
const { getTemplate, paramCount } = require('../../src/services/whatsappTemplates');
const L = require('../../src/services/whatsappLookup');

// Values that must never reach WhatsApp. Every sample below carries them.
const SECRETS = [
  'S3cret-Pass!', '918273', '987654', 'Medical: surgery', 'sk_live_ABC', '203.0.113.9',
  'priya@private.example', 'rahul@private.example', 'ravi@private.example', '9876543210',
];

const employee = { id: 'e1', first_name: 'Priya', last_name: 'Verma', email: 'priya@private.example', company_id: 'c1' };
const manager = { id: 'm1', first_name: 'Rahul', last_name: 'Sharma', email: 'rahul@private.example', company_id: 'c1' };
const leave = {
  id: 'l1', leave_type: 'CL', from_date: '2026-11-03', to_date: '2026-11-04', total_days: 2, reason: 'Medical: surgery', approved_by: 'm1',
};
const addressee = { to: 'rahul@private.example', name: 'Rahul Sharma' };
const sub = { id: 's1', company_id: 'c1', current_period_end: '2026-12-01', companies: { id: 'c1', name: 'Spaxads' } };
const beaconRow = { id: 'b1', company_id: 'c1', label: 'Noida office', expected_region: 'IN' };

const SAMPLE_ARGS = {
  leave_applied: [employee, leave, { balanceAfterApproval: 5 }],
  leave_approval_request: [manager, employee, leave, { othersOnLeave: 1 }],
  leave_approved: [employee, leave, { approverName: 'Rahul Sharma', remainingBalance: 3 }],
  leave_rejected: [employee, leave, { approverName: 'Rahul Sharma', reason: 'Medical: surgery' }],
  leave_balance_changed: [employee, [{ code: 'CL', name: 'Casual Leave', from: 6, to: 8, available: 8 }], { year: 2026 }],
  leave_balance_changed_admin: [manager, employee, [{ code: 'CL', name: 'Casual Leave', from: 6, to: 8 }], { year: 2026 }],
  leave_balance_low: [employee, { leaveType: 'CL', remaining: 2, threshold: 3 }],
  attendance_absent_alert: [employee, '27 Oct 2026'],
  attendance_late_alert: [employee, '27 Oct 2026', 42],
  attendance_short_hours_alert: [employee, '27 Oct 2026', 6.17, 8],
  attendance_anomaly_digest: [manager, '27 Oct 2026', [{ type: 'absent' }, { type: 'late' }, { type: 'short_hours' }]],
  auto_checkout: [employee, { id: 'a1', check_in_time: '2026-10-27T04:30:00Z', total_hours: 9 }],
  regularization_approved: [employee, { dateLabel: '27 Oct 2026', checkIn: '09:30', checkOut: '18:30', approverName: 'Neha' }],
  regularization_rejected: [employee, { dateLabel: '27 Oct 2026', approverName: 'Neha', reason: 'Medical: surgery' }],
  payslip: [employee, { id: 'p1', month: 10, year: 2026, net_salary: 987654, gross_salary: 987654 }],
  salary_revised: [employee, { previousCtc: 987654, revisedCtc: 987654, effectiveDate: '2026-11-01', revisedBy: 'Anil' }],
  payroll_setup_changed_admin: [manager, employee, [{ label: 'PF', from: 'Off', to: 'On' }, { label: 'Extra deduction', from: 0, to: 987654 }]],
  payslip_failed: [manager, 'October 2026', [{ employeeName: 'Priya', reason: 'Medical: surgery' }]],
  pending_approvals_digest: [manager, 'Wed, 28 Oct', [{ label: 'Leave requests (2)', items: [{ name: 'a' }, { name: 'b' }] }]],
  joiner_digest: [manager, '26 Oct – 1 Nov', { joiners: [{}, {}], exits: [{}], headcount: 48 }],
  offer_accepted: [manager, { id: 'cand1', name: 'Amit Kumar', email: 'ravi@private.example' }, { role: 'Graphic Designer' }],
  offer_rejected: [manager, { id: 'cand1', name: 'Amit Kumar' }, { role: 'Graphic Designer', reason: 'Medical: surgery' }],
  account_deactivated: [employee, {}],
  checklist_reminder: [employee, ['Upload PAN']],
  onboarding_complete: [employee, { tasksDone: 5 }],
  offboarding_initiated: [employee, { lastWorkingDay: '2026-11-30' }],
  exit_checklist: [employee, {}],
  final_settlement: [employee, { netPayable: 987654, bankLast4: '1234' }],
  training_assignment: [employee, { id: 't1', title: 'POSH awareness' }],
  announcement: [employee, { id: 'an1', title: 'Office closed on 1 Nov', content: '<p>S3cret-Pass!</p>' }],
  holiday_list: [employee, [{ id: 'h1', date: '2027-01-26', title: 'Republic Day' }], { companyName: 'Spaxads' }],
  birthday_wish: [employee],
  work_anniversary: [employee, 3],
  api_key_created: [manager, { keyName: 'Payroll export', keyPrefix: 'sk_live_ABC', createdByName: 'Anil Gupta' }],
  api_key_revoked: [manager, { keyName: 'Payroll export', keyPrefix: 'sk_live_ABC', revokedByName: 'Anil Gupta' }],
  beacon_first_ping: [addressee, beaconRow, '203.0.113.9'],
  beacon_compromise_alert: [addressee, beaconRow, [{ observed_ip: '203.0.113.9' }]],
  beacon_geo_mismatch: [addressee, beaconRow, { proposedIp: '203.0.113.9', detectedRegion: 'US' }],
  subscription_welcome: [addressee, sub, { name: 'Growth' }],
  subscription_renewed: [addressee, sub, { invoice_number: 'INV-1', amount: 987654 }],
  subscription_plan_changed: [addressee, sub, { name: 'Starter' }, { name: 'Growth' }],
  subscription_renewal_reminder: [addressee, sub, { name: 'Growth' }, 987654, 'renewal_7d'],
  subscription_payment_failed: [addressee, sub, 'Card 987654 declined', 3],
  subscription_grace_period_ending: [addressee, sub, 2],
  subscription_suspended: [addressee, sub],
  subscription_trial_ending: [addressee, sub],
  subscription_trial_ended: [addressee, sub],
  lead_notification: ['admin@spaxsync.com', {
    id: 'lead1', type: 'trial', company_name: 'Acme', work_email: 'ravi@private.example', phone: '9876543210', full_name: 'Ravi',
  }],
};

const person = { first_name: 'Priya', last_name: 'Verma' };
const company = { id: 'c1', name: 'Spaxads Pvt' };

const expectSafeValues = (values, templateName) => {
  const template = getTemplate(templateName);
  expect(template).toBeTruthy();
  expect(values).toHaveLength(paramCount(template));
  for (const v of values) {
    expect(typeof v).toBe('string');
    expect(v.trim()).not.toBe('');
    for (const secret of SECRETS) expect(v).not.toContain(secret);
  }
};

beforeEach(() => {
  L._forgetCache();
  mockDb = makeFakeSupabase({
    leaves: [{ ...leave, employee_id: 'e1', company_id: 'c1' }],
    employees: [
      { id: 'e1', first_name: 'Priya', last_name: 'Verma', company_id: 'c1', email: 'priya@private.example' },
      { id: 'm1', first_name: 'Rahul', last_name: 'Sharma', company_id: 'c1', email: 'rahul@private.example' },
    ],
    wfh_day_requests: [
      { id: 'w1', employee_id: 'e1', work_date: '2026-11-05', batch_id: 'wb1' },
      { id: 'w2', employee_id: 'e1', work_date: '2026-11-06', batch_id: 'wb1' },
    ],
    helpdesk_tickets: [
      { id: 't1', subject: 'Laptop not charging', raised_by: 'e1', status: 'open' },
      { id: 't2', subject: 'Attendance correction — 27 Oct 2026', raised_by: 'e1', status: 'open' },
    ],
    documents: [{ id: 'd1', employee_id: 'e1', document_type: 'pan', document_name: 'priya-pan-918273.pdf' }],
    reimbursements: [{ id: 'r1', employee_id: 'e1', reimbursement_type: 'travel', amount: 987654, description: 'Medical: surgery' }],
    holidays: [{ id: 'h1', date: '2027-01-26' }],
    leave_types: [],
  });
});

describe('every email has a WhatsApp decision', () => {
  test('each email type in emailCatalog.js is covered', () => {
    const covered = new Set([...Object.keys(EMAIL_RULES), ...Object.keys(DIRECT_EMAIL_RULES)]);
    const missing = EMAIL_TYPES.map((t) => t.key).filter((key) => !covered.has(key));
    expect(missing).toEqual([]);
  });

  test('exactly these never go to WhatsApp', () => {
    const neverKeys = Object.entries(EMAIL_RULES).filter(([, r]) => r.never).map(([k]) => k).sort();
    expect(neverKeys).toEqual([
      'bulk_import', 'company_invite', 'day_one', 'lead_confirmation', 'notification', 'offer_letter',
      'onboarding_invite', 'onboarding_otp', 'password_reset', 'prejoining', 'welcome',
    ]);
  });

  const ruleKeys = Object.entries(EMAIL_RULES).filter(([, r]) => !r.never).map(([k]) => k);

  test.each(ruleKeys)('%s builds a safe, complete message', async (key) => {
    const rule = EMAIL_RULES[key];
    expect(SAMPLE_ARGS[key]).toBeDefined();
    const event = rule.event(SAMPLE_ARGS[key]);
    expect(event).toBeTruthy();
    expect(event.key).toBeTruthy();
    expect(event.to).toBeTruthy();
    const values = await event.values({ person, company });
    expectSafeValues(values, event.template || rule.template);
  });

  test('an empty pending-approvals digest sends nothing', () => {
    expect(EMAIL_RULES.pending_approvals_digest.event([manager, 'Wed', []])).toBeNull();
  });

  test('platform alerts sent directly become a super-admin message; other direct emails do not', async () => {
    for (const type of Object.keys(DIRECT_EMAIL_RULES)) {
      const event = directEmailEvent({ type, subject: '[SpaxSync] Scheduled job failed: autoPayroll' });
      expect(event.to).toEqual({ superAdmins: true });
      expect(await event.values()).toEqual(['Scheduled job failed: autoPayroll']);
    }
    expect(directEmailEvent({ type: 'welcome', subject: 'x' })).toBeNull();
  });
});

describe('every in-app notification has a WhatsApp decision', () => {
  const item = (fields) => ({ id: 'n1', user_id: 'e1', meta: {}, ...fields });

  const SAMPLES = [
    item({ type: 'LEAVE', title: 'Leave request pending approval', meta: { leave_id: 'l1' } }),
    item({ type: 'LEAVE', title: 'Leave request submitted', meta: { leave_id: 'l1' } }),
    item({ type: 'LEAVE', title: 'Leave needs HR approval', meta: { leave_id: 'l1', employee_id: 'e1' } }),
    item({ type: 'LEAVE', title: 'Leave approved', meta: { leave_id: 'l1' } }),
    item({ type: 'LEAVE', title: 'Leave rejected', message: 'Reason: Medical: surgery', meta: { leave_id: 'l1' } }),
    item({ type: 'ATTENDANCE', title: 'WFH request pending', meta: { wfh_batch_id: 'wb1', work_dates: ['2026-11-05', '2026-11-06'] } }),
    item({ type: 'ATTENDANCE', title: 'WFH approved', meta: { wfh_request_id: 'w1', work_date: '2026-11-05', status: 'approved' } }),
    item({ type: 'ATTENDANCE', title: 'WFH rejected', message: 'Medical: surgery', meta: { wfh_request_id: 'w1', status: 'rejected' } }),
    item({ type: 'PAYROLL', title: 'Payslip published', meta: { payslip_id: 'p1', month: 10, year: 2026 } }),
    item({ type: 'TRAINING', title: 'Reminder: complete your onboarding training' }),
    item({ type: 'BIRTHDAY', title: 'Happy Birthday!', meta: { employee_id: 'e1', is_birthday: true } }),
    item({ type: 'ANNIVERSARY', title: 'Happy Work Anniversary!', meta: { employee_id: 'e1', is_anniversary: true, years_of_service: 3 } }),
    item({ type: 'BIRTHDAY', title: "Priya's birthday today", meta: { celebrant_id: 'e9', celebrant_name: 'Priya Verma', is_birthday: true } }),
    item({ type: 'ANNOUNCEMENT', title: 'New announcement', message: 'Office closed on 1 Nov', meta: { announcement_id: 'an1' } }),
    item({ type: 'HOLIDAY', title: 'Holiday list updated', meta: { holiday_ids: ['h1'] } }),
    item({ type: 'TICKET', title: 'New helpdesk ticket', meta: { ticket_id: 't1' } }),
    item({ type: 'TICKET', title: 'Ticket resolved', meta: { ticket_id: 't1', status: 'resolved' } }),
    item({ type: 'TICKET', title: 'New reply on your ticket', meta: { ticket_id: 't1' } }),
    item({ type: 'TICKET', title: 'Ticket updated', meta: { ticket_id: 't1' } }),
    item({ type: 'DOCUMENT', title: 'Document pending verification', meta: { document_id: 'd1', employee_id: 'e1' } }),
    item({ type: 'DOCUMENT', title: 'Document verified', meta: { document_id: 'd1' } }),
    item({ type: 'REIMBURSEMENT', title: 'Reimbursement pending approval', message: 'claim (₹987654)', meta: { reimbursement_id: 'r1' } }),
    item({ type: 'REIMBURSEMENT', title: 'Reimbursement needs HR approval', meta: { reimbursement_id: 'r1', employee_id: 'e1' } }),
    item({ type: 'REIMBURSEMENT', title: 'Reimbursement approved', meta: { reimbursement_id: 'r1' } }),
    item({ type: 'REIMBURSEMENT', title: 'Reimbursement rejected', message: 'Reason: Medical: surgery', meta: { reimbursement_id: 'r1' } }),
  ];

  test('every known notification type is exercised here', () => {
    const exercised = new Set(SAMPLES.map((s) => s.type));
    expect(KNOWN_NOTIFICATION_TYPES.filter((t) => !exercised.has(t))).toEqual([]);
  });

  test.each(SAMPLES.map((s) => [`${s.type}: ${s.title}`, s]))('%s builds a safe, complete message', async (_label, sample) => {
    const events = await notificationEvents(sample);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.to).toEqual({ employees: ['e1'] });
      expect(event.template).not.toBe('general_update');
      expectSafeValues(await event.values({ person, company }), event.template);
    }
  });

  test('attendance-correction tickets are not doubled: the decision email covers them', async () => {
    expect(await notificationEvents(item({ type: 'TICKET', title: 'Ticket resolved', meta: { ticket_id: 't2', status: 'resolved' } }))).toEqual([]);
    expect(await notificationEvents(item({ type: 'TICKET', title: 'New reply on your ticket', meta: { ticket_id: 't2' } }))).toEqual([]);
    const [waiting] = await notificationEvents(item({ type: 'TICKET', title: 'New helpdesk ticket', meta: { ticket_id: 't2' } }));
    expect(waiting.template).toBe('approval_waiting');
    expect((await waiting.values({ person, company }))[3]).toBe('attendance correction for 27 Oct 2026');
  });

  test('an unknown notification still reaches the person as a one-line update', async () => {
    const [event] = await notificationEvents(item({ type: 'SOMETHING_NEW', title: 'Your goal was reviewed' }));
    expect(event.template).toBe('general_update');
    expect(await event.values({ person, company })).toEqual(['Priya', 'Spaxads Digital Media', 'Your goal was reviewed']);
  });

  test('the email and the in-app notification of one event share a key and record (so one message is sent)', async () => {
    const fromEmail = EMAIL_RULES.leave_approved.event(SAMPLE_ARGS.leave_approved);
    const [fromApp] = await notificationEvents(item({ type: 'LEAVE', title: 'Leave approved', meta: { leave_id: 'l1' } }));
    expect([fromApp.key, String(fromApp.record)]).toEqual([fromEmail.key, String(fromEmail.record)]);

    const payslipEmail = EMAIL_RULES.payslip.event(SAMPLE_ARGS.payslip);
    const [payslipApp] = await notificationEvents(item({ type: 'PAYROLL', title: 'Payslip published', meta: { month: 10, year: 2026 } }));
    expect([payslipApp.key, payslipApp.record]).toEqual([payslipEmail.key, payslipEmail.record]);

    const annEmail = EMAIL_RULES.announcement.event(SAMPLE_ARGS.announcement);
    const [annApp] = await notificationEvents(item({ type: 'ANNOUNCEMENT', title: 'New announcement', message: 'Office closed on 1 Nov', meta: { announcement_id: 'an1' } }));
    expect([annApp.key, annApp.record]).toEqual([annEmail.key, annEmail.record]);
  });

  test('approval messages name the requester and the leave in plain words', async () => {
    const [event] = await notificationEvents(item({ type: 'LEAVE', title: 'Leave request submitted', meta: { leave_id: 'l1' } }));
    expect(await event.values({ person: { first_name: 'Neha' }, company }))
      .toEqual(['Neha', 'Priya Verma', 'Spaxads Digital Media', 'Casual Leave for 3–4 Nov 2026']);
  });
});
