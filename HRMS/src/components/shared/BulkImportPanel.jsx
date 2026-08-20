import { useRef, useState } from 'react';
import { UploadCloud, File, X, Download, AlertTriangle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { Button, Badge } from '../ui';
import { createEmployeeApi, fetchAllEmployeesApi } from '../../api/employees.api';
import { cn } from '../../lib/utils';

const TEMPLATE_HEADERS = [
  'First Name',
  'Last Name',
  'Date of Birth (DD-MM-YYYY)',
  'Gender',
  'Personal Email',
  'Phone',
  'Address Line 1',
  'Address Line 2',
  'City',
  'State',
  'Pincode',
  'Country',
  'Emergency Contact Name',
  'Emergency Contact Phone',
  'Emergency Contact Relation',
  'Bank Name',
  'Bank Account Number',
  'IFSC',
  'Designation',
  'Department',
  'Employment Type',
  'Join Date (DD-MM-YYYY)',
  'Reporting Manager Email',
  'Work Location',
  'Attendance Type',
  'Shift',
  'Salary Entered As',
  'Basic Salary',
  'HRA',
  'DA',
  'Special Allowance',
  'Transport Allowance',
  'Medical Allowance',
  'PF Applicable',
  'PT Applicable',
  'PF % Override',
  'TDS Mode',
  'TDS Fixed Amount',
  'Work Email',
  'System Role',
];

const SAMPLE_ROWS = [
  [
    'Esther', 'Howard', '12-04-1997', 'female', 'esther.personal@company.com', '9876543210',
    '12 Residency Road', 'MG Road', 'Bengaluru', 'Karnataka', '560001', 'India',
    'John Howard', '9876501234', 'Father',
    'HDFC Bank', '123456789012', 'HDFC0001234',
    'Software Engineer', 'Engineering', 'full_time', '15-07-2026', 'vikram.singh@company.com',
    'Bengaluru HQ', 'office', 'General', 'monthly', '25000', '10000', '2500', '8000', '0', '0',
    'true', 'true', '', 'company', '0', 'esther.howard@company.com', 'employee',
  ],
  [
    'Rahul', 'Verma', '08-09-1994', 'male', 'rahul.personal@company.com', '9876500002',
    '44 Civil Lines', '', 'Delhi', 'Delhi', '110054', 'India',
    'Sneha Verma', '9876502222', 'Spouse',
    'ICICI Bank', '987654321098', 'ICIC0001234',
    'Accountant', 'Finance', 'full_time', '01-08-2026', 'meera.shah@company.com',
    'Delhi NCR', 'hybrid', 'Morning', 'annual', '480000', '192000', '48000', '60000', '24000', '12000',
    'true', 'true', '', 'fixed', '12000', 'rahul.verma@company.com', 'employee',
  ],
];

/** Read DOB / join date from either new DD-MM-YYYY or older YYYY-MM-DD column names. */
function readImportDateCell(row, kind) {
  if (kind === 'dob') {
    return row['Date of Birth (DD-MM-YYYY)']
      ?? row['Date of Birth (YYYY-MM-DD)']
      ?? row['Date of Birth']
      ?? '';
  }
  return row['Join Date (DD-MM-YYYY)']
    ?? row['Join Date (YYYY-MM-DD)']
    ?? row['Join Date']
    ?? '';
}

/**
 * Accept DD-MM-YYYY (preferred), YYYY-MM-DD, or Excel serial dates.
 * Returns ISO YYYY-MM-DD for the API, or null if empty/invalid.
 */
function parseImportDate(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = value.getMonth() + 1;
    const day = value.getDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF?.parse_date_code?.(value);
    if (parsed?.y && parsed?.m && parsed?.d) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
    return null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const dmy = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const ymd = raw.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return null;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCsvTemplate() {
  const csv = [TEMPLATE_HEADERS.join(','), ...SAMPLE_ROWS.map((r) => r.join(','))].join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'employee-import-template.csv');
}

function downloadExcelTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...SAMPLE_ROWS]);
  XLSX.utils.book_append_sheet(wb, ws, 'Employees');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    'employee-import-template.xlsx'
  );
}

