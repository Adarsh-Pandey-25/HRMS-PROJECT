const PDFDocument = require('pdfkit');
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { TIMEZONE } = require('../utils/constants');
const { getCompanyId } = require('../utils/tenant');
const settingsService = require('./settings.service');

const BRAND = '#4F46E5';
const BRAND_RGB = [79, 70, 229];
const SLATE_800 = '#1e293b';
const SLATE_600 = '#475569';
const SLATE_500 = '#64748b';
const SLATE_100 = '#f1f5f9';
const SLATE_50 = '#f8fafc';
const SUCCESS = '#16a34a';
const DEFAULT_COMPANY = process.env.COMPANY_NAME || 'HRMS Company Pvt Ltd';

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function resolveCompanyName(employee, companyId) {
  const cid = companyId || getCompanyId(employee);
  if (!cid) return DEFAULT_COMPANY;

  const profile = await settingsService.getSetting('company_profile', null, cid);
  const profileName = typeof profile?.name === 'string' ? profile.name.trim() : '';
  if (profileName) return profileName;

  const { data } = await supabaseAdmin
    .from('companies')
    .select('name')
    .eq('id', cid)
    .maybeSingle();
  const dbName = typeof data?.name === 'string' ? data.name.trim() : '';
  if (dbName && dbName !== 'Default Company') return dbName;

  return dbName || DEFAULT_COMPANY;
}

function periodLabel(payrollMonth, payslip) {
  const month = payrollMonth?.month ?? payslip?.month;
  const year = payrollMonth?.year ?? payslip?.year;
  if (!month || !year) return '—';
  return moment.tz({ year, month: month - 1 }, TIMEZONE).format('MMMM YYYY');
}

function drawHeader(doc, companyName, period) {
  const pageW = doc.page.width;
  doc.save();
  doc.rect(0, 0, pageW, 72).fill(BRAND);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18);
  doc.text(companyName, 40, 22, { width: pageW - 80, align: 'left' });
  doc.font('Helvetica').fontSize(11);
  doc.text(`Salary Payslip — ${period}`, 40, 46);
  doc.fontSize(8);
  doc.text(
    `Generated ${moment.tz(TIMEZONE).format('DD MMM YYYY, hh:mm A')} IST`,
    40,
    58,
  );
  doc.restore();
  doc.y = 88;
}

