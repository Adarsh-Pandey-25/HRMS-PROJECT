import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency, formatDate } from './utils';

/** PDFForge-inspired document theme */
const CREAM = [252, 248, 244];
const WHITE = [255, 255, 255];
const ORANGE = [242, 113, 28];
const INK = [15, 23, 42];
const MUTED = [100, 116, 139];
const LINE = [232, 224, 216];
const CHARCOAL = [30, 41, 59];
const SOFT_ORANGE = [255, 244, 236];

function monthKey(payslip) {
  if (!payslip) return '';
  if (String(payslip.month || '').includes('-')) return `${payslip.month}-01`;
  return `${payslip.year}-${String(payslip.monthNum || payslip.month || 1).padStart(2, '0')}-01`;
}

function earningRows(payslip) {
  const lines = Array.isArray(payslip.earnings?.lines) && payslip.earnings.lines.length
    ? payslip.earnings.lines
    : [
        ['Basic', payslip.earnings?.basic],
        ['HRA', payslip.earnings?.hra],
        ['DA', payslip.earnings?.da],
        ['Special Allowance', payslip.earnings?.specialAllowance],
        ['Transport Allowance', payslip.earnings?.transport],
        ['Medical Allowance', payslip.earnings?.medical],
        ['Incentive', payslip.earnings?.incentive],
      ];
  return (Array.isArray(lines[0]) ? lines : lines.map((l) => [l.name, l.amount]))
    .filter(([, amt], i) => Number(amt) > 0 || i === 0)
    .map(([label, amt]) => [label, formatCurrency(amt || 0)]);
}

function deductionRows(payslip) {
  const lines = Array.isArray(payslip.deductions?.lines) && payslip.deductions.lines.length
    ? payslip.deductions.lines
    : [
        ['PF', payslip.deductions?.pf],
        ['Professional Tax', payslip.deductions?.pt],
        ['TDS', payslip.deductions?.tds],
        ['LOP', payslip.deductions?.lop],
      ];
  return (Array.isArray(lines[0]) ? lines : lines.map((l) => [l.name, l.amount]))
    .filter(([, amt]) => Number(amt) > 0)
    .map(([label, amt]) => [label, formatCurrency(amt || 0)]);
}

function drawInfoCard(doc, margin, y, pageW, fields) {
  const cardW = pageW - margin * 2;
  const rowH = 7.5;
  const cardH = fields.length * rowH + 8;

  doc.setFillColor(...SOFT_ORANGE);
  doc.roundedRect(margin, y, cardW, cardH, 3, 3, 'F');

  fields.forEach(([label, value], i) => {
    const rowY = y + 5 + i * rowH;
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.setFont(undefined, 'normal');
    doc.text(label.toUpperCase(), margin + 5, rowY);
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.setFont(undefined, 'bold');
    doc.text(String(value || '—'), margin + cardW * 0.36, rowY);
  });

  return y + cardH + 8;
}