function parseCSV(text) {
  const lines = text.split(/\r\n|\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

function parseSpreadsheet(file, onLoaded) {
  const isCsv = /\.csv$/i.test(file.name);
  const reader = new FileReader();
  reader.onload = (e) => {
    if (isCsv) {
      const { rows } = parseCSV(String(e.target.result));
      onLoaded(rows);
      return;
    }
    const workbook = XLSX.read(e.target.result, { type: 'array' });
    const firstSheet = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheet];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    onLoaded(rows);
  };
  if (isCsv) reader.readAsText(file);
  else reader.readAsArrayBuffer(file);
}

function truthyCsvValue(value, defaultValue = true) {
  if (value == null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  return defaultValue;
}

function normalizeEmploymentType(value) {
  return String(value || 'full_time').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeAttendanceType(value) {
  const v = String(value || 'office').trim().toLowerCase();
  return ['office', 'wfh', 'hybrid'].includes(v) ? v : 'office';
}

function normalizeSalaryPeriod(value) {
  return String(value || 'monthly').trim().toLowerCase() === 'annual' ? 'annual' : 'monthly';
}

function monthlyAmount(value, period) {
  const num = Number(value || 0);
  return period === 'annual' ? Math.round(num / 12) : num;
}

function rowDisplayName(row) {
  return [row._first, row._last].filter(Boolean).join(' ').trim() || row._email || 'Row';
}

function validateRows(rows, existingEmails, managerDirectory) {
  const seen = new Set();
  return rows.map((row) => {
    const errors = [];
    const first = String(row['First Name'] || row['Full Name']?.split(' ')[0] || '').trim();
    const last = String(row['Last Name'] || row['Full Name']?.split(' ').slice(1).join(' ') || '').trim();
    const email = String(row['Work Email'] || row.Email || '').trim().toLowerCase();
    const designation = row.Designation || row.designation;
    const department = row.Department || row.department;
    const managerEmail = String(row['Reporting Manager Email'] || '').trim().toLowerCase();
    const personalEmail = String(row['Personal Email'] || '').trim().toLowerCase();
    const phone = String(row.Phone || row.phone || '').trim();
    const dobRaw = readImportDateCell(row, 'dob');
    const joinRaw = readImportDateCell(row, 'join');
    const dobIso = dobRaw === '' || dobRaw == null ? null : parseImportDate(dobRaw);
    const joinIso = joinRaw === '' || joinRaw == null ? null : parseImportDate(joinRaw);

    if (!first) errors.push('First name missing');
    if (!last) errors.push('Last name missing');
    if (!email || !email.includes('@')) errors.push('Valid work email required');
    else if (existingEmails.has(email)) errors.push('Email already exists');
    else if (seen.has(email)) errors.push('Duplicate email in file');
    else seen.add(email);
    if (personalEmail && !personalEmail.includes('@')) errors.push('Personal email is invalid');
    if (phone && !/^\d{10}$/.test(phone.replace(/\D/g, ''))) errors.push('Phone must be 10 digits');
    if (dobRaw !== '' && dobRaw != null && !dobIso) errors.push('Date of birth must be DD-MM-YYYY');
    if (joinRaw !== '' && joinRaw != null && !joinIso) errors.push('Join date must be DD-MM-YYYY');
    if (!designation) errors.push('Designation missing');
    if (!department) errors.push('Department missing');
    if (managerEmail && !managerDirectory.has(managerEmail)) errors.push('Reporting manager email not found');

    return {
      ...row,
      _first: first,
      _last: last,
      _email: email,
      _managerId: managerEmail ? managerDirectory.get(managerEmail) : '',
      _dateOfBirth: dobIso || undefined,
      _dateOfJoining: joinIso || undefined,
      _errors: errors,
    };
  });
}

export function BulkImportPanel({ onSkip, onImported }) {
  const inputRef = useRef();
  const [fileName, setFileName] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error('File exceeds 10MB');
    setFileName(file.name);
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      toast.error('Please upload a .csv or .xlsx file');
      setParsed(null);
      return;
    }
    let existingEmails = new Set();
    let managerDirectory = new Map();
    try {
      const emp = await fetchAllEmployeesApi({ limit: 500 });
      existingEmails = new Set((emp || []).map((e) => String(e.workEmail || e.email || '').toLowerCase()).filter(Boolean));
      managerDirectory = new Map(
        (emp || [])
          .filter((e) => ['manager', 'admin', 'hr'].includes(String(e.role || '').toLowerCase()))
          .map((e) => [String(e.workEmail || e.email || '').toLowerCase(), e.id])
      );
    } catch {
      /* validation still works without existing list */
    }
    parseSpreadsheet(file, (rows) => {
      setParsed(validateRows(rows, existingEmails, managerDirectory));
    });
  };

  const reset = () => {
    setFileName(null);
    setParsed(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const errorCount = parsed ? parsed.filter((r) => r._errors.length > 0).length : 0;
  const validRows = parsed ? parsed.filter((r) => r._errors.length === 0) : [];

  const importValid = async () => {
    if (!validRows.length) return toast.error('No valid rows to import');
    setImporting(true);
    let ok = 0;
    const failures = [];
    for (const row of validRows) {
      try {
        const salaryPeriod = normalizeSalaryPeriod(row['Salary Entered As']);
        await createEmployeeApi({
          firstName: row._first,
          lastName: row._last,
          email: row._email,
          designation: row.Designation || row.designation,
          department: row.Department || row.department,
          gender: row.Gender || undefined,
          phone: String(row.Phone || row.phone || '').replace(/\D/g, '') || undefined,
          dateOfBirth: row._dateOfBirth,
          dateOfJoining: row._dateOfJoining,
          employmentType: normalizeEmploymentType(row['Employment Type']),
          role: row['System Role'] || row.Role || 'employee',
          managerId: row._managerId || undefined,
          address: {
            line1: row['Address Line 1'] || '',
            line2: row['Address Line 2'] || '',
            city: row.City || '',
            state: row.State || '',
            pincode: row.Pincode || '',
            country: row.Country || 'India',
            work_location: row['Work Location'] || '',
            attendance_mode: normalizeAttendanceType(row['Attendance Type']),
            personal_email: row['Personal Email'] || '',
          },
          emergencyContact: {
            name: row['Emergency Contact Name'] || '',
            phone: String(row['Emergency Contact Phone'] || '').replace(/\D/g, ''),
            relation: row['Emergency Contact Relation'] || '',
          },
          bankDetails: {
            bankName: row['Bank Name'] || '',
            accountNumber: row['Bank Account Number'] || '',
            ifsc: row.IFSC || '',
          },
          salaryDetails: {
            salaryPeriod,
            basic: monthlyAmount(row['Basic Salary'], salaryPeriod),
            hra: monthlyAmount(row.HRA, salaryPeriod),
            da: monthlyAmount(row.DA, salaryPeriod),
            special: monthlyAmount(row['Special Allowance'], salaryPeriod),
            transport: monthlyAmount(row['Transport Allowance'], salaryPeriod),
            medical: monthlyAmount(row['Medical Allowance'], salaryPeriod),
            pfApplicable: truthyCsvValue(row['PF Applicable'], true),
            ptApplicable: truthyCsvValue(row['PT Applicable'], true),
            pfPercent: row['PF % Override'] === '' ? null : Number(row['PF % Override'] || 0),
            tdsMode: String(row['TDS Mode'] || 'company').trim().toLowerCase(),
            tdsFixed: monthlyAmount(row['TDS Fixed Amount'], salaryPeriod),
          },
        });
        ok += 1;
      } catch (err) {
        failures.push(`${row._email}: ${err.message}`);
      }
    }
    setImporting(false);
    if (ok) toast.success(`Imported ${ok} employee${ok === 1 ? '' : 's'}`);
    if (failures.length) toast.error(`${failures.length} failed — ${failures[0]}`);
    onImported?.(ok);
    reset();
  };

  if (!parsed) {
    return (
      <div className="space-y-4">
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
          className={cn(
            'rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
          )}
        >
          <UploadCloud className="h-8 w-8 mx-auto text-primary mb-3" />
          <p className="text-sm font-medium text-fg">Drop CSV or Excel here or click to browse</p>
          <p className="text-xs text-fg-subtle mt-1">Max 10MB · .csv or .xlsx</p>
          <input ref={inputRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" icon={Download} onClick={downloadCsvTemplate}>CSV template</Button>
            <Button variant="outline" icon={Download} onClick={downloadExcelTemplate}>Excel template</Button>
          </div>
          {onSkip && <Button variant="ghost" onClick={onSkip}>Skip for now</Button>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-border p-3">
        <File className="h-5 w-5 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg truncate">{fileName}</p>
          <p className="text-xs text-fg-subtle">{validRows.length} valid · {errorCount} with errors</p>
        </div>
        <button type="button" onClick={reset} className="p-1.5 text-fg-subtle hover:text-danger"><X className="h-4 w-4" /></button>
      </div>

      <div className="max-h-64 overflow-auto rounded-xl border border-border divide-y divide-border/60">
        {parsed.map((row, i) => (
          <div key={i} className="flex items-start gap-2 px-3 py-2 text-sm">
            {row._errors.length ? (
              <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-fg truncate">{rowDisplayName(row)} · {row._email}</p>
              {row._errors.length > 0 && (
                <p className="text-xs text-danger mt-0.5">{row._errors.join(' · ')}</p>
              )}
            </div>
            <Badge tone={row._errors.length ? 'danger' : 'success'}>{row._errors.length ? 'Invalid' : 'OK'}</Badge>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={reset}>Cancel</Button>
        <Button onClick={importValid} disabled={!validRows.length || importing} loading={importing}>
          Import {validRows.length} employee{validRows.length === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  );
}
