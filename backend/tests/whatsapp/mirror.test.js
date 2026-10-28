jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: {} }));
jest.mock('../../src/config/database', () => ({ env: 'test', timezone: 'Asia/Kolkata' }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/whatsappOutbox.service', () => ({ queueEvent: jest.fn(async () => 1) }));
jest.mock('../../src/services/whatsappLookup', () => ({
  ...jest.requireActual('../../src/services/whatsappLookup'),
  employeeIdByEmail: jest.fn(async () => 'admin-1'),
}));

const outbox = require('../../src/services/whatsappOutbox.service');
const mirror = require('../../src/services/whatsappMirror');

const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const employee = { id: 'e1', first_name: 'Priya' };
const leave = { id: 'l1', leave_type: 'CL', from_date: '2026-11-03', to_date: '2026-11-04' };

beforeEach(() => {
  outbox.queueEvent.mockClear();
  process.env.WHATSAPP_ENABLED = 'true';
});
afterAll(() => { delete process.env.WHATSAPP_ENABLED; });

describe('whatsappMirror', () => {
  test('does nothing at all while WhatsApp is switched off', async () => {
    process.env.WHATSAPP_ENABLED = '';
    mirror.fromEmail('leave_approved', [employee, leave, {}]);
    mirror.fromNotifications([{ id: 'n1', user_id: 'e1', type: 'LEAVE', title: 'Leave approved', meta: { leave_id: 'l1' } }]);
    mirror.fromDirectEmail({ type: 'cron_failure_alert', subject: 'x' });
    await flush();
    expect(outbox.queueEvent).not.toHaveBeenCalled();
  });

  test('an email becomes its WhatsApp event', async () => {
    mirror.fromEmail('leave_approved', [employee, leave, { approverName: 'Rahul' }]);
    await flush();
    expect(outbox.queueEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'leave_approved', template: 'leave_approved', group: 'leave', recordKey: 'l1',
      recipients: [{ subjectType: 'employee', subjectId: 'e1' }], source: 'email:leave_approved',
    }));
  });

  test('emails that carry passwords or codes never become a WhatsApp message', async () => {
    mirror.fromEmail('welcome', [employee, 'S3cret-Pass!']);
    mirror.fromEmail('password_reset', [employee, '918273']);
    mirror.fromEmail('notification', [employee, { title: 'x' }]); // the in-app row sends it instead
    await flush();
    expect(outbox.queueEvent).not.toHaveBeenCalled();
  });

  test('emails addressed as { to, name } are matched to the employee in that company', async () => {
    mirror.fromEmail('subscription_trial_ending', [{ to: 'admin@company.test', name: 'Anil' }, { id: 's1', company_id: 'c1', current_period_end: '2026-11-01' }]);
    await flush();
    expect(outbox.queueEvent).toHaveBeenCalledWith(expect.objectContaining({
      template: 'billing_update', recipients: [{ subjectType: 'employee', subjectId: 'admin-1' }],
    }));
  });

  test('a fan-out (an announcement to everyone) is one event with many recipients', async () => {
    const rows = ['e1', 'e2', 'e3'].map((user_id, i) => ({
      id: `n${i}`, user_id, type: 'ANNOUNCEMENT', title: 'New announcement', message: 'Office closed', meta: { announcement_id: 'a1' },
    }));
    mirror.fromNotifications(rows);
    await flush();
    expect(outbox.queueEvent).toHaveBeenCalledTimes(1);
    expect(outbox.queueEvent.mock.calls[0][0]).toMatchObject({
      eventKey: 'company_announcement',
      recipients: [
        { subjectType: 'employee', subjectId: 'e1' },
        { subjectType: 'employee', subjectId: 'e2' },
        { subjectType: 'employee', subjectId: 'e3' },
      ],
    });
  });

  test('platform alerts go to super admins', async () => {
    mirror.fromDirectEmail({ type: 'cron_failure_alert', subject: '[SpaxSync] Scheduled job failed: autoPayroll' });
    await flush();
    expect(outbox.queueEvent).toHaveBeenCalledWith(expect.objectContaining({ template: 'platform_alert', recipients: 'super_admins' }));
  });
});
