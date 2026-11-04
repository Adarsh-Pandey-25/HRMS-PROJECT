/**
 * The payslip PDF builds with every block (rates, tax working, employer
 * contributions, year to date, the statutory numbers saved at publishing)
 * and with each one switched off. The database is a stand-in; nothing is
 * stored or sent. The PDF's text is checked in its uncompressed form.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const q = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) q[m] = () => q;
  q.maybeSingle = () => Promise.resolve({ data: { name: 'Acme Private Limited' }, error: null });
  q.then = (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
  return { supabaseAdmin: { from: () => q, storage: { from: () => ({ download: async () => ({ data: null, error: { message: 'none' } }) }) } } };
});
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const zlib = require('zlib');
const { buildPayslipPdfBuffer } = require('../../src/services/payslipPdf.service');

const employee = {
  id: 'e1', company_id: 'c1', first_name: 'Asha', last_name: 'Rao', salary_details: { statutory_ids: { pan: 'LIVEP1234Q' } }, bank_details: {},
};
const payslip = (display = {}) => ({
  month: 10,
  year: 2026,
  gross_salary: 36364,
  unpaid_leave_days: 2,
  breakdown_json: {
    earnings: [{ name: 'Basic', amount: 20000, rate: 22000 }, { name: 'HRA', amount: 8000, rate: 8800 }, { name: 'Special Allowance', amount: 8364, rate: 9200 }],
    deductions: [{ name: 'PF', amount: 2400 }, { name: 'Professional Tax', amount: 200 }],
    employer_contributions: [{ name: 'Employer PF — pension (EPS)', amount: 1666 }, { name: 'EDLI', amount: 100 }],
    reimbursements: [],
    totals: { gross_salary: 36364, total_deductions: 2600, net_pay: 33764, net_payable: 33764 },
    meta: {
      employee_name: 'Asha Rao', paid_days: 20, lop_days: 2, working_days: 22, ctc: 514320,
      ytd: { tax_year: '2026-27', months: 7, gross: 254548, pf: 16800, esi: 0, pt: 1400, tds: 0, net: 236348 },
      ids: { pan: 'SAVED1234X', uan: '100200300400', esic_ip: null },
      leave: [{ code: 'CL', name: 'Casual Leave', available: 6 }, { code: 'SL', name: 'Sick Leave', available: 7.5 }],
    },
    config: {
      tds_mode: 'company',
      tax: { applied: true, regime: 'new', tax_year: '2026-27', taxable_income: 400000, annual_tax: 0, tds_before: 0, tds: 0 },
      payslip_display: display,
    },
  },
});
// The text drawn on the pages (pdfkit writes it as hex strings inside compressed streams).
const textOf = (pdf) => {
  const raw = pdf.toString('latin1');
  const out = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(raw))) {
    let body = Buffer.from(m[1], 'latin1');
    try { body = zlib.inflateSync(body); } catch { /* not compressed */ }
    const s = body.toString('latin1');
    for (const h of s.match(/<([0-9a-fA-F]+)>/g) || []) out.push(Buffer.from(h.slice(1, -1), 'hex').toString('latin1'));
    for (const t of s.match(/\((?:\\.|[^\\)])*\)/g) || []) out.push(t.slice(1, -1));
  }
  return out.join('');
};

test('every block: rates, tax working, employer contributions, year to date and the saved PAN', async () => {
  const pdf = await buildPayslipPdfBuffer(employee, payslip(), { month: 10, year: 2026 }, { companyId: 'c1' });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  const text = textOf(pdf);
  expect(text).toContain('RATE');
  expect(text).toContain('YEAR TO DATE');
  expect(text).toContain('INCOME TAX (TDS)');
  expect(text).toContain('EMPLOYER CONTRIBUTIONS');
  // The PAN saved when it was published, not today's.
  expect(text).toContain('SAVED1234X');
  expect(text).toContain('Leave balance: CL 6');
  expect(text).not.toContain('LIVEP1234Q');
});

test('with rates, employer contributions and the tax working switched off', async () => {
  const pdf = await buildPayslipPdfBuffer(employee, payslip({ show_rates: false, show_employer: false, show_tax_working: false }), { month: 10, year: 2026 }, { companyId: 'c1' });
  const text = textOf(pdf);
  expect(text).not.toContain('RATE');
  expect(text).not.toContain('EMPLOYER CONTRIBUTIONS');
  expect(text).not.toContain('INCOME TAX (TDS)');
  expect(text).toContain('YEAR TO DATE');
});

test('a long payslip stays on one page, longer than A4, with nothing cut off; only Basic is "Basic Salary" (second review, 3 Nov)', async () => {
  const slip = payslip();
  slip.breakdown_json.earnings = [
    ...slip.breakdown_json.earnings,
    { name: 'Basic arrears', amount: 1000 },
    ...Array.from({ length: 8 }, (_, i) => ({ name: `Allowance ${i + 1}`, amount: 100 })),
  ];
  const pdf = await buildPayslipPdfBuffer(employee, slip, { month: 10, year: 2026 }, { companyId: 'c1' });
  const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf.toString('latin1'));
  expect(Number(box[1])).toBeCloseTo(595.28, 1);
  expect(Number(box[2])).toBeGreaterThan(841.89);
  const text = textOf(pdf);
  expect(text).toContain('YEAR TO DATE');
  expect(text).toContain('Basic arrears');
  expect((text.match(/Basic Salary/g) || []).length).toBe(1);
  expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBe(1);
});
