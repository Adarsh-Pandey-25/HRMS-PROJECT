/**
 * Paying salaries separately from publishing (defect D11): the bank file and
 * "mark paid" with the bank's reference. The database is a stand-in: each
 * table returns the rows in global.__mockTables (filters are not applied).
 * Nothing is sent; the audit log is a stand-in too.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const builder = (table) => {
    const q = { updateFields: null };
    for (const m of ['select', 'eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt', 'order', 'range', 'limit', 'is', 'not', 'or']) {
      q[m] = () => q;
    }
    q.update = (fields) => { q.updateFields = fields; global.__updates.push({ table, fields }); return q; };
    q.then = (resolve, reject) => {
      if (q.updateFields && global.__missingPaymentColumns && 'paid_on' in q.updateFields) {
        return Promise.resolve({ data: null, error: { message: "Could not find the 'paid_on' column of 'payroll' in the schema cache" } }).then(resolve, reject);
      }
      return Promise.resolve({ data: global.__mockTables?.[table] || [], error: null }).then(resolve, reject);
    };
    return q;
  };
  return { supabaseAdmin: { from: (t) => builder(t) } };
});
jest.mock('../../src/services/auditLog.service', () => ({ logAudit: () => Promise.resolve() }));

const moment = require('moment-timezone');
const { getBankFile, markPaid } = require('../../src/services/payrollPayment.service');

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  global.__updates = [];
  global.__missingPaymentColumns = false;
  global.__mockTables = {
    payroll: [
      {
        id: ID1, employee_id: 'e1', company_id: 'c1', month: 10, year: 2026, net_salary: 33764, payslip_status: 'PUBLISHED',
        breakdown_json: { totals: { net_pay: 33764, total_reimbursements: 123.45, net_payable: 33887 } },
      },
      {
        id: ID2, employee_id: 'e2', company_id: 'c1', month: 10, year: 2026, net_salary: 20000, payslip_status: 'PUBLISHED',
        breakdown_json: { totals: { net_pay: 20000 } },
      },
    ],
    employees: [
      // Saved by onboarding: ifsc_code and the account holder's name
      { id: 'e1', first_name: 'Asha', last_name: 'Rao', employee_code: 'E1', bank_details: { bank_name: 'HDFC Bank', account_number: '0012 3456 7890', ifsc_code: 'hdfc0001234', account_holder_name: 'ASHA RAO' } },
      { id: 'e2', first_name: 'Ravi', last_name: 'K', employee_code: 'E2', bank_details: { bank_name: 'SBI' } },
    ],
  };
});
afterAll(() => {
  delete global.__mockTables; delete global.__updates; delete global.__missingPaymentColumns;
});

test('bank file: net payable (with reimbursements) for each published payslip that can be paid', async () => {
  const f = await getBankFile('c1', 10, 2026);
  const lines = f.csv.trim().split('\r\n');
  expect(lines).toEqual([
    'Beneficiary name,Account number,IFSC,Bank,Amount (Rs),Narration,Employee code',
    'ASHA RAO,001234567890,HDFC0001234,HDFC Bank,33887.00,Salary Oct 2026,E1',
  ]);
  expect(f).toMatchObject({ filename: 'bank-file-2026-10.csv', count: 1, total: 33887 });
  expect(f.skipped).toEqual([{ employeeId: 'e2', name: 'Ravi K', reason: 'No account number or IFSC' }]);
  await expect(getBankFile('c1', 13, 2026)).rejects.toThrow(/month and year/);
});

test('mark paid: date and bank reference saved on published payslips of the company', async () => {
  const today = moment.tz('Asia/Kolkata').format('YYYY-MM-DD');
  const r = await markPaid({
    companyId: 'c1', payslipIds: [ID1, ID2], paidOn: today, reference: 'UTR123456789', actor: { id: 'hr1', role: 'hr' },
  });
  expect(r).toEqual({ updated: 2, referenceStored: true });
  expect(global.__updates).toEqual([{ table: 'payroll', fields: { payment_status: 'paid', paid_on: today, payment_reference: 'UTR123456789' } }]);
});

test('mark paid before the SQL is run: the status is saved, the reference is not', async () => {
  global.__missingPaymentColumns = true;
  const today = moment.tz('Asia/Kolkata').format('YYYY-MM-DD');
  const r = await markPaid({ companyId: 'c1', payslipIds: [ID1], paidOn: today, reference: 'BATCH-7' });
  expect(r.referenceStored).toBe(false);
  expect(global.__updates.map((u) => u.fields)).toEqual([
    { payment_status: 'paid', paid_on: today, payment_reference: 'BATCH-7' },
    { payment_status: 'paid' },
  ]);
});

test('mark paid refuses what is wrong', async () => {
  const today = moment.tz('Asia/Kolkata').format('YYYY-MM-DD');
  const tomorrow = moment.tz('Asia/Kolkata').add(1, 'day').format('YYYY-MM-DD');
  const ok = { companyId: 'c1', payslipIds: [ID1], paidOn: today, reference: 'UTR1234' };
  await expect(markPaid({ ...ok, payslipIds: [] })).rejects.toThrow(/Choose the payslips/);
  await expect(markPaid({ ...ok, payslipIds: ['x'] })).rejects.toThrow(/Unknown payslip/);
  await expect(markPaid({ ...ok, paidOn: tomorrow })).rejects.toThrow(/future/);
  await expect(markPaid({ ...ok, paidOn: '2026-09-30' })).rejects.toThrow(/before the payslip's month/);
  await expect(markPaid({ ...ok, reference: '=1' })).rejects.toThrow(/bank reference/);
  await expect(markPaid({ ...ok, companyId: 'other' })).rejects.toThrow(/weren't found/);
  global.__mockTables.payroll[0].payslip_status = 'DRAFT';
  await expect(markPaid(ok)).rejects.toThrow(/Only published payslips/);
  expect(global.__updates).toEqual([]);
});
