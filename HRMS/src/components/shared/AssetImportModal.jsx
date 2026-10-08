import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, UploadCloud } from 'lucide-react';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { Badge, Button, Modal } from '../ui';
import { createAssetApi, assignAssetApi } from '../../api/assets.api';
import { downloadBlob, parseImportDate } from './BulkImportPanel';
import { formatCurrency } from '../../lib/utils';

/**
 * Bulk import a whole asset list from the filled-in Excel template.
 *
 * The template offered on the Asset Inventory page is Excel (.xlsx). A .csv
 * is still accepted on upload — someone exporting from another system should
 * not be turned away — but it is not advertised.
 *
 * Every row is checked in the browser first and shown with its problem, so
 * the file can be fixed before anything is written. Rows that still have a
 * problem are skipped rather than blocking the clean ones — a single typo in
 * a 200-row sheet shouldn't stop the import.
 *
 * "Assigned To Email" is optional: with it, the asset is created and then
 * assigned to that employee, which is the same two-step the Add Asset form
 * does (assets are always created `available`).
 */

const TEMPLATE_HEADERS = [
  'Asset Name',
  'Category',
  'Brand',
  'Model',
  'Serial Number',
  'Ownership (Purchased/Rented)',
  'Purchase Date (DD-MM-YYYY)',
  'Purchase Cost',
  'Warranty Expiry (DD-MM-YYYY)',
  'Location',
  'Assigned To Email',
];

const SAMPLE_ROWS = [
  ['Dell Latitude 5440', 'Laptop', 'Dell', 'Latitude 5440', 'DL5440X91234', 'Purchased', '15-04-2026', '85000', '15-04-2029', 'Bengaluru HQ', ''],
  ['iPhone 15', 'Phone', 'Apple', 'iPhone 15 128GB', 'IP15A77821', 'Purchased', '02-06-2026', '79900', '02-06-2027', 'Bengaluru HQ', 'esther.howard@company.com'],
  ['Dell 24" Monitor', 'Monitor', 'Dell', 'P2422H', 'MON24DL5567', 'Rented', '20-03-2026', '14500', '', 'Delhi NCR', ''],
  ['Ergonomic Chair', 'Furniture', 'Featherlite', 'Optima HB', '', 'Rented', '11-01-2026', '12000', '', 'Delhi NCR', ''],
];

/** Blank means purchased — the column default, and what every pre-existing asset is. */
const OWNERSHIP_ALIASES = {
  '': 'purchased',
  purchased: 'purchased', purchase: 'purchased', owned: 'purchased', own: 'purchased', bought: 'purchased',
  rented: 'rented', rent: 'rented', rental: 'rented', leased: 'rented', lease: 'rented',
};

/** Column limits from the `assets` table — caught here instead of as a DB error. */
const MAX_LEN = {
  name: 200, category: 100, brand: 100, model: 100, serial: 100, location: 200,
};
/** purchase_cost is NUMERIC(12,2). */
const MAX_COST = 9999999999.99;

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
        /* TRUSTED_INPUT_ONLY — same basis as BulkImportPanel's note on xlsx:
         * parsed entirely client-side, in the uploading HR/Admin's own tab,
         * from a file they chose. Not a server-side or cross-user surface. */
        const wb = /\.csv$/i.test(file.name)
          ? XLSX.read(String(e.target.result), { type: 'string', raw: true })
          : XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true }));
      } catch {
        reject(new Error('This file could not be read. Use the Excel template.'));
      }
    };
    if (/\.csv$/i.test(file.name)) reader.readAsText(file); else reader.readAsArrayBuffer(file);
  });
}

/** Accepts "85,000", "₹85000", "85000.50" — blank means no cost recorded. */
function parseCost(raw) {
  if (raw == null || String(raw).trim() === '') return { value: null, ok: true };
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? { value: raw, ok: true } : { value: null, ok: false };
  }
  const cleaned = String(raw).replace(/[₹,\s]/g, '');
  if (!/^\d*\.?\d+$/.test(cleaned)) return { value: null, ok: false };
  const num = Number(cleaned);
  return Number.isFinite(num) && num >= 0 ? { value: num, ok: true } : { value: null, ok: false };
}

