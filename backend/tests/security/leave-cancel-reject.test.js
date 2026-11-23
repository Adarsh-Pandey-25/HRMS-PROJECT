/**
 * Audit #18 and #19: an employee could cancel an approved leave that had
 * already started or been paid for and get the days back; two cancels at the
 * same moment gave the days back twice; and reject/cancel didn't check the
 * leave was still in the state they read, so a WhatsApp Reject racing a
 * website Approve could leave a "rejected" leave with its days deducted.
 * In-memory database; notifications and emails are stand-ins.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: (...a) => mockDb.current.from(...a) } }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/notification.service', () => ({
  markReviewNotificationsRead: jest.fn(async () => {}),
  createNotification: jest.fn(async () => ({})),
}));
jest.mock('../../src/services/email.service', () => new Proxy({}, { get: () => jest.fn(async () => {}) }));
jest.mock('../../src/services/approvalFlow.service', () => ({
  getLeaveFlow: async () => 'manager-only',
  decideRejection: () => ({ ok: true }),
}));
jest.mock('../../src/services/attendance.service', () => ({ getTeamEmployeeIds: async () => ['emp1'] }));
jest.mock('../../src/services/settings.service', () => ({ getSetting: async () => null }));

const mockDb = { current: null };
const moment = require('moment-timezone');
const { makeFakeSupabase } = require('./helpers/fakeSupabase');
const leaveService = require('../../src/services/leave.service');
const { BadRequestError, ConflictError } = require('../../src/utils/errors');

const day = (offset) => moment().tz('Asia/Kolkata').add(offset, 'days').format('YYYY-MM-DD');
const leave = (id, status, from) => ({
  id, employee_id: 'emp1', status, from_date: from, to_date: from, total_days: 1, leave_type: 'CL',
  employee: { id: 'emp1', company_id: 'c1', address: {} },
});
let tables;

beforeEach(() => {
  tables = {
    leaves: [leave('past', 'approved', day(-3)), leave('today', 'approved', day(0)), leave('future', 'approved', day(5)), leave('pend', 'pending', day(5))],
    leave_balances: [{ id: 'b1', employee_id: 'emp1', year: moment(day(5)).year(), leave_type: 'CL', used: 3 }],
  };
  mockDb.current = makeFakeSupabase(tables);
});

const status = (id) => tables.leaves.find((l) => l.id === id).status;
const used = () => tables.leave_balances[0].used;

test('an approved leave that has started or passed can\'t be cancelled by the employee', async () => {
  await expect(leaveService.cancelLeave('emp1', 'past')).rejects.toBeInstanceOf(BadRequestError);
  await expect(leaveService.cancelLeave('emp1', 'today')).rejects.toThrow(/already started/);
  expect(status('past')).toBe('approved');
  expect(used()).toBe(3);
});

test('a future approved leave can be cancelled; two cancels at the same moment give the day back once', async () => {
  const results = await Promise.allSettled([leaveService.cancelLeave('emp1', 'future'), leaveService.cancelLeave('emp1', 'future')]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((r) => r.status === 'rejected').reason).toBeInstanceOf(ConflictError);
  expect(status('future')).toBe('cancelled');
  expect(used()).toBe(2);
});

test('a pending leave can still be cancelled', async () => {
  await leaveService.cancelLeave('emp1', 'pend');
  expect(status('pend')).toBe('cancelled');
  expect(used()).toBe(3);
});

test('reject writes only while the leave is still pending', async () => {
  const approver = { id: 'mgr1', role: 'manager', company_id: 'c1', first_name: 'M' };
  // Approved on the website between the read and the write:
  const realFrom = mockDb.current.from;
  let flipped = false;
  mockDb.current = {
    ...mockDb.current,
    from: (table) => {
      if (table === 'leaves' && !flipped) {
        flipped = true;
        const q = realFrom(table);
        const realThen = q.then.bind(q);
        // The leave is read as pending, then approved before reject writes.
        q.then = (resolve, reject) => realThen((result) => {
          tables.leaves.find((l) => l.id === 'pend').status = 'approved';
          return resolve(result);
        }, reject);
        return q;
      }
      return realFrom(table);
    },
  };
  await expect(leaveService.rejectLeave(approver, 'pend', 'No')).rejects.toBeInstanceOf(ConflictError);
  expect(status('pend')).toBe('approved');
});
