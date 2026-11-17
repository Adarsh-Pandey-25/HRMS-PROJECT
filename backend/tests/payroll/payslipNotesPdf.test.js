/**
 * The payslip PDF prints payroll's notes — deductions held back by the 50%
 * limit, TDS at 20% without a PAN — and the no-PAN lines of the tax working.
 * The database is a stand-in; nothing is stored or sent. The PDF's text is
 * checked in its uncompressed form.
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
  id: 'e1', company_id: 'c1', first_name: 'Asha', last_name: 'Rao', salary_details: {}, bank_details: {},
};
const payslip = (config = {}) => ({
  month: 10,
  year: 2026,
  gross_salary: 150000,
  unpaid_leave_days: 0,
  breakdown_json: {
    earnings: [{ name: 'Basic', amount: 75000, rate: 75000 }, { name: 'HRA', amount: 30000, rate: 30000 }, { name: 'Special Allowance', amount: 45000, rate: 45000 }],
    deductions: [{ name: 'PF', amount: 3000 }, { name: 'TDS', amount: 28750 }, { name: 'Loan recovery', amount: 43250 }],
    employer_contributions: [],
    reimbursements: [],
    totals: { gross_salary: 150000, total_deductions: 75000, net_pay: 75000, net_payable: 75000 },
    meta: { employee_name: 'Asha Rao', paid_days: 31, lop_days: 0, working_days: 31 },
    config: { tds_mode: 'company', ...config },
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

test('notes and the no-PAN tax working are printed (Rs., not the rupee sign the font lacks)', async () => {
  const pdf = await buildPayslipPdfBuffer(employee, payslip({
    payslip_notes: [
      'Loan recovery reduced by ₹6,750 (50% deduction limit); the rest stays on the loan for the coming months.',
      'TDS at 20% — no PAN on file (Income-tax Act 2025 s.397(2)). Once a PAN is recorded, TDS goes back to the normal rate from that month.',
    ],
    tax: {
      applied: true,
      regime: 'new',
      tax_year: '2026-27',
      taxable_income: 1725000,
      annual_tax: 150800,
      tds_before: 143750,
      tds: 28750,
      no_pan: true,
      higher_rate_applied: true,
      no_pan_tds: 345000,
      tds_target: 345000,
    },
  }), { month: 10, year: 2026 }, { companyId: 'c1' });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  const text = textOf(pdf);
  expect(text).toContain('NOTES');
  expect(text).toContain('Rs. 6,750');
  expect(text).not.toContain('₹');
  expect(text).toContain('no PAN on file');
  expect(text).toContain('TDS for the year (the higher)');
});

test('no notes, no notes band', async () => {
  const text = textOf(await buildPayslipPdfBuffer(employee, payslip(), { month: 10, year: 2026 }, { companyId: 'c1' }));
  expect(text).not.toContain('NOTES');
});