function checkRows(rows, existingSerials, employeeByEmail) {
  const seenSerials = new Set();

  return rows
    .filter((r) => Object.values(r).some((v) => String(v).trim() !== ''))
    .map((r, i) => {
      const name = String(cell(r, ['asset name', 'name', 'asset']) || '').trim();
      const category = String(cell(r, ['category', 'type', 'asset type']) || '').trim();
      const brand = String(cell(r, ['brand', 'make', 'manufacturer']) || '').trim();
      const model = String(cell(r, ['model', 'model number']) || '').trim();
      const serial = String(cell(r, ['serial number', 'serial', 'serial no', 'serial no.']) || '').trim();
      const location = String(cell(r, ['location', 'site', 'office']) || '').trim();
      const assignEmail = String(cell(r, ['assigned to email', 'assigned to', 'assignee email', 'employee email']) || '')
        .trim().toLowerCase();
      const rawOwnership = String(cell(r, ['ownership (purchased/rented)', 'ownership', 'owned or rented', 'purchase type']) || '')
        .trim().toLowerCase();
      const ownership = OWNERSHIP_ALIASES[rawOwnership];

      const rawPurchase = cell(r, ['purchase date (dd-mm-yyyy)', 'purchase date', 'purchased on']);
      const rawWarranty = cell(r, ['warranty expiry (dd-mm-yyyy)', 'warranty expiry', 'warranty']);
      const rawCost = cell(r, ['purchase cost', 'cost', 'price', 'amount']);

      const purchaseDate = String(rawPurchase).trim() === '' ? null : parseImportDate(rawPurchase);
      const warrantyExpiry = String(rawWarranty).trim() === '' ? null : parseImportDate(rawWarranty);
      const cost = parseCost(rawCost);

      const problems = [];
      if (!name) problems.push('Asset name missing');
      else if (name.length > MAX_LEN.name) problems.push(`Asset name over ${MAX_LEN.name} characters`);
      if (category.length > MAX_LEN.category) problems.push('Category too long');
      if (brand.length > MAX_LEN.brand) problems.push('Brand too long');
      if (model.length > MAX_LEN.model) problems.push('Model too long');
      if (serial.length > MAX_LEN.serial) problems.push('Serial number too long');
      if (location.length > MAX_LEN.location) problems.push('Location too long');

      if (String(rawPurchase).trim() !== '' && !purchaseDate) problems.push('Purchase date must be DD-MM-YYYY');
      if (String(rawWarranty).trim() !== '' && !warrantyExpiry) problems.push('Warranty expiry must be DD-MM-YYYY');
      if (purchaseDate && warrantyExpiry && warrantyExpiry < purchaseDate) {
        problems.push('Warranty expiry is before the purchase date');
      }

      if (!cost.ok) problems.push('Purchase cost must be a number');
      else if (cost.value != null && cost.value > MAX_COST) problems.push('Purchase cost is too large');

      if (serial) {
        const key = serial.toLowerCase();
        if (seenSerials.has(key)) problems.push('Duplicate serial number in this file');
        else if (existingSerials.has(key)) problems.push('An asset with this serial number already exists');
        else seenSerials.add(key);
      }

      if (assignEmail && !employeeByEmail.has(assignEmail)) {
        problems.push('No active employee with this email');
      }
      if (!ownership) problems.push('Ownership must be Purchased or Rented');

      return {
        row: i + 2, // +2: sheet row 1 is the header
        name,
        category,
        brand,
        model,
        serial,
        location,
        ownership,
        purchaseDate,
        warrantyExpiry,
        cost: cost.value,
        assignEmail,
        assignEmployeeId: assignEmail ? employeeByEmail.get(assignEmail) : null,
        problem: problems[0] || null,
      };
    });
}

function buildTemplateRows() {
  return [TEMPLATE_HEADERS, ...SAMPLE_ROWS];
}

/**
 * Download the Excel template. Exported so Asset Inventory can offer it from
 * the page header — someone filling the sheet in needs it before they open
 * the import dialog, not inside it.
 */
export function downloadAssetExcelTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(buildTemplateRows());
  // Readable column widths so the template opens usable rather than cramped.
  ws['!cols'] = [
    { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 18 },
    { wch: 28 }, { wch: 26 }, { wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Assets');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    'asset-import-template.xlsx',
  );
}

