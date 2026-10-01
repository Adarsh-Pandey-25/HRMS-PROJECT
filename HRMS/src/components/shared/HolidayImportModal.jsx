import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Mail, UploadCloud } from 'lucide-react';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { Badge, Button, Modal } from '../ui';
import { bulkImportHolidaysApi } from '../../api/holidays.api';
import { downloadBlob, parseImportDate } from './BulkImportPanel';
import { formatDate } from '../../lib/utils';

/**
 * Import a whole holiday list from a CSV/Excel file. Every row is checked
 * here first; nothing is saved until the list is clean. With the email box
 * ticked, each employee gets ONE email listing all the imported holidays.
 */

const TEMPLATE_HEADERS = ['Date', 'Holiday', 'Type', 'Description'];
const SAMPLE_ROWS = [
  ['26-01-2027', 'Republic Day', 'Public', ''],
  ['14-03-2027', 'Holi', 'Public', ''],
  ['15-08-2027', 'Independence Day', 'Public', ''],
  ['02-10-2027', 'Gandhi Jayanti', 'Public', ''],
  ['29-10-2027', 'Diwali', 'Public', 'Festival of lights'],
  ['04-11-2027', 'Bhai Dooj', 'Optional', 'Apply as leave if you take it'],
];
const TYPE_ALIASES = {
  '': 'public', public: 'public', national: 'public', gazetted: 'public', mandatory: 'public',
  optional: 'optional', restricted: 'restricted', rh: 'restricted',
};

/** First non-empty cell among the header spellings people actually use. */
const cell = (row, names) => {
  const key = Object.keys(row).find((k) => names.includes(k.trim().toLowerCase()));
  return key == null ? '' : row[key];
};

function readRows(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = (e) => {
      try {
        // XLSX reads CSV too — and, unlike splitting on commas, handles
        // quoted names such as "Diwali, Day 2". Only HR/Admin's own file,
        // parsed in their own browser (see BulkImportPanel's note on xlsx).
        const wb = /\.csv$/i.test(file.name)
          ? XLSX.read(String(e.target.result), { type: 'string', raw: true })
          : XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true }));
      } catch {
        reject(new Error('This file could not be read. Use the template (CSV or Excel).'));
      }
    };
    if (/\.csv$/i.test(file.name)) reader.readAsText(file); else reader.readAsArrayBuffer(file);
  });
}

function checkRows(rows, existing) {
  const existingKeys = new Set(existing.map((h) => `${String(h.date).slice(0, 10)}|${String(h.name || '').trim().toLowerCase()}`));
  const seen = new Set();
  return rows
    .filter((r) => Object.values(r).some((v) => String(v).trim() !== ''))
    .map((r, i) => {
      const rawDate = cell(r, ['date', 'holiday date']);
      const title = String(cell(r, ['holiday', 'holiday name', 'name', 'title', 'occasion']) || '').trim();
      const rawType = String(cell(r, ['type', 'holiday type', 'category']) || '').trim().toLowerCase();
      const description = String(cell(r, ['description', 'notes', 'note']) || '').trim();
      const date = parseImportDate(rawDate);
      const type = TYPE_ALIASES[rawType];
      let problem = null;
      if (!title) problem = 'Holiday name missing';
      else if (!date) problem = `"${rawDate}" is not a date (use DD-MM-YYYY)`;
      else if (!type) problem = 'Type must be Public, Optional or Restricted';
      const key = `${date}|${title.toLowerCase()}`;
      let status = problem ? 'error' : 'ok';
      if (!problem && seen.has(key)) status = 'repeat';
      else if (!problem && existingKeys.has(key)) status = 'exists';
      if (!problem) seen.add(key);
      return { row: i + 2, date, title, type: type || rawType, description, problem, status };
    });
}

const STATUS_BADGE = {
  ok: <Badge tone="success">New</Badge>,
  exists: <Badge tone="neutral">Already added</Badge>,
  repeat: <Badge tone="neutral">Repeated in file</Badge>,
};

