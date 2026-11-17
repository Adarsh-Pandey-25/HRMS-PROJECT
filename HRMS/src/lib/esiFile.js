/**
 * ESIC's monthly contribution upload file. ESIC's portal takes only an
 * Excel 97-2003 (.xls) workbook with every column formatted as text: the
 * header row, then one row per insured person — IP number, IP name, days
 * paid, total monthly wages, reason code, last working day (dd/mm/yyyy).
 * The server works out the rows (GET /payroll/statutory/esi); this lays
 * them out. SheetJS is passed in so the layout can be checked outside the
 * browser (backend/tests/payroll/esiFile.test.js).
 */

/** The row fields, in ESIC's column order. */
export const ESI_FILE_FIELDS = ['ipNumber', 'ipName', 'days', 'wages', 'reasonCode', 'lastWorkingDay'];

/** Excel's built-in "Text" number format. */
const TEXT_FORMAT = '@';

/** The workbook: one sheet, every cell text — numbers and dates included, so Excel can't reshape them. */
export function buildEsiWorkbook(XLSX, file) {
  const header = file.header;
  const lines = [header, ...(file.rows || []).map((row) => ESI_FILE_FIELDS.map((field) => row[field]))];
  const ws = {};
  lines.forEach((values, r) => {
    values.forEach((value, c) => {
      const text = value == null ? '' : String(value);
      // An empty cell (no last working day) stays blank but formatted as
      // text, so a date typed into it later isn't turned into a number.
      ws[XLSX.utils.encode_cell({ r, c })] = text ? { t: 's', v: text, z: TEXT_FORMAT } : { t: 'z', z: TEXT_FORMAT };
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lines.length - 1, c: header.length - 1 } });
  ws['!cols'] = header.map((_, c) => ({
    wch: Math.min(40, Math.max(12, ...lines.map((line) => String(line[c] ?? '').length))),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return wb;
}

/** The .xls file's bytes: BIFF8 (Excel 97-2003), strings in a shared string table as Excel writes them. */
export function esiWorkbookBytes(XLSX, file) {
  return XLSX.write(buildEsiWorkbook(XLSX, file), { bookType: 'xls', bookSST: true, type: 'array' });
}
