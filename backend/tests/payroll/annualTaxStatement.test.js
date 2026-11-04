/**
 * The annual salary and tax statement (figures for Form 130 Part B) on the
 * actual year. The database is a stand-in returning the rows in
 * global.__mockTables (filters not applied). Read-only.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const builder = (table) => {
    const rows = () => global.__mockTables?.[table] || [];
    const q = {};
    for (const m of ['select', 'eq', 'in', 'order']) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    q.then = (resolve, reject) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    return q;
  };
  return { supabaseAdmin: { from: (t) => builder(t) } };
});

const { getAnnualTaxStatement } = require('../../src/services/annualTaxStatement.service');

const slip = (month, year, gross, tds, pt = 200, status = 'PUBLISHED') => ({
  month, year, gross_salary: gross, tds, professional_tax: pt, payslip_status: status, company_id: 'c1',
});

test('someone who left after October: tax on what was actually paid, and the TDS over-deducted', async () => {
  // April–October at ₹2 lakh, TDS 24,375 each month (projected on a full year)
  global.__mockTables = {
    employees: [{ id: 'e1', company_id: 'c1', first_name: 'Asha', last_name: 'Rao', salary_details: { statutory_ids: { pan: 'ABCDE1234F' } } }],
    payroll: [4, 5, 6, 7, 8, 9, 10].map((m) => slip(m, 2026, 200000, 24375)).concat([slip(11, 2026, 200000, 0, 200, 'DRAFT'), slip(3, 2026, 99, 99)]),
  };
  const s = await getAnnualTaxStatement('c1', 'e1', '2026-27');
  // 14,00,000 − 75,000 = 13,25,000 → 20,000 + 40,000 + 15% × 1,25,000 (18,750) = 78,750 + cess 3,150 = 81,900
  expect(s.months).toBe(7);
  expect(s.draftsNotCounted).toBe(1);
  expect(s.salary.total).toBe(1400000);
  expect(s.taxableIncome).toBe(1325000);
  expect(s.tax.total).toBe(81900);
  expect(s.tds.byQuarter).toEqual([
    { quarter: 'Q1', amount: 73125 }, { quarter: 'Q2', amount: 73125 }, { quarter: 'Q3', amount: 24375 }, { quarter: 'Q4', amount: 0 },
  ]);
  expect(s.tds.total).toBe(170625);
  expect(s.balance).toBe(-88725); // deducted more than due: refunded through the employee's return
  expect(s.employee.pan).toBe('ABCDE1234F');
});

test('old regime: PT, exemptions and allowed deductions come off; outside salary and TDS count', async () => {
  global.__mockTables = {
    employees: [{
      id: 'e1',
      company_id: 'c1',
      date_of_birth: '1990-01-01',
      salary_details: {
        tax_profile: {
          years: {
            '2026-27': {
              regime: 'old', previous_employer_income: 300000, previous_employer_tds: 10000, hra_exemption: 60000, chapter8_deductions: 150000,
            },
          },
        },
      },
    }],
    payroll: [10, 11, 12, 1, 2, 3].map((m) => slip(m, m >= 4 ? 2026 : 2027, 100000, 5000)),
  };
  const s = await getAnnualTaxStatement('c1', 'e1', '2026-27');
  // Salary 6,00,000 + 3,00,000 = 9,00,000; − HRA 60,000 − standard 50,000 − PT 1,200 = 7,88,800 from salary;
  // − Chapter VIII 1,50,000 = 6,38,800 → 12,500 + 20% × 1,38,800 (27,760) = 40,260 + cess 1,610.40 = 41,870.40 → ₹10: 41,870
  expect(s.incomeFromSalary).toBe(788800);
  expect(s.taxableIncome).toBe(638800);
  expect(s.tax.total).toBe(41870);
  expect(s.tds.total).toBe(40000); // 6 × 5,000 + 10,000 from the previous employer
  expect(s.balance).toBe(1870);
  expect(s.ageBand).toBe('under_60');
});

test('another company\'s employee is not found', async () => {
  global.__mockTables = { employees: [{ id: 'e9', company_id: 'c2' }], payroll: [] };
  await expect(getAnnualTaxStatement('c1', 'e9', '2026-27')).rejects.toThrow(/not found/);
});
