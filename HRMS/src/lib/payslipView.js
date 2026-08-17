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

  const earningLines = (Array.isArray(payslip.earnings?.lines) && payslip.earnings.lines.length
    ? payslip.earnings.lines
    : [
        { name: 'Basic', amount: payslip.earnings?.basic },
        { name: 'HRA', amount: payslip.earnings?.hra },
      ]
  ).map((e) => {
    const name = String(e.name || 'Component');
    const amt = Number(e.amount || 0);
    const isBasic = name.toLowerCase().includes('basic');
    const isHra = name.toLowerCase() === 'hra';
    return {
      label: isBasic ? `Basic Salary ( ${padDays(paidDays)} Days )` : name,
      amount: isHra && amt === 0 ? 'NA' : fmt(amt),
    };
  });

  let deductionLines = (Array.isArray(payslip.deductions?.lines) ? payslip.deductions.lines : [])
    .map((d) => ({
      label: d.name || 'Deduction',
      amount: Number(d.amount) > 0 ? fmt(d.amount) : '',
    }));
  if (!deductionLines.some((d) => String(d.label).toLowerCase() === 'tds')) {
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
  };
}
