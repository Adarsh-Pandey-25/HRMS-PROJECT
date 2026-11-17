import { formatDate } from './utils';

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  const v = Number(n) || 0;
  if (v < 20) return ONES[v];
  const t = Math.floor(v / 10);
  const o = v % 10;
  return `${TENS[t]}${o ? ` ${ONES[o]}` : ''}`.trim();
}

export function amountInWords(value) {
  const n = Math.floor(Math.abs(Number(value) || 0));
  if (n === 0) return 'Zero Only';
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  const parts = [];
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return `${parts.join(' ')} Only`;
}

function padDays(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return '0';
  return Number.isInteger(v) ? String(v).padStart(2, '0') : String(v);
}

function padPair(left, right, min = 3) {
  const n = Math.max(left.length, right.length, min);
  const a = left.slice();
  const b = right.slice();
  while (a.length < n) a.push({ label: '', amount: '' });
  while (b.length < n) b.push({ label: '', amount: '' });
  return { left: a, right: b };
}

export function companyAddressFromStore(company = {}) {
  if (typeof company.address === 'string' && company.address.trim()) return company.address.trim();
  return [
    company.addressLine1,
    company.addressLine2,
    company.city,
    company.state,
    company.pincode,
  ].filter(Boolean).join(', ');
}

export function buildPayslipView(payslip, { company = {}, employee = {} } = {}) {
  const monthKey = String(payslip.month || '').includes('-')
    ? `${payslip.month}-01`
    : `${payslip.year}-${String(payslip.monthNum || payslip.month || 1).padStart(2, '0')}-01`;
  const period = formatDate(monthKey, 'MMMM yyyy');
  const paidDays = payslip.paidDays || 0;
  const lopDays = payslip.unpaidLeaveDays || 0;

  // What the company chose to show (the breakdown arrives camelCased; older copies snake_case).
  const display = payslip.breakdown?.config?.payslipDisplay || payslip.breakdown?.config?.payslip_display || {};
  const showRates = (display.showRates ?? display.show_rates) !== false;
  const showEmployer = (display.showEmployer ?? display.show_employer) !== false;
  const showTax = (display.showTaxWorking ?? display.show_tax_working) !== false;
  const earningLines = (Array.isArray(payslip.earnings?.lines) && payslip.earnings.lines.length
    ? payslip.earnings.lines
    : [
        { name: 'Basic', amount: payslip.earnings?.basic },
        { name: 'HRA', amount: payslip.earnings?.hra },
      ]
  ).map((e) => {
    const name = String(e.name || 'Component');
    const amt = Number(e.amount || 0);
    // Only the Basic component itself (not, say, "Basic arrears").
    const isBasic = name.trim().toLowerCase() === 'basic';
    const isHra = name.toLowerCase() === 'hra';
    return {
      // The paid days are in the summary; the rate column needs the room.
      label: isBasic ? 'Basic Salary' : name,
      rate: showRates && e.rate != null && Number(e.rate) > 0 ? fmt(e.rate) : '',
      amount: isHra && amt === 0 ? 'NA' : fmt(amt),
    };
  });

  let deductionLines = (Array.isArray(payslip.deductions?.lines) ? payslip.deductions.lines : [])
    .map((d) => ({
      label: d.name || 'Deduction',
      amount: Number(d.amount) > 0 ? fmt(d.amount) : '',
    }));
  // The breakdown arrives camelCased (lib/mappers.js); older copies may be snake_case.
  const tdsMode = String(payslip.breakdown?.config?.tdsMode ?? payslip.breakdown?.config?.tds_mode ?? '').toLowerCase();
  const tdsApplies = tdsMode !== 'none' && tdsMode !== 'exempt';
  if (tdsApplies && !deductionLines.some((d) => String(d.label).toLowerCase() === 'tds')) {
    deductionLines = [{ label: 'TDS', amount: '' }, ...deductionLines];
  }
  if (deductionLines.length < 2) deductionLines.push({ label: 'Deduction 2', amount: '' });

  const split = padPair(earningLines, deductionLines, 3);
  let reimbursements = Array.isArray(payslip.reimbursements?.lines) ? payslip.reimbursements.lines : [];
  if (!reimbursements.length) {
    reimbursements = [
      { name: 'Reimbursement 1', amount: 0 },
      { name: 'Reimbursement 2', amount: 0 },
    ];
  }

  const gross = payslip.grossPay ?? payslip.earnings?.gross ?? 0;
  const totalDed = payslip.deductions?.total ?? 0;
  const totalReimb = payslip.reimbursements?.total
    ?? reimbursements.reduce((s, r) => s + Number(r.amount || 0), 0);
  const netPay = payslip.netPay ?? (Number(gross) - Number(totalDed) + Number(totalReimb));
  const legalName = company.legalName || company.name || 'Company';
  const brand = company.brandName || company.shortName || String(legalName).split(/\s+/)[0] || 'Company';

  return {
    period,
    brand,
    legalName,
    address: companyAddressFromStore(company),
    logoUrl: company.logoUrl || null,
    employeeName: payslip.employeeName
      || employee.name
      || `${employee.firstName || ''} ${employee.lastName || ''}`.trim()
      || '—',
    designation: payslip.designation || employee.designation || '—',
    dateOfJoining: payslip.dateOfJoining
      ? formatDate(payslip.dateOfJoining, 'dd.MM.yy')
      : (employee.joinDate ? formatDate(employee.joinDate, 'dd.MM.yy') : '—'),
    payMethod: payslip.payMethod || (payslip.accountNumber || employee.bank?.account ? 'Net Banking' : '—'),
    accountNumber: payslip.accountNumber || employee.bank?.account || '—',
    ctc: payslip.ctc || (Number(employee.salary?.basic || 0)
      + Number(employee.salary?.hra || 0)
      + Number(employee.salary?.da || 0)
      + Number(employee.salary?.special || 0)
      + Number(employee.salary?.transport || 0)
      + Number(employee.salary?.medical || 0)) * 12,
    paidDays: padDays(paidDays),
    lopDays: padDays(lopDays),
    split,
    reimbursements,
    gross,
    totalDed,
    totalReimb,
    netPay,
    netPayLabel: Number(netPay).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    netPayWords: amountInWords(netPay),
    showRates,
    // The leave balance after this payslip, saved when it was published.
    leave: (Array.isArray(payslip.breakdown?.meta?.leave) ? payslip.breakdown.meta.leave : []).map((l) => `${l.code} ${l.available}`).join(' · ') || null,
    tax: showTax ? taxSummary(payslip.breakdown?.config?.tax) : null,
    employer: showEmployer ? employerSummary(payslip.breakdown?.employerContributions) : null,
    // Deductions held back by the 50% limit, TDS at 20% without a PAN, … (printed whatever the display choices).
    notes: payslipNotes(payslip),
  };
}