function drawInfoCard(doc, employee, payslip, period) {
  const x = 40;
  const w = doc.page.width - 80;
  const cardTop = doc.y;
  const rowH = 18;

  const fields = [
    ['Employee Name', `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || '—'],
    ['Employee Code', employee.employee_code || '—'],
    ['Department', employee.department || '—'],
    ['Designation', employee.designation || '—'],
    ['Pay Period', period],
    ['Payment Status', payslip.payment_status || 'processed'],
  ];

  doc.save();
  doc.roundedRect(x, cardTop, w, fields.length * rowH + 16, 6).fillAndStroke(SLATE_50, '#e2e8f0');

  let y = cardTop + 10;
  const colSplit = x + w * 0.38;

  fields.forEach(([label, value], i) => {
    if (i % 2 === 1) {
      doc.rect(x + 4, y - 2, w - 8, rowH).fill('#ffffff');
    }
    doc.fillColor(SLATE_500).font('Helvetica').fontSize(8);
    doc.text(label.toUpperCase(), x + 12, y + 3, { width: colSplit - x - 12 });
    doc.fillColor(SLATE_800).font('Helvetica-Bold').fontSize(9);
    doc.text(String(value), colSplit, y + 2, { width: x + w - colSplit - 12, align: 'left' });
    y += rowH;
  });

  doc.restore();
  doc.y = cardTop + fields.length * rowH + 28;
}

function drawTable(doc, { x, y, width, title, rows, footer }) {
  const colLabel = width * 0.62;
  const colAmount = width - colLabel;
  const headerH = 22;
  const rowH = 20;
  let cy = y;

  doc.save();
  doc.roundedRect(x, cy, width, headerH, 4).fill(BRAND);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
  doc.text(title, x + 10, cy + 6);
  doc.text('Amount', x + colLabel, cy + 6, { width: colAmount - 10, align: 'right' });
  cy += headerH;

  rows.forEach((row, i) => {
    const bg = i % 2 === 0 ? '#ffffff' : SLATE_50;
    doc.rect(x, cy, width, rowH).fill(bg);
    doc.rect(x, cy, width, rowH).stroke('#e2e8f0');
    doc.fillColor(SLATE_600).font('Helvetica').fontSize(9);
    doc.text(row[0], x + 10, cy + 5, { width: colLabel - 16 });
    doc.fillColor(SLATE_800).font('Helvetica-Bold').fontSize(9);
    doc.text(row[1], x + colLabel, cy + 5, { width: colAmount - 10, align: 'right' });
    cy += rowH;
  });

  doc.rect(x, cy, width, rowH + 2).fill(SLATE_100);
  doc.rect(x, cy, width, rowH + 2).stroke('#cbd5e1');
  doc.fillColor(SLATE_800).font('Helvetica-Bold').fontSize(9);
  doc.text(footer[0], x + 10, cy + 6);
  doc.text(footer[1], x + colLabel, cy + 6, { width: colAmount - 10, align: 'right' });
  cy += rowH + 2;

  doc.restore();
  return cy;
}

function drawNetPayBox(doc, netPay) {
  const x = 40;
  const w = doc.page.width - 80;
  const h = 36;
  const y = doc.y + 8;

  doc.save();
  doc.roundedRect(x, y, w, h, 6).fillAndStroke(SLATE_100, BRAND);
  doc.lineWidth(1.2);
  doc.fillColor(SLATE_800).font('Helvetica-Bold').fontSize(12);
  doc.text('Net Pay', x + 16, y + 12);
  doc.fillColor(SUCCESS).font('Helvetica-Bold').fontSize(14);
  doc.text(fmt(netPay), x + 16, y + 10, { width: w - 32, align: 'right' });
  doc.restore();

  doc.y = y + h + 16;
}

function drawFooter(doc) {
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const y = pageH - 40;

  doc.save();
  doc.strokeColor('#e2e8f0').moveTo(40, y).lineTo(pageW - 40, y).stroke();
  doc.fillColor(SLATE_500).font('Helvetica').fontSize(8);
  doc.text(
    'This is a computer-generated payslip and does not require a signature.',
    40,
    y + 8,
    { width: pageW - 80, align: 'left' },
  );
  doc.text('Confidential — internal use only', 40, y + 8, { width: pageW - 80, align: 'right' });
  doc.restore();
}

/**
 * Build a professional payslip PDF buffer.
 */
async function buildPayslipPdfBuffer(employee, payslip, payrollMonth, { companyId, companyName } = {}) {
  const resolvedName = companyName || await resolveCompanyName(employee, companyId);
  const period = periodLabel(payrollMonth, payslip);
  const breakdown = payslip.breakdown_json || {};
  const earnings = breakdown.earnings || [];
  const deductions = breakdown.deductions || [];
  const totals = breakdown.totals || {};

  const gross = totals.gross_salary ?? payslip.gross_salary ?? 0;
  const totalDed = totals.total_deductions ?? payslip.total_deductions ?? 0;
  const netPay = totals.net_pay ?? payslip.net_salary ?? 0;

  const earningRows = earnings
    .filter((e) => Number(e.amount) > 0 || String(e.name || '').toLowerCase() === 'basic')
    .map((e) => [e.name || 'Component', fmt(e.amount)]);

  const deductionRows = deductions
    .filter((d) => Number(d.amount) > 0)
    .map((d) => [d.name || 'Deduction', fmt(d.amount)]);

  if (!earningRows.length) earningRows.push(['Basic', fmt(gross)]);
  if (!deductionRows.length) deductionRows.push(['—', fmt(0)]);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeader(doc, resolvedName, period);
    drawInfoCard(doc, employee, payslip, period);

    const tableY = doc.y;
    const gap = 12;
    const tableW = (doc.page.width - 80 - gap) / 2;
    const leftX = 40;
    const rightX = leftX + tableW + gap;

    const leftEnd = drawTable(doc, {
      x: leftX,
      y: tableY,
      width: tableW,
      title: 'Earnings',
      rows: earningRows,
      footer: ['Gross Pay', fmt(gross)],
    });

    const rightEnd = drawTable(doc, {
      x: rightX,
      y: tableY,
      width: tableW,
      title: 'Deductions',
      rows: deductionRows,
      footer: ['Total Deductions', fmt(totalDed)],
    });

    doc.y = Math.max(leftEnd, rightEnd) + 4;
    drawNetPayBox(doc, netPay);
    drawFooter(doc);

    doc.end();
  });
}

module.exports = {
  buildPayslipPdfBuffer,
  resolveCompanyName,
};