export function AssetImportModal({ open, onClose, existingAssets = [], employees = [], onImported }) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [checked, setChecked] = useState([]);
  const [busy, setBusy] = useState(false);

  const errors = checked.filter((r) => r.problem);
  const ready = checked.filter((r) => !r.problem);

  const reset = () => {
    setFileName('');
    setChecked([]);
    if (fileRef.current) fileRef.current.value = '';
  };
  const close = () => { if (!busy) { reset(); onClose(); } };

  const pick = async (file) => {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toast.error('Please upload the Excel template (.xlsx)');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File exceeds 10MB');
      return;
    }
    try {
      const rows = await readRows(file);
      const existingSerials = new Set(
        existingAssets.map((a) => String(a.serialNumber || '').trim().toLowerCase()).filter(Boolean),
      );
      const employeeByEmail = new Map(
        employees
          .filter((e) => e.isActive !== false)
          .map((e) => [String(e.workEmail || e.email || '').trim().toLowerCase(), e.id])
          .filter(([email]) => email),
      );
      const result = checkRows(rows, existingSerials, employeeByEmail);
      if (!result.length) {
        toast.error('No assets found in this file');
        return;
      }
      setFileName(file.name);
      setChecked(result);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const runImport = async () => {
    if (!ready.length) return toast.error('No valid rows to import');
    setBusy(true);
    let created = 0;
    let assigned = 0;
    const failures = [];

    for (const r of ready) {
      try {
        const asset = await createAssetApi({
          name: r.name,
          category: r.category || undefined,
          brand: r.brand || undefined,
          model: r.model || undefined,
          serialNumber: r.serial || undefined,
          purchaseDate: r.purchaseDate || undefined,
          purchaseCost: r.cost != null ? r.cost : undefined,
          warrantyExpiry: r.warrantyExpiry || undefined,
          location: r.location || undefined,
          ownership: r.ownership || undefined,
        });
        created += 1;

        if (r.assignEmployeeId && asset?.id) {
          try {
            await assignAssetApi(asset.id, r.assignEmployeeId);
            assigned += 1;
          } catch (err) {
            failures.push(`Row ${r.row} (${r.name}): created, but assigning to ${r.assignEmail} failed — ${err.message}`);
          }
        }
      } catch (err) {
        failures.push(`Row ${r.row} (${r.name}): ${err.message}`);
      }
    }

    setBusy(false);

    if (created) {
      toast.success(
        `${created} asset${created === 1 ? '' : 's'} imported${assigned ? `, ${assigned} assigned` : ''}`,
      );
    }
    if (failures.length) {
      toast.error(failures.slice(0, 3).join('\n') + (failures.length > 3 ? `\n…and ${failures.length - 3} more` : ''), { duration: 8000 });
    }
    if (created) {
      await onImported?.();
      reset();
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Bulk import assets"
      subtitle="Add your whole asset list at once from the filled-in Excel template."
      footer={(
        <>
          <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
          <Button onClick={runImport} loading={busy} disabled={!ready.length || busy}>
            {ready.length ? `Import ${ready.length} asset${ready.length === 1 ? '' : 's'}` : 'Import'}
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
              <span className="text-xs text-fg-subtle">
                Excel file · Asset Name is the only required column
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            <div className="rounded-xl bg-muted/50 px-4 py-3">
              <p className="text-xs text-fg-muted">
                Fill in the Excel template from the Asset Inventory page. Dates as DD-MM-YYYY, Ownership as
                Purchased or Rented (blank counts as Purchased). Leave{' '}
                <span className="font-medium">Assigned To Email</span> blank to import an asset as available.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              <span className="font-medium text-fg">{fileName}</span>
              <span className="text-fg-subtle">·</span>
              <span className="text-fg-muted">{ready.length} ready</span>
              {errors.length > 0 && <Badge tone="danger">{errors.length} to fix</Badge>}
              <button
                type="button"
                className="ml-auto text-xs font-medium text-primary hover:underline"
                onClick={reset}
              >
                Choose another file
              </button>
            </div>

            {errors.length > 0 && (
              <div className="flex gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {errors.length} row{errors.length === 1 ? '' : 's'} will be skipped. Fix them in your file and
                upload again to bring them in.
              </div>
            )}

            <div className="max-h-72 overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    <th className="px-3 py-2 text-xs font-semibold uppercase text-fg-subtle">Row</th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase text-fg-subtle">Asset</th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase text-fg-subtle">Category</th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase text-fg-subtle">Serial</th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase text-fg-subtle">Ownership</th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase text-fg-subtle">Cost</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {checked.map((r) => (
                    <tr key={r.row} className={`border-t border-border/60 ${r.problem ? 'bg-danger/5' : ''}`}>
                      <td className="px-3 py-2 text-xs text-fg-subtle">{r.row}</td>
                      <td className="px-3 py-2 text-fg">
                        {r.name || '—'}
                        {r.assignEmail && !r.problem && (
                          <span className="block text-[11px] text-fg-subtle">→ {r.assignEmail}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-fg-muted">{r.category || '—'}</td>
                      <td className="px-3 py-2 text-fg-muted">{r.serial || '—'}</td>
                      <td className="px-3 py-2 text-fg-muted capitalize">{r.ownership || '—'}</td>
                      <td className="px-3 py-2 text-fg-muted whitespace-nowrap">
                        {r.cost != null ? formatCurrency(r.cost) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.problem
                          ? <span className="text-xs text-danger">{r.problem}</span>
                          : <Badge tone="success">Ready</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {ready.length > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Ready to import {ready.length} asset{ready.length === 1 ? '' : 's'}.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