/** The plain-words lines payroll wrote for this payslip. */
export function payslipNotes(payslip) {
  const cfg = payslip?.breakdown?.config || {};
  const list = cfg.payslipNotes ?? cfg.payslip_notes;
  return Array.isArray(list) ? list.filter((n) => typeof n === 'string' && n.trim()) : [];
}

/**
 * Short flags for a salary sheet row: deductions held back by the limit on
 * total deductions (or a final payslip over it), and TDS at 20% without a PAN.
 */
export function payslipFlags(payslip) {
  const cfg = payslip?.breakdown?.config || {};
  const cap = cfg.deductionCap || cfg.deduction_cap || {};
  const tax = cfg.tax || {};
  const flags = [];
  const held = Number(cap.heldBack ?? cap.held_back ?? 0);
  const over = Number(cap.overLimit ?? cap.over_limit ?? 0);
  if (held > 0) {
    flags.push({ key: 'held', tone: 'warning', label: `Held back ${fmt(held)}`, title: payslipNotes(payslip).join(' ') || `Deductions above the ${cap.percent}% limit were held back.` });
  }
  if (over > 0) {
    flags.push({ key: 'over', tone: 'danger', label: `Over ${cap.percent}% limit`, title: `Final settlement: deductions are ${fmt(over)} over the ${cap.percent}% deduction limit (not reduced — nothing can be carried past a final payslip).` });
  }
  const noPan = (tax.noPan ?? tax.no_pan) && (tax.higherRateApplied ?? tax.higher_rate_applied) && tax.applied !== false;
  if (noPan) flags.push({ key: 'pan', tone: 'warning', label: 'No PAN · TDS 20%', title: 'No valid PAN on file: TDS at 20% of the taxable income (Income-tax Act 2025 s.397(2)).' });
  return flags;
}

/** What the company pays on top of the salary (not deducted from it). */
function employerSummary(list) {
  const rows = (Array.isArray(list) ? list : []).filter((c) => Number(c.amount) > 0);
  if (!rows.length) return null;
  const totalPaise = rows.reduce((s, c) => s + Math.round(Number(c.amount) * 100), 0);
  return {
    rows: [...rows.map((c) => ({ label: String(c.name || 'Contribution'), amount: fmt(c.amount) })), { label: 'Total', amount: fmt(totalPaise / 100), total: true }],
  };
}

/** The tax working behind this month's TDS, when payroll worked it out from the slabs. */
function taxSummary(t) {
  if (!t || t.applied === false) return null;
  // No PAN on file: the year's TDS is 20% of the taxable income when that is more than the tax.
  const noPan = (t.noPan ?? t.no_pan) && (t.higherRateApplied ?? t.higher_rate_applied);
  return {
    heading: `INCOME TAX (TDS) — ${t.regime === 'old' ? 'old' : 'new'} regime, tax year ${t.taxYear || t.tax_year || ''}`,
    rows: [
      { label: 'Taxable income for the year (projected)', amount: fmt(t.taxableIncome ?? t.taxable_income) },
      { label: 'Tax for the year, with cess', amount: fmt(t.annualTax ?? t.annual_tax) },
      ...(noPan ? [
        { label: 'TDS at 20% — no PAN on file', amount: fmt(t.noPanTds ?? t.no_pan_tds) },
        { label: 'TDS for the year (the higher)', amount: fmt(t.tdsTarget ?? t.tds_target) },
      ] : []),
      { label: 'TDS deducted before this month', amount: fmt(t.tdsBefore ?? t.tds_before) },
      { label: 'TDS this month', amount: fmt(t.tds) },
    ],
  };
}
