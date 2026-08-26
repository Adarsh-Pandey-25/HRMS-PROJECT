const PDFDocument = require('pdfkit');
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { TIMEZONE, STORAGE_BUCKETS } = require('../utils/constants');
const { getCompanyId } = require('../utils/tenant');
const settingsService = require('./settings.service');

const DEFAULT_COMPANY = process.env.COMPANY_NAME || 'HRMS Company Pvt Ltd';
const INK = '#111111';
const RULE = '#111111';

const fmt = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtInt = (n) =>
  Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const padDays = (n) => {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return '0';
  return Number.isInteger(v) ? String(v).padStart(2, '0') : String(v);
};

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

function amountInWords(value) {
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

function formatJoining(date) {
  if (!date) return '—';
  const m = moment(date);
  return m.isValid() ? m.format('DD.MM.YY') : '—';
}

function companyAddress(profile = {}) {
  if (typeof profile.address === 'string' && profile.address.trim()) return profile.address.trim();
  return [
    profile.addressLine1 || profile.address_line1,
    profile.addressLine2 || profile.address_line2,
    profile.city,
    profile.state,
    profile.pincode || profile.pin_code,
  ].filter(Boolean).join(', ');
}

async function resolveCompanyProfile(employee, companyId) {
  const cid = companyId || getCompanyId(employee);
  const profile = (await settingsService.getSetting('company_profile', null, cid)) || {};
  let legalName = String(profile.legalName || profile.legal_name || profile.name || '').trim();
  if (!legalName) {
    const { data } = await supabaseAdmin.from('companies').select('name').eq('id', cid).maybeSingle();
    legalName = (data?.name && data.name !== 'Default Company') ? data.name : DEFAULT_COMPANY;
  }
  const brand = String(profile.brandName || profile.brand_name || profile.shortName || profile.short_name || '')
    .trim() || legalName.split(/\s+/)[0] || 'Company';
  return {
    brand,
    legalName,
    address: companyAddress(profile) || '',
    logoPath: profile.logoPath || profile.logo_path || null,
  };
}

async function loadLogoBuffer(logoPath) {
  if (!logoPath) return null;
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKETS.documents)
      .download(logoPath);
    if (error || !data) return null;
    if (Buffer.isBuffer(data)) return data;
    if (typeof data.arrayBuffer === 'function') return Buffer.from(await data.arrayBuffer());
    return Buffer.from(data);
  } catch {
    return null;
  }
}

async function loadEmployee(employee) {
  if (employee?.bank_details != null && employee?.salary_details != null && employee?.designation != null) {
    return employee;
  }
  if (!employee?.id) return employee || {};
  const { data } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, last_name, employee_code, email, company_id, address, designation, date_of_joining, bank_details, salary_details')
    .eq('id', employee.id)
    .maybeSingle();
  return { ...employee, ...(data || {}) };
}

function periodLabel(payrollMonth, payslip) {
  const month = payrollMonth?.month ?? payslip?.month;
  const year = payrollMonth?.year ?? payslip?.year;
  if (!month || !year) return '—';
  return moment.tz({ year, month: month - 1 }, TIMEZONE).format('MMMM YYYY');
}

function padPair(left, right, min = 3) {
  const n = Math.max(left.length, right.length, min);
  const a = left.slice();
  const b = right.slice();
  while (a.length < n) a.push({ label: '', amount: '' });
  while (b.length < n) b.push({ label: '', amount: '' });
  return { left: a, right: b };
}

function stroke(doc, x, y, w, h) {
  doc.save();
  doc.lineWidth(0.8).strokeColor(RULE).rect(x, y, w, h).stroke();
  doc.restore();
}

function hline(doc, x, y, w) {
  doc.save();
  doc.lineWidth(0.8).strokeColor(RULE).moveTo(x, y).lineTo(x + w, y).stroke();
  doc.restore();
}

function vline(doc, x, y, h) {
  doc.save();
  doc.lineWidth(0.8).strokeColor(RULE).moveTo(x, y).lineTo(x, y + h).stroke();
  doc.restore();
}

