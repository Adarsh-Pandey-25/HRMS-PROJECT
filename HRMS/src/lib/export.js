import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export const EXPORT_FORMATS = [
  { id: 'csv', label: 'CSV', ext: 'csv' },
  { id: 'xlsx', label: 'Excel (XLSX)', ext: 'xlsx' },
  { id: 'pdf', label: 'PDF', ext: 'pdf' },
];

const BRAND_RGB = [79, 70, 229]; // indigo-600
const HEADER_FILL = [241, 245, 249]; // slate-100
const ALT_ROW_FILL = [248, 250, 252]; // slate-50
const MUTED_RGB = [100, 116, 139]; // slate-500

function resolveColumns(rows, columns) {
  if (columns?.length) {
    return columns.map((col) => (
      typeof col === 'string'
        ? { key: col, label: formatColumnLabel(col) }
        : { key: col.key, label: col.label || formatColumnLabel(col.key) }
    ));
  }
  if (!rows?.length) return [];
  return Object.keys(rows[0]).map((key) => ({ key, label: formatColumnLabel(key) }));
}

export function formatColumnLabel(key) {
  return String(key || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function cellValue(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeCsv(value) {
  const s = cellValue(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function withExtension(filename, ext) {
  const base = String(filename || 'export').replace(/\.(csv|xlsx|pdf)$/i, '');
  return `${base}.${ext}`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatGeneratedAt(date = new Date()) {
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

function buildMeta({ title, companyName, recordCount, subtitle }) {
  return {
    title: title || 'Report',
    companyName: companyName || '',
    subtitle: subtitle || '',
    generatedAt: formatGeneratedAt(),
    recordCount: recordCount ?? 0,
  };
}

function metaLines(meta) {
  const lines = [];
  if (meta.companyName) lines.push(`Company: ${meta.companyName}`);
  lines.push(`Report: ${meta.title}`);
  if (meta.subtitle) lines.push(meta.subtitle);
  lines.push(`Generated: ${meta.generatedAt}`);
  lines.push(`Records: ${meta.recordCount}`);
  return lines;
}

function rowsToAoA(rows, cols) {
  const header = cols.map((c) => c.label);
  const body = rows.map((row) => cols.map((c) => cellValue(row[c.key])));
  return [header, ...body];
}

function estimateColWidths(cols, rows) {
  return cols.map((col) => {
    const maxLen = Math.max(
      col.label.length,
      ...rows.slice(0, 100).map((r) => cellValue(r[col.key]).length),
    );
    return { wch: Math.min(Math.max(maxLen + 2, 10), 48) };
  });
}

function buildInfoSheet(meta, sheets = null) {
  const info = [
    ['HR Management System — Data Export'],
    [''],
    ...metaLines(meta).map((line) => [line]),
  ];
  if (sheets?.length) {
    info.push([''], ['Included sheets:']);
    for (const s of sheets) {
      info.push([`• ${s.name || 'Sheet'} (${s.rows?.length || 0} records)`]);
    }
  }
  info.push([''], ['Confidential — for internal use only.']);
  const ws = XLSX.utils.aoa_to_sheet(info);
  ws['!cols'] = [{ wch: 60 }];
  return ws;
}

function buildStyledSheet(rows, cols, meta) {
  const preamble = [
    [meta.companyName ? `${meta.companyName} — ${meta.title}` : meta.title],
    [`Generated ${meta.generatedAt} · ${meta.recordCount} record${meta.recordCount === 1 ? '' : 's'}`],
    meta.subtitle ? [meta.subtitle] : null,
    [],
  ].filter(Boolean);

  const table = rowsToAoA(rows, cols);
  const aoa = [...preamble, ...table];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws['!cols'] = estimateColWidths(cols, rows);

  const headerRowIndex = preamble.length;
  const mergeTitle = {
    s: { r: 0, c: 0 },
    e: { r: 0, c: Math.max(cols.length - 1, 0) },
  };
  const merges = [mergeTitle];
  if (preamble.length > 1) {
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(cols.length - 1, 0) } });
  }
  ws['!merges'] = merges;

  return { ws, headerRowIndex };
}

/** Export an array of objects to a downloadable CSV file. */
export function exportCSV(rows, filename = 'export.csv', columns, meta = {}) {
  if (!rows?.length) return false;
  const cols = resolveColumns(rows, columns);
  const info = buildMeta({ ...meta, recordCount: rows.length });

  const parts = [
    ...metaLines(info),
    '',
    cols.map((c) => escapeCsv(c.label)).join(','),
    ...rows.map((row) => cols.map((c) => escapeCsv(row[c.key])).join(',')),
  ];

  const bom = '\uFEFF';
  const blob = new Blob([bom + parts.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, withExtension(filename, 'csv'));
  return true;
}

/** Export rows to an Excel workbook (.xlsx). */
export function exportXLSX(rows, filename = 'export.xlsx', columns, sheetName = 'Sheet1', meta = {}) {
  if (!rows?.length) return false;
  const cols = resolveColumns(rows, columns);
  const info = buildMeta({ title: sheetName, ...meta, recordCount: rows.length });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildInfoSheet(info), 'About');
  const { ws } = buildStyledSheet(rows, cols, info);
  XLSX.utils.book_append_sheet(wb, ws, String(sheetName).slice(0, 31));
  XLSX.writeFile(wb, withExtension(filename, 'xlsx'));
  return true;
}

/** Export multiple datasets as sheets in one workbook. */
export function exportMultiSheetXLSX(sheets, filename = 'export.xlsx', meta = {}) {
  const wb = XLSX.utils.book_new();
  let added = false;
  const totalRecords = sheets.reduce((n, s) => n + (s.rows?.length || 0), 0);
  const info = buildMeta({ ...meta, recordCount: totalRecords });

  XLSX.utils.book_append_sheet(wb, buildInfoSheet(info, sheets), 'About');

  for (const sheet of sheets) {
    if (!sheet?.rows?.length) continue;
    const cols = resolveColumns(sheet.rows, sheet.columns);
    const sheetMeta = buildMeta({
      title: sheet.name || 'Data',
      companyName: meta.companyName,
      recordCount: sheet.rows.length,
    });
    const { ws } = buildStyledSheet(sheet.rows, cols, sheetMeta);
    XLSX.utils.book_append_sheet(wb, ws, String(sheet.name || 'Sheet').slice(0, 31));
    added = true;
  }

  if (!added) return false;
  XLSX.writeFile(wb, withExtension(filename, 'xlsx'));
  return true;
}

function exportSectionedCSV(sections, filename, meta = {}) {
  const parts = [];
  const totalRecords = sections.reduce((n, s) => n + (s.rows?.length || 0), 0);
  const info = buildMeta({ ...meta, recordCount: totalRecords });

  parts.push(...metaLines(info), '');

  for (const section of sections) {
    if (!section?.rows?.length) continue;
    const cols = resolveColumns(section.rows, section.columns);
    parts.push(`=== ${section.name || 'Data'} (${section.rows.length} records) ===`);
    parts.push(cols.map((c) => escapeCsv(c.label)).join(','));
    for (const row of section.rows) {
      parts.push(cols.map((c) => escapeCsv(row[c.key])).join(','));
    }
    parts.push('');
  }

  if (parts.length <= metaLines(info).length + 1) return false;

  const bom = '\uFEFF';
  const blob = new Blob([bom + parts.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, withExtension(filename, 'csv'));
  return true;
}

function drawPdfHeader(doc, meta, margin) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(...BRAND_RGB);
  doc.rect(0, 0, pageW, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont(undefined, 'bold');
  const headline = meta.companyName
    ? `${meta.companyName} — ${meta.title}`
    : meta.title;
  doc.text(headline, margin, 12);

  doc.setFontSize(8.5);
  doc.setFont(undefined, 'normal');
  const sub = [
    meta.subtitle,
    `Generated ${meta.generatedAt}`,
    `${meta.recordCount} record${meta.recordCount === 1 ? '' : 's'}`,
  ].filter(Boolean).join('  ·  ');
  doc.text(sub, margin, 20);

  doc.setTextColor(0, 0, 0);
  return 34;
}

function addPdfFooter(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setDrawColor(...HEADER_FILL);
    doc.setLineWidth(0.3);
    doc.line(14, pageH - 12, pageW - 14, pageH - 12);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED_RGB);
    doc.text('Confidential — internal use only', 14, pageH - 7);
    doc.text(`Page ${i} of ${pageCount}`, pageW - 14, pageH - 7, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  }
}

/** Professional tabular PDF export with branded header and styled table. */
export function exportPDF(rows, filename = 'export.pdf', columns, title, meta = {}) {
  if (!rows?.length) return false;
  const cols = resolveColumns(rows, columns);
  const info = buildMeta({ title, ...meta, recordCount: rows.length });
  const margin = 14;
  const landscape = cols.length > 5;

  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const startY = drawPdfHeader(doc, info, margin);

  autoTable(doc, {
    startY,
    head: [cols.map((c) => c.label)],
    body: rows.map((row) => cols.map((c) => cellValue(row[c.key]))),
    margin: { left: margin, right: margin, top: startY, bottom: 18 },
    styles: {
      fontSize: 8.5,
      cellPadding: 2.5,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      textColor: [30, 41, 59],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: BRAND_RGB,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left',
    },
    alternateRowStyles: { fillColor: ALT_ROW_FILL },
    columnStyles: cols.reduce((acc, col, i) => {
      const sample = rows.slice(0, 20).map((r) => cellValue(r[col.key]));
      const isNumeric = sample.every((v) => v === '' || !Number.isNaN(Number(String(v).replace(/[,₹]/g, ''))));
      if (isNumeric) acc[i] = { halign: 'right' };
      return acc;
    }, {}),
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        doc.setFillColor(...BRAND_RGB);
        doc.rect(0, 0, doc.internal.pageSize.getWidth(), 10, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8);
        doc.text(info.title, margin, 7);
        doc.setTextColor(0, 0, 0);
      }
    },
  });

  addPdfFooter(doc);
  doc.save(withExtension(filename, 'pdf'));
  return true;
}

function exportSectionedPDF(sections, filename, title, meta = {}) {
  const totalRecords = sections.reduce((n, s) => n + (s.rows?.length || 0), 0);
  const info = buildMeta({ title, ...meta, recordCount: totalRecords });
  const margin = 14;
  let wrote = false;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  let startY = drawPdfHeader(doc, info, margin);

  for (const section of sections) {
    if (!section?.rows?.length) continue;
    wrote = true;
    const cols = resolveColumns(section.rows, section.columns);

    if (startY > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      startY = 18;
    }

    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...BRAND_RGB);
    doc.text(`${section.name || 'Data'} (${section.rows.length})`, margin, startY);
    doc.setTextColor(0, 0, 0);
    startY += 4;

    autoTable(doc, {
      startY,
      head: [cols.map((c) => c.label)],
      body: section.rows.map((row) => cols.map((c) => cellValue(row[c.key]))),
      margin: { left: margin, right: margin, bottom: 18 },
      styles: {
        fontSize: 8,
        cellPadding: 2,
        lineColor: [226, 232, 240],
        lineWidth: 0.2,
        textColor: [30, 41, 59],
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: BRAND_RGB,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      alternateRowStyles: { fillColor: ALT_ROW_FILL },
    });

    startY = doc.lastAutoTable.finalY + 10;
  }

  if (!wrote) return false;
  addPdfFooter(doc);
  doc.save(withExtension(filename, 'pdf'));
  return true;
}

/**
 * Export data in the requested format.
 * @returns {boolean} whether a file was generated
 */
export function exportData({
  format = 'csv',
  rows,
  filename = 'export',
  columns,
  title,
  sheets,
  companyName,
  subtitle,
}) {
  const meta = { companyName, subtitle };

  if (sheets?.length) {
    if (format === 'xlsx') return exportMultiSheetXLSX(sheets, filename, { title, ...meta });
    if (format === 'csv') return exportSectionedCSV(sheets, filename, { title, ...meta });
    if (format === 'pdf') return exportSectionedPDF(sheets, filename, title || filename, meta);
    return false;
  }

  if (!rows?.length) return false;
  if (format === 'csv') return exportCSV(rows, filename, columns, { title, ...meta });
  if (format === 'xlsx') return exportXLSX(rows, filename, columns, title || 'Report', { title, ...meta });
  if (format === 'pdf') return exportPDF(rows, filename, columns, title, meta);
  return false;
}