export function HolidayImportModal({ open, onClose, existing = [], onImported }) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [checked, setChecked] = useState([]);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  const errors = checked.filter((r) => r.status === 'error');
  const fresh = checked.filter((r) => r.status === 'ok');

  const reset = () => { setFileName(''); setChecked([]); setNotify(true); if (fileRef.current) fileRef.current.value = ''; };
  const close = () => { if (!busy) { reset(); onClose(); } };

  const pick = async (file) => {
    if (!file) return;
    try {
      const rows = await readRows(file);
      const result = checkRows(rows, existing);
      if (!result.length) { toast.error('No holidays found in this file'); return; }
      setFileName(file.name);
      setChecked(result);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const downloadTemplate = () => {
    const csv = [TEMPLATE_HEADERS, ...SAMPLE_ROWS].map((r) => r.map((v) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'holiday-list-template.csv');
  };

  const runImport = async () => {
    setBusy(true);
    try {
      const result = await bulkImportHolidaysApi(
        fresh.map(({ date, title, type, description }) => ({ date, title, type, description })),
        { notify },
      );
      const created = result?.created ?? fresh.length;
      toast.success(
        notify && result?.emailed
          ? `${created} holiday${created === 1 ? '' : 's'} imported — one email sent to each of ${result.emailed} employees`
          : `${created} holiday${created === 1 ? '' : 's'} imported`,
      );
      await onImported?.();
      reset();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Import holiday list"
      subtitle="Upload the whole year's holidays at once from a CSV or Excel file."
      footer={(
        <>
          <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
          <Button onClick={runImport} loading={busy} disabled={!fresh.length || errors.length > 0 || busy}>
            {fresh.length ? `Import ${fresh.length} holiday${fresh.length === 1 ? '' : 's'}` : 'Import'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        {!checked.length ? (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-10 text-center transition-colors hover:border-primary hover:bg-primary/5"
            >
              <UploadCloud className="h-8 w-8 text-primary" />
              <span className="text-sm font-medium text-fg">Choose a file or drop it here</span>
              <span className="text-xs text-fg-subtle">CSV or Excel · columns: Date, Holiday, Type (Public / Optional / Restricted), Description</span>
            </button>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
            <div className="flex items-center justify-between rounded-xl bg-muted/50 px-4 py-3">
              <p className="text-xs text-fg-muted">Dates as DD-MM-YYYY (e.g. 02-10-2027). Rows already in the calendar are skipped.</p>
              <Button variant="ghost" size="sm" icon={Download} onClick={downloadTemplate}>Template</Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              <span className="font-medium text-fg">{fileName}</span>
              <span className="text-fg-subtle">·</span>
              <span className="text-fg-muted">{fresh.length} new</span>
              {errors.length > 0 && <Badge tone="danger">{errors.length} to fix</Badge>}
              {checked.length - fresh.length - errors.length > 0 && (
                <span className="text-fg-subtle">· {checked.length - fresh.length - errors.length} skipped</span>
              )}
              <button type="button" className="ml-auto text-xs font-medium text-primary hover:underline" onClick={reset}>Choose another file</button>
            </div>

            {errors.length > 0 && (
              <div className="flex gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Fix the highlighted rows in your file and upload it again — nothing is imported until every row is valid.
              </div>
            )}

            <div className="max-h-72 overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    <th className="px-3 py-2 text-xs font-semibold uppercase text-fg-subtle">Row</th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase text-fg-subtle">Date</th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase text-fg-subtle">Holiday</th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase text-fg-subtle">Type</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {checked.map((r) => (
                    <tr key={r.row} className={`border-t border-border/60 ${r.status === 'error' ? 'bg-danger/5' : ''}`}>
                      <td className="px-3 py-2 text-xs text-fg-subtle">{r.row}</td>
                      <td className="px-3 py-2 text-fg-muted whitespace-nowrap">{r.date ? formatDate(r.date, 'EEE, dd MMM yyyy') : '—'}</td>
                      <td className="px-3 py-2 text-fg">{r.title || '—'}</td>
                      <td className="px-3 py-2 capitalize text-fg-muted">{r.type || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        {r.status === 'error'
                          ? <span className="text-xs text-danger">{r.problem}</span>
                          : STATUS_BADGE[r.status]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border px-4 py-3">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-primary))]" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-medium text-fg"><Mail className="h-4 w-4 text-primary" /> Email the holiday list to all employees</span>
                <span className="mt-0.5 block text-xs text-fg-subtle">Each employee gets one email listing all {fresh.length} holidays — not one email per holiday.</span>
              </span>
            </label>
            {fresh.length > 0 && errors.length === 0 && (
              <p className="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Ready to import.</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