function cellText(doc, str, x, y, w, h, {
  align = 'left', bold = false, size = 9, valign = 'top',
} = {}) {
  doc.save();
  doc.fillColor(INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  const padX = 6;
  const padY = valign === 'center' ? Math.max(3, (h - size) / 2 - 1) : 5;
  doc.text(String(str ?? ''), x + padX, y + padY, {
    width: Math.max(10, w - padX * 2),
    align,
    lineBreak: true,
    height: h - 4,
    ellipsis: true,
  });
  doc.restore();
}

/**
 * Build a classic Indian-format payslip PDF (bordered grid).
 */
async function buildPayslipPdfBuffer(employee, payslip, payrollMonth, { companyId, companyName } = {}) {
  const emp = await loadEmployee(employee);
  const company = await resolveCompanyProfile(emp, companyId);
  if (companyName) company.legalName = companyName;
  const logo = await loadLogoBuffer(company.logoPath);
  const period = periodLabel(payrollMonth, payslip);
  const breakdown = payslip.breakdown_json || {};
  const meta = breakdown.meta || {};
  const totals = breakdown.totals || {};
  const earnings = Array.isArray(breakdown.earnings) ? breakdown.earnings : [];
  const deductions = Array.isArray(breakdown.deductions) ? breakdown.deductions : [];
  let reimbursements = Array.isArray(breakdown.reimbursements) ? breakdown.reimbursements : null;
  if (!reimbursements) {
    const month = payrollMonth?.month ?? payslip?.month;
    const year = payrollMonth?.year ?? payslip?.year;
    if (emp.id && month && year) {
      const start = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).startOf('month').format('YYYY-MM-DD');
      const end = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).endOf('month').format('YYYY-MM-DD');
      const { data } = await supabaseAdmin
        .from('reimbursements')
        .select('reimbursement_type, amount, description')
        .eq('employee_id', emp.id)
        .eq('status', 'approved')
        .gte('expense_date', start)
        .lte('expense_date', end);
      reimbursements = (data || []).map((r) => ({
        name: r.description || String(r.reimbursement_type || 'Reimbursement').replace(/_/g, ' '),
        amount: Number(r.amount || 0),
      }));
    } else {
      reimbursements = [];
    }
  }

  const gross = Number(totals.gross_salary ?? payslip.gross_salary ?? 0);
  const totalDed = Number(totals.total_deductions ?? payslip.total_deductions ?? 0);
  const totalReimb = Number(
    totals.total_reimbursements
    ?? reimbursements.reduce((s, r) => s + Number(r.amount || 0), 0)
  );
  const netPay = Number(totals.net_payable ?? (Number(totals.net_pay ?? payslip.net_salary ?? 0) + totalReimb));

  const paidDays = meta.paid_days ?? Math.max(
    0,
    Number(breakdown.config?.working_days || 0) - Number(payslip.unpaid_leave_days || 0),
  );
  const lopDays = meta.lop_days ?? Number(payslip.unpaid_leave_days || 0);
  const ctc = meta.ctc ?? 0;
  const empName = meta.employee_name
    || `${emp.first_name || ''} ${emp.last_name || ''}`.trim()
    || '—';
  const designation = meta.designation || emp.designation || '—';
  const joining = formatJoining(meta.date_of_joining || emp.date_of_joining);
  const payMethod = meta.pay_method || ((emp.bank_details?.account_number || emp.bank_details?.accountNumber) ? 'Net Banking' : '—');
  const accountNo = meta.account_number
    || emp.bank_details?.account_number
    || emp.bank_details?.accountNumber
    || emp.bank_details?.account
    || '—';

  const earningRows = earnings.map((e) => {
    const name = String(e.name || 'Component');
    const amt = Number(e.amount || 0);
    const isBasic = name.toLowerCase().includes('basic');
    const isHra = name.toLowerCase() === 'hra';
    const label = isBasic ? `Basic Salary ( ${padDays(paidDays)} Days )` : name;
    return { label, amount: isHra && amt === 0 ? 'NA' : fmt(amt) };
  });
  if (!earningRows.length) earningRows.push({ label: `Basic Salary ( ${padDays(paidDays)} Days )`, amount: fmt(gross) });

  const deductionRows = deductions.map((d) => ({
    label: d.name || 'Deduction',
    amount: Number(d.amount) > 0 ? fmt(d.amount) : '',
  }));
  const tdsMode = String(breakdown.config?.tds_mode || '').toLowerCase();
  const tdsApplies = tdsMode !== 'none' && tdsMode !== 'exempt';
  if (tdsApplies && !deductionRows.some((d) => String(d.label).toLowerCase() === 'tds')) {
    deductionRows.unshift({ label: 'TDS', amount: '' });
  }
  if (deductionRows.length < 2) deductionRows.push({ label: 'Deduction 2', amount: '' });

  const split = padPair(earningRows, deductionRows, 3);

  if (!reimbursements.length) {
    reimbursements = [
      { name: 'Reimbursement 1', amount: 0 },
      { name: 'Reimbursement 2', amount: 0 },
    ];
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const x = 36;
    const top = 36;
    const w = pageW - 72;
    const mid = x + w / 2;
    const rowH = 20;
    const headerH = 56;
    const titleH = 22;
    const summaryH = 118;
    const colHeadH = 20;
    const earnRows = split.left.length;
    const earnH = colHeadH + earnRows * rowH + rowH; // + gross footer
    const reimbH = colHeadH + reimbursements.length * rowH + rowH;
    const netH = colHeadH + 4 * rowH;
    const footerH = 48;
    const totalH = headerH + titleH + summaryH + earnH + reimbH + netH + footerH;

    stroke(doc, x, top, w, totalH);

    // Header
    if (logo) {
      try {
        doc.image(logo, x + 8, top + 10, { fit: [36, 36] });
      } catch {
        /* ignore bad logo */
      }
    } else {
      doc.save();
      doc.roundedRect(x + 10, top + 12, 28, 28, 4).fill(INK);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(14);
      doc.text(String(company.brand || 'C').charAt(0).toUpperCase(), x + 10, top + 19, { width: 28, align: 'center' });
      doc.restore();
    }
    cellText(doc, company.brand, x + 48, top + 14, w * 0.35, 28, { bold: true, size: 16, valign: 'center' });
    cellText(doc, company.legalName, mid - 10, top + 10, w / 2 + 4, 18, { bold: true, size: 10, align: 'left' });
    cellText(doc, company.address, mid - 10, top + 28, w / 2 + 4, 24, { size: 8, align: 'left' });
    hline(doc, x, top + headerH, w);

    // Title
    cellText(doc, `Payslip for the Month of ${period}`, x, top + headerH, w, titleH, {
      bold: true, size: 11, align: 'center', valign: 'center',
    });
    hline(doc, x, top + headerH + titleH, w);

    // Summary
    const sumY = top + headerH + titleH;
    vline(doc, mid, sumY, summaryH);
    cellText(doc, 'Employee Pay Summary', x, sumY + 4, w / 2, 18, { bold: true, size: 10 });
    const summaryLines = [
      ['Employee Name', empName],
      ['Designation', designation],
      ['Date of Joining', joining],
      ['Pay Method', payMethod],
      ['A/c No.', accountNo],
    ];
    summaryLines.forEach((pair, i) => {
      const ly = sumY + 24 + i * 18;
      cellText(doc, `${pair[0]} :  ${pair[1]}`, x, ly, w / 2, 18, { size: 9 });
    });
    cellText(doc, 'Employee Cost To Company', mid, sumY + 10, w / 2, 18, { bold: true, size: 10, align: 'center' });
    cellText(doc, fmtInt(ctc), mid, sumY + 36, w / 2, 28, { bold: true, size: 18, align: 'center' });
    cellText(doc, `Paid Days: ${padDays(paidDays)}  |  LOP Days: ${padDays(lopDays)}`, mid, sumY + 72, w / 2, 20, {
      size: 9, align: 'center',
    });
    hline(doc, x, sumY + summaryH, w);

    // Earnings / Deductions
    const edY = sumY + summaryH;
    const amtW = 90;
    vline(doc, mid, edY, earnH);
    vline(doc, mid - amtW, edY, earnH);
    vline(doc, x + w - amtW, edY, earnH);

    cellText(doc, 'EARNINGS', x, edY, w / 2 - amtW, colHeadH, { bold: true, size: 9, valign: 'center' });
    cellText(doc, 'AMOUNT', mid - amtW, edY, amtW, colHeadH, { bold: true, size: 9, align: 'right', valign: 'center' });
    cellText(doc, 'DEDUCTIONS', mid, edY, w / 2 - amtW, colHeadH, { bold: true, size: 9, valign: 'center' });
    cellText(doc, 'AMOUNT', x + w - amtW, edY, amtW, colHeadH, { bold: true, size: 9, align: 'right', valign: 'center' });
    hline(doc, x, edY + colHeadH, w);

    for (let i = 0; i < earnRows; i += 1) {
      const ry = edY + colHeadH + i * rowH;
      cellText(doc, split.left[i].label, x, ry, w / 2 - amtW, rowH, { size: 9, valign: 'center' });
      cellText(doc, split.left[i].amount, mid - amtW, ry, amtW, rowH, { size: 9, align: 'right', valign: 'center' });
      cellText(doc, split.right[i].label, mid, ry, w / 2 - amtW, rowH, { size: 9, valign: 'center' });
      cellText(doc, split.right[i].amount, x + w - amtW, ry, amtW, rowH, { size: 9, align: 'right', valign: 'center' });
      hline(doc, x, ry + rowH, w);
    }

    const grossY = edY + colHeadH + earnRows * rowH;
    cellText(doc, 'Gross Earnings', x, grossY, w / 2 - amtW, rowH, { bold: true, size: 9, valign: 'center' });
    cellText(doc, fmt(gross), mid - amtW, grossY, amtW, rowH, { bold: true, size: 9, align: 'right', valign: 'center' });
    cellText(doc, 'Total Deductions', mid, grossY, w / 2 - amtW, rowH, { bold: true, size: 9, valign: 'center' });
    cellText(doc, fmt(totalDed), x + w - amtW, grossY, amtW, rowH, { bold: true, size: 9, align: 'right', valign: 'center' });
    hline(doc, x, grossY + rowH, w);

    // Reimbursements
    const rY = edY + earnH;
    cellText(doc, 'REIMBURSEMENTS', x, rY, w, colHeadH, { bold: true, size: 9, align: 'center', valign: 'center' });
    hline(doc, x, rY + colHeadH, w);
    vline(doc, mid, rY + colHeadH, reimbursements.length * rowH);
    vline(doc, x + w - amtW, rY + colHeadH, reimbursements.length * rowH + rowH);

    reimbursements.forEach((r, i) => {
      const ry = rY + colHeadH + i * rowH;
      cellText(doc, r.name || `Reimbursement ${i + 1}`, x, ry, w / 2, rowH, { size: 9, valign: 'center' });
      cellText(doc, fmt(r.amount), mid, ry, w / 2 - amtW, rowH, { size: 9, align: 'right', valign: 'center' });
      cellText(doc, fmt(r.amount), x + w - amtW, ry, amtW, rowH, { size: 9, align: 'right', valign: 'center' });
      hline(doc, x, ry + rowH, w);
    });
    const rTotY = rY + colHeadH + reimbursements.length * rowH;
    cellText(doc, 'Total Reimbursements', x, rTotY, w - amtW, rowH, { bold: true, size: 9, valign: 'center' });
    cellText(doc, fmt(totalReimb), x + w - amtW, rTotY, amtW, rowH, { bold: true, size: 9, align: 'right', valign: 'center' });
    hline(doc, x, rTotY + rowH, w);

    // Net pay
    const nY = rY + reimbH;
    cellText(doc, 'NETPAY', x, nY, w - amtW, colHeadH, { bold: true, size: 9, align: 'center', valign: 'center' });
    cellText(doc, 'AMOUNT', x + w - amtW, nY, amtW, colHeadH, { bold: true, size: 9, align: 'right', valign: 'center' });
    hline(doc, x, nY + colHeadH, w);
    vline(doc, x + w - amtW, nY, netH);

    const netRows = [
      ['Gross Earnings', fmt(gross), false],
      ['Total Deductions', totalDed ? fmt(totalDed) : '', false],
      ['Total Reimbursements', fmt(totalReimb), false],
      ['Total Net Payable', fmt(netPay), true],
    ];
    netRows.forEach((row, i) => {
      const ry = nY + colHeadH + i * rowH;
      cellText(doc, row[0], x, ry, w - amtW, rowH, {
        bold: row[2], size: 9, align: row[2] ? 'center' : 'left', valign: 'center',
      });
      cellText(doc, row[1], x + w - amtW, ry, amtW, rowH, { bold: row[2], size: 9, align: 'right', valign: 'center' });
      hline(doc, x, ry + rowH, w);
    });

    const fY = nY + netH;
    cellText(
      doc,
      `Total Net Payable  ${Number(netPay).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}  (${amountInWords(netPay)})`,
      x,
      fY + 6,
      w,
      20,
      { bold: true, size: 9, align: 'center' },
    );
    cellText(
      doc,
      '** Total Net Payable = Gross Earnings - Total Deductions + Total Reimbursements',
      x,
      fY + 26,
      w,
      16,
      { bold: true, size: 8, align: 'center' },
    );

    doc.end();
  });
}

module.exports = {
  buildPayslipPdfBuffer,
  resolveCompanyName: async (employee, companyId) => {
    const p = await resolveCompanyProfile(employee, companyId);
    return p.legalName;
  },
  amountInWords,
};
