/**
 * The salary TDS register and the Form 138 data file. The database is a
 * stand-in: each table returns the rows in global.__mockTables (filters are
 * not applied, so the tables hold only this company's rows). Read-only.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const builder = (table) => {
    const rows = () => (global.__mockTables?.[table] || []);
    const q = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt', 'order', 'range', 'limit', 'is', 'not', 'or', 'ilike', 'filter', 'match']) {
      q[m] = () => q;
    }
    q.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    q.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    q.then = (resolve, reject) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    return q;
  };
  return { supabaseAdmin: { from: (t) => builder(t) } };
});

const { getTdsRegister, getForm138Csv, csvCell } = require('../../src/services/tdsRegister.service');

const slip = (employeeId, month, year, gross, tds, status = 'PUBLISHED', extra = {}) => ({
  id: `${employeeId}-${year}-${month}`,
  employee_id: employeeId,
  company_id: 'c1',
  month,
  year,
  gross_salary: gross,
  tds,
  payslip_status: status,
  published_at: status === 'PUBLISHED' ? `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-05T05:00:00Z` : null,
  breakdown_json: { config: { tax: { regime: 'new', annual_tax: 292500 } } },
  ...extra,
});

beforeAll(() => {
  global.__mockTables = {
    payroll: [
      slip('e1', 10, 2026, 200000, 24375),
      slip('e1', 11, 2026, 200000, 24375),
      slip('e2', 10, 2026, 40000, 0),
      slip('e2', 11, 2026, 40000, 0, 'DRAFT'),
      slip('e1', 3, 2026, 200000, 24375), // the previous tax year
    ],
    employees: [
      { id: 'e1', first_name: 'Asha', last_name: 'Rao', employee_code: 'E1', salary_details: { statutory_ids: { pan: 'abcde1234f' } } },
      { id: 'e2', first_name: '=HYPERLINK("x")', last_name: '', employee_code: 'E2', salary_details: {} },
    ],
  };
});
afterAll(() => { delete global.__mockTables; });

test('register: published payslips only, by month, quarter and employee', async () => {
  const r = await getTdsRegister('c1', '2026-27');
  expect(r.taxYear).toBe('2026-27');
  expect(r.months).toHaveLength(12);
  const oct = r.months.find((m) => m.month === 10);
  expect(oct).toMatchObject({
    year: 2026, quarter: 'Q3', payslips: 2, withTds: 1, gross: 240000, tds: 24375, depositBy: '2026-11-07', drafts: 0,
  });
  const nov = r.months.find((m) => m.month === 11);
  expect(nov).toMatchObject({ payslips: 1, tds: 24375, drafts: 1, depositBy: '2026-12-07' });
  expect(r.months.find((m) => m.month === 3)).toMatchObject({ year: 2027, payslips: 0, depositToConfirm: true });
  expect(r.quarters.find((q) => q.key === 'Q3')).toMatchObject({ payslips: 3, employees: 2, tds: 48750, gross: 440000 });
  expect(r.quarters.find((q) => q.key === 'Q4').tds).toBe(0); // March 2026 belongs to 2025-26
  expect(r.totals).toEqual({ gross: 440000, tds: 48750 });
  expect(r.draftsNotCounted).toBe(1);
  const asha = r.employees.find((e) => e.employeeId === 'e1');
  expect(asha).toMatchObject({
    pan: 'ABCDE1234F', regime: 'new', payslips: 2, tds: 48750, projectedAnnualTax: 292500,
  });
  expect(asha.byMonth).toEqual({ '2026-10': 24375, '2026-11': 24375 });
  expect(r.withoutPan).toBe(0); // the one without a PAN had no TDS
});

test('a tax year that is not a tax year is refused', async () => {
  await expect(getTdsRegister('c1', '2026-28')).rejects.toThrow(/2026-27/);
  await expect(getTdsRegister('c1', 'x')).rejects.toThrow(/2026-27/);
});

test('Form 138 data: one row per published payslip in the quarter, safe to open in a spreadsheet', async () => {
  const { csv, filename, rows } = await getForm138Csv('c1', '2026-27', 'q3');
  expect(filename).toBe('form138-data-2026-27-Q3.csv');
  expect(rows).toBe(3);
  const lines = csv.trim().split('\r\n');
  expect(lines[0]).toBe('Employee code,Employee name,PAN,Month,Paid on,Amount paid (Rs),TDS deducted (Rs),Section,Tax regime');
  expect(lines).toContain('E1,Asha Rao,ABCDE1234F,Oct 2026,2026-11-05,200000.00,24375.00,392 (salary),new');
  // A name that starts like a formula is written as text, quoted.
  expect(lines.find((l) => l.startsWith('E2,'))).toBe('E2,"\'=HYPERLINK(""x"")",PANNOTAVBL,Oct 2026,2026-11-05,40000.00,0.00,392 (salary),new');
  await expect(getForm138Csv('c1', '2026-27', 'Q5')).rejects.toThrow(/Q1, Q2, Q3 or Q4/);
});

test('CSV cells', () => {
  expect(csvCell('plain')).toBe('plain');
  expect(csvCell('a,b')).toBe('"a,b"');
  expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  expect(csvCell('=1+1')).toBe("'=1+1");
  expect(csvCell('-5')).toBe("'-5");
  expect(csvCell(null)).toBe('');
});