/** Generate a PDFForge-themed payslip PDF and trigger download. */
export function downloadPayslipPdf(payslip, {
  companyName = 'Company',
  employeeName = '',
  employeeCode = '',
  department = '',
  designation = '',
} = {}) {
  if (!payslip) return false;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const monthLabel = formatDate(monthKey(payslip), 'MMMM yyyy');
  const generatedAt = new Date().toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });

  // Cream page + white document sheet
  doc.setFillColor(...CREAM);
  doc.rect(0, 0, pageW, pageH, 'F');
  doc.setFillColor(...WHITE);
  doc.roundedRect(6, 6, pageW - 12, pageH - 12, 4, 4, 'F');

  // Brand mark
  const markX = margin + 4;
  const markY = 18;
  doc.setFillColor(...ORANGE);
  doc.circle(markX, markY, 4.5, 'F');
  doc.setTextColor(...WHITE);
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  const initial = String(companyName || 'C').trim().charAt(0).toUpperCase() || 'C';
  doc.text(initial, markX, markY + 1.2, { align: 'center' });

  doc.setTextColor(...INK);
  doc.setFontSize(14);
  doc.text(companyName || 'Company', markX + 8, markY - 1);
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.setFont(undefined, 'normal');
  doc.text('Salary Payslip', markX + 8, markY + 5);

  doc.setTextColor(...ORANGE);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.text(monthLabel, pageW - margin, markY - 1, { align: 'right' });
  doc.setTextColor(...MUTED);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(7.5);
  doc.text(`Generated ${generatedAt}`, pageW - margin, markY + 5, { align: 'right' });

  // Accent rule
  const ruleY = 30;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.4);
  doc.line(margin, ruleY, pageW - margin, ruleY);
  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(1.1);
  doc.line(margin, ruleY, margin + 18, ruleY);

  const name = employeeName
    || payslip.employeeName
    || `${payslip.employee?.firstName || ''} ${payslip.employee?.lastName || ''}`.trim();

  let y = drawInfoCard(doc, margin, 36, pageW, [
    ['Employee Name', name || '—'],
    ['Employee Code', employeeCode || payslip.employeeCode || payslip.employee?.employeeCode || '—'],
    ['Department', department || payslip.department || payslip.employee?.department || '—'],
    ['Designation', designation || payslip.designation || payslip.employee?.designation || '—'],
    ['Pay Period', monthLabel],
    ['Status', payslip.payslipStatus || payslip.status || 'published'],
  ]);

  const gross = payslip.grossPay ?? payslip.earnings?.gross ?? 0;
  const totalDed = payslip.deductions?.total
    ?? [payslip.deductions?.pf, payslip.deductions?.pt, payslip.deductions?.tds, payslip.deductions?.lop]
      .reduce((s, v) => s + Number(v || 0), 0);

  autoTable(doc, {
    startY: y,
    head: [['Earnings', 'Amount']],
    body: earningRows(payslip),
    foot: [['Gross Pay', formatCurrency(gross)]],
    margin: { left: margin, right: pageW / 2 + 3 },
    tableWidth: pageW / 2 - margin - 3,
    styles: { fontSize: 9, cellPadding: 2.5, lineColor: LINE, lineWidth: 0.15, textColor: INK },
    headStyles: { fillColor: CHARCOAL, textColor: WHITE, fontStyle: 'bold' },
    footStyles: { fillColor: SOFT_ORANGE, textColor: ORANGE, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: CREAM },
    columnStyles: { 1: { halign: 'right' } },
  });

  const earnEndY = doc.lastAutoTable.finalY;

  autoTable(doc, {
    startY: y,
    head: [['Deductions', 'Amount']],
    body: deductionRows(payslip).length ? deductionRows(payslip) : [['—', formatCurrency(0)]],
    foot: [['Total Deductions', formatCurrency(totalDed)]],
    margin: { left: pageW / 2 + 3, right: margin },
    tableWidth: pageW / 2 - margin - 3,
    styles: { fontSize: 9, cellPadding: 2.5, lineColor: LINE, lineWidth: 0.15, textColor: INK },
    headStyles: { fillColor: CHARCOAL, textColor: WHITE, fontStyle: 'bold' },
    footStyles: { fillColor: SOFT_ORANGE, textColor: ORANGE, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: CREAM },
    columnStyles: { 1: { halign: 'right' } },
  });

  y = Math.max(earnEndY, doc.lastAutoTable.finalY) + 10;

  doc.setFillColor(...CHARCOAL);
  doc.roundedRect(margin, y, pageW - margin * 2, 14, 2.5, 2.5, 'F');
  doc.setFillColor(...ORANGE);
  doc.rect(margin, y, 2, 14, 'F');
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...WHITE);
  doc.text('Net Pay', margin + 6, y + 9);
  doc.setTextColor(...ORANGE);
  doc.text(formatCurrency(payslip.netPay), pageW - margin - 6, y + 9, { align: 'right' });

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(margin, pageH - 14, pageW - margin, pageH - 14);
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.setFont(undefined, 'normal');
  doc.text('This is a computer-generated payslip and does not require a signature.', margin, pageH - 9);
  doc.text('Confidential', pageW - margin, pageH - 9, { align: 'right' });

  doc.save(`payslip-${payslip.month || monthLabel.replace(/\s+/g, '-').toLowerCase()}.pdf`);
  return true;
}
