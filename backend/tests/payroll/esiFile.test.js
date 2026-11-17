/**
 * ESIC's monthly contribution file: who is in it, the wages ESI was worked
 * out on, ESIC's reason codes and last working day, people left out — and
 * the Excel 97-2003 file the browser writes from the rows. Payslips are made
 * by the real calculation (computePayslip). The database is a stand-in that
 * applies the eq / in filters and records every query, so company scoping
 * is checked. Read-only.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const builder = (table) => {
    const filters = [];
    let columns = '';
    let range = null;
    const q = {};
    q.select = (cols) => { columns = String(cols || ''); return q; };
    q.eq = (col, val) => { filters.push({ op: 'eq', col, val }); return q; };
    q.in = (col, vals) => { filters.push({ op: 'in', col, val: vals }); return q; };
    q.order = () => q;
    q.range = (from, to) => { range = [from, to]; return q; };
    q.then = (resolve, reject) => {
      global.__queries.push({ table, columns, filters: [...filters] });
      if (global.__noLastWorkingDayColumn && table === 'employees' && columns.includes('last_working_day')) {
        return Promise.resolve({ data: null, error: { message: 'column employees.last_working_day does not exist' } }).then(resolve, reject);
      }
      let rows = (global.__mockTables[table] || []).filter((r) => filters.every((f) => (f.op === 'eq'
        ? String(r[f.col]) === String(f.val)
        : f.val.map(String).includes(String(r[f.col])))));
      if (range) rows = rows.slice(range[0], range[1] + 1);
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    };
    return q;
  };
  return { supabaseAdmin: { from: (t) => builder(t) } };
});
jest.mock('../../src/services/email.service', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()),
}));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const payroll = require('../../src/services/payroll.service');
const { normalizePayrollRules } = require('../../src/utils/payrollRules');
const { normalizeWorkWeek } = require('../../src/utils/workWeek');
const { getEsiFile, esiWagesOf } = require('../../src/services/statutoryFiles.service');

const ctx = {
  companyId: 'c1',
  workingDaysSetting: 26,
  payrollConfig: {},
  pfPolicy: 'statutory_ceiling',
  esiApplicable: true,
  tdsPolicy: 'fixed_per_employee',
  ptState: 'Karnataka',
  ptManualAmount: null,
  ptManualSlabs: null,
  ptStateUnconfirmed: false,
  choicesMade: {},
  rules: normalizePayrollRules({}),
  workWeek: normalizeWorkWeek(null),
  leaveFirst: false,
  components: [],
};

// ₹18,000 a month: under ESI's ₹21,000 limit.
const covered = { basic: 9000, hra: 3600, special: 5400 };
const R = (rupees) => Math.round(rupees * 100);
const oneTime = (id, kind, name, rupees, esiWage) => ({
  id, kind, name, earning: true, amount: R(rupees), taxable: true, pfWage: false, esiWage,
});

const slip = ({
  id, employeeId, month, year = 2026, salary = covered, summary = { workingDays: 22 }, items = null, status = 'PUBLISHED', companyId = 'c1',
}) => {
  const out = payroll.computePayslip(ctx, {
    employee: { id: employeeId, gender: 'male', salary_details: salary }, summary, records: [], month, year, oneTime: items,
  });
  return {
    id,
    employee_id: employeeId,
    company_id: companyId,
    month,
    year,
    payslip_status: status,
    gross_salary: out.gross_salary,
    breakdown_json: out.breakdown_json,
  };
};

const person = (id, first, ip, extra = {}) => ({
  id,
  company_id: 'c1',
  first_name: first,
  last_name: 'K',
  employee_code: id.toUpperCase(),
  salary_details: { statutory_ids: { esic_ip: ip } },
  is_active: true,
  ...extra,
});

// A payslip from before the ESI wages and days were stored (made in early November 2026).
const older = (s) => {
  const { esi_wages: _w, esi_paid_days: _d, ...config } = s.breakdown_json.config;
  return { ...s, breakdown_json: { ...s.breakdown_json, config } };
};

let oldStyle;
let withExtras;
beforeAll(() => {
  withExtras = slip({
    id: 'oct-e1',
    employeeId: 'e1',
    month: 10,
    items: [
      oneTime('b1', 'bonus', 'Bonus', 5000, false),
      oneTime('l1', 'leave_encashment', 'Leave encashment', 2000, false),
      oneTime('i1', 'incentive', 'Incentive', 1000, true),
    ],
  });
  const absentTwo = slip({
    id: 'oct-e14', employeeId: 'e14', month: 10, summary: { workingDays: 22, absent: 2 }, items: [oneTime('b2', 'bonus', 'Bonus', 4000, false), oneTime('i2', 'incentive', 'Incentive', 500, true)],
  });
  oldStyle = { stored: absentTwo, old: older(absentTwo) };
  global.__queries = [];
  global.__mockTables = {
    payroll: [
      // ── September (last month) ──
      slip({ id: 'sep-e2', employeeId: 'e2', month: 9 }),
      slip({ id: 'sep-e3', employeeId: 'e3', month: 9 }),
      slip({ id: 'sep-e4', employeeId: 'e4', month: 9 }),
      slip({ id: 'sep-e10', employeeId: 'e10', month: 9 }),
      // Left on 1 September, nothing paid that month: ESIC was told then.
      slip({
        id: 'sep-e11', employeeId: 'e11', month: 9, summary: { workingDays: 22, leftOn: '2026-09-01', afterLeaving: 21, absent: 1 },
      }),
      // Left on 30 September after a full month: shown then with reason 0.
      slip({
        id: 'sep-e12', employeeId: 'e12', month: 9, summary: { workingDays: 22, leftOn: '2026-09-30' },
      }),
      slip({ id: 'sep-e13', employeeId: 'e13', month: 9 }),
      // ── October (the file's month) ──
      withExtras,
      // Leaving on 15 October, paid for 1–15 October.
      slip({
        id: 'oct-e2', employeeId: 'e2', month: 10, summary: { workingDays: 22, leftOn: '2026-10-15', afterLeaving: 11 },
      }),
      // Left on 2 October, absent both days: nothing paid.
      slip({
        id: 'oct-e3', employeeId: 'e3', month: 10, summary: { workingDays: 22, leftOn: '2026-10-02', afterLeaving: 20, absent: 2 },
      }),
      // e4: left on 3 October; no October payslip.
      // Absent the whole month: covered, no days, no wages.
      slip({
        id: 'oct-e5', employeeId: 'e5', month: 10, summary: { workingDays: 22, absent: 22 },
      }),
      // An IP number that isn't 10 digits.
      slip({ id: 'oct-e6', employeeId: 'e6', month: 10 }),
      // ₹40,000: above the limit, not covered.
      slip({
        id: 'oct-e7', employeeId: 'e7', month: 10, salary: { basic: 22000, hra: 8800, special: 9200 },
      }),
      // Another company's covered employee, same month.
      slip({
        id: 'oct-x1', employeeId: 'x1', month: 10, companyId: 'c2',
      }),
      // October's payslip still a draft.
      slip({
        id: 'oct-e9', employeeId: 'e9', month: 10, status: 'DRAFT',
      }),
      // e10: covered in September, no October payslip, still employed.
      // e13: covered in September; a raise to ₹30,000 takes them out in October.
      slip({
        id: 'oct-e13', employeeId: 'e13', month: 10, salary: { basic: 15000, hra: 6000, special: 9000 },
      }),
      oldStyle.old,
      // ── November: e2's full and final, after they left on 15 October ──
      slip({
        id: 'nov-e2',
        employeeId: 'e2',
        month: 11,
        summary: { workingDays: 21, leftOn: '2026-10-15', afterLeaving: 21 },
        items: [oneTime('g1', 'gratuity', 'Gratuity', 30000, false), oneTime('l2', 'leave_encashment', 'Leave encashment', 6000, false)],
      }),
    ],
    employees: [
      person('e1', 'Asha', '3100000001'),
      person('e2', 'Ravi', '3100000002', { last_working_day: '2026-10-15' }),
      person('e3', 'Meena', '3100000003', { last_working_day: '2026-10-02' }),
      person('e4', 'Kiran', '3100000004', { last_working_day: '2026-10-03', employment_status: 'offboarded', offboarded_at: '2026-10-03T06:00:00Z' }),
      person('e5', 'Lata', '3100000005'),
      person('e6', 'Sunil', '12345'),
      person('e7', 'Vikram', '3100000007'),
      person('e9', 'Divya', '3100000009'),
      person('e10', 'Nisha', '3100000010'),
      person('e11', 'Arjun', '3100000011', { last_working_day: '2026-09-01' }),
      person('e12', "D'Souza", '3100000012', { last_working_day: '2026-09-30' }),
      person('e13', 'Farhan', '3100000013'),
      person('e14', 'Gita', '3100000014'),
      { ...person('x1', 'Other', '3100000099'), company_id: 'c2' },
    ],
  };
});
afterAll(() => {
  delete global.__mockTables;
  delete global.__queries;
});

const cells = (f) => f.rows.map((r) => [r.ipNumber, r.ipName, r.days, r.wages, r.reasonCode, r.lastWorkingDay]);
const rowOf = (f, employeeId) => {
  const r = f.rows.find((x) => x.employeeId === employeeId);
  return r && [r.ipNumber, r.ipName, r.days, r.wages, r.reasonCode, r.lastWorkingDay];
};

describe('ESI contribution file, October 2026', () => {
  let f;
  beforeAll(async () => {
    global.__queries = [];
    f = await getEsiFile('c1', 10, 2026);
  });

  test('the payslip stores the wages ESI was worked out on: regular pay + incentive, not the bonus or encashment', () => {
    expect(withExtras.gross_salary).toBe(26000);
    expect(withExtras.breakdown_json.config.esi_wages).toBe(19000);
    expect(withExtras.breakdown_json.config.esi_paid_days).toBe(31);
  });

  test('wages column: the stored ESI wages, not the gross with bonus and leave encashment', () => {
    // 31 calendar days paid; ₹18,000 + ₹1,000 incentive (gross ₹26,000)
    expect(rowOf(f, 'e1')).toEqual(['3100000001', 'Asha K', '31', '19000', '0', '']);
  });

  test('a leaver paid for days this month: the days and reason 0 — ESIC takes a reason only for a month without days', () => {
    // 1–15 October: 15 calendar days; 11 of 22 working days → ₹9,000
    expect(rowOf(f, 'e2')).toEqual(['3100000002', 'Ravi K', '15', '9000', '0', '']);
  });

  test('left this month with nothing paid: reason 2 and the last working day, dd/mm/yyyy', () => {
    expect(rowOf(f, 'e3')).toEqual(['3100000003', 'Meena K', '0', '0', '2', '02/10/2026']);
  });

  test('left this month with no payslip at all: still in the file, reason 2', () => {
    expect(rowOf(f, 'e4')).toEqual(['3100000004', 'Kiran K', '0', '0', '2', '03/10/2026']);
  });

  test('left last month after a paid month: reason 2 now, with that last working day; letters and spaces only in the name', () => {
    expect(rowOf(f, 'e12')).toEqual(['3100000012', 'D Souza K', '0', '0', '2', '30/09/2026']);
  });

  test('left last month with nothing paid then: already reported as left, not repeated', () => {
    expect(rowOf(f, 'e11')).toBeUndefined();
  });

  test('covered, absent all month: in the file with 0 days, 0 wages and reason 1 (on leave)', () => {
    const config = global.__mockTables.payroll.find((s) => s.id === 'oct-e5').breakdown_json.config;
    expect(config).toMatchObject({ esi_eligible: true, paid_days: 0, esi_wages: 0 });
    // No pay at all, so no days — the weekly offs weren't paid for either.
    expect(rowOf(f, 'e5')).toEqual(['3100000005', 'Lata K', '0', '0', '1', '']);
  });

  test('covered last month and no payslip this month: reason 1, and HR is asked to check', () => {
    expect(rowOf(f, 'e10')).toEqual(['3100000010', 'Nisha K', '0', '0', '1', '']);
    expect(f.review).toContainEqual({ employeeId: 'e10', name: 'Nisha K', message: expect.stringMatching(/No published payslip this month.*reason 1/) });
  });

  test('a malformed IP number: listed for HR, not in the file', () => {
    expect(rowOf(f, 'e6')).toBeUndefined();
    expect(f.missingIp).toEqual([{ employeeId: 'e6', name: 'Sunil K', ipNumber: '12345', reason: 'IP number 12345 isn\'t 10 digits' }]);
  });

  test('a draft payslip: listed as not published, not in the file', () => {
    expect(rowOf(f, 'e9')).toBeUndefined();
    expect(f.notPublished).toEqual([{ employeeId: 'e9', name: 'Divya K', reason: 'This month\'s payslip isn\'t published yet' }]);
  });

  test('not covered (above ₹21,000): not in the file; out of cover since last month: flagged for HR', () => {
    expect(rowOf(f, 'e7')).toBeUndefined();
    expect(rowOf(f, 'e13')).toBeUndefined();
    expect(f.review).toContainEqual({ employeeId: 'e13', name: 'Farhan K', message: expect.stringMatching(/last month but not this month/) });
  });

  test('a payslip from before ESI wages were stored: worked out again from its breakdown', () => {
    const stored = oldStyle.stored.breakdown_json.config;
    // ₹18,000 × 20/22 earned + ₹500 incentive (the ₹4,000 bonus isn't ESI wages)
    expect(esiWagesOf(oldStyle.old)).toBe(Math.round(stored.esi_wages * 100));
    expect(stored.esi_wages).toBe(16864);
    // 31 days × 20/22 = 28.2 → 29 (ESIC: rounded up to a whole day)
    expect(rowOf(f, 'e14')).toEqual(['3100000014', 'Gita K', '29', '16864', '0', '']);
  });

  test('only this company: every query is scoped, and the other company\'s employee is not in the file', () => {
    expect(f.rows.map((r) => r.employeeId)).not.toContain('x1');
    const scoped = global.__queries.filter((q) => ['payroll', 'employees'].includes(q.table));
    expect(scoped.length).toBeGreaterThanOrEqual(3);
    for (const q of scoped) expect(q.filters).toContainEqual({ op: 'eq', col: 'company_id', val: 'c1' });
  });

  test('the response: header, rows in employee-code order, totals', () => {
    expect(f.filename).toBe('esi-contribution-2026-10.xls');
    expect(f.header).toEqual(['IP Number', 'IP Name', 'No of Days for which wages paid/payable during the month', 'Total Monthly Wages', 'Reason Code for Zero workings days', 'Last Working Day']);
    expect(f.rows.map((r) => r.employeeId)).toEqual(['e1', 'e10', 'e12', 'e14', 'e2', 'e3', 'e4', 'e5']);
    expect(f.members).toBe(8);
    expect(f.totalWages).toBe(cells(f).reduce((a, r) => a + Number(r[3]), 0));
    for (const r of cells(f)) for (const v of r) expect(typeof v).toBe('string');
  });
});

test('November: the full and final payslip after leaving adds no wages; the leaver is reported as left', async () => {
  const f = await getEsiFile('c1', 11, 2026);
  // Gratuity ₹30,000 and leave encashment ₹6,000 aren't ESI wages.
  const settlement = global.__mockTables.payroll.find((s) => s.id === 'nov-e2');
  expect(settlement.gross_salary).toBe(36000);
  expect(settlement.breakdown_json.config.esi_wages).toBe(0);
  expect(rowOf(f, 'e2')).toEqual(['3100000002', 'Ravi K', '0', '0', '2', '15/10/2026']);
  expect(f.review.map((r) => r.employeeId)).not.toContain('e2');
  // October's left-with-nothing-paid (e3, e4) were reported in October; not again.
  expect(rowOf(f, 'e3')).toBeUndefined();
  expect(rowOf(f, 'e4')).toBeUndefined();
  // Covered in October with no November payslip in this fixture: reason 1, flagged.
  expect(rowOf(f, 'e1')).toEqual(['3100000001', 'Asha K', '0', '0', '1', '']);
  expect(f.review.map((r) => r.employeeId)).toContain('e1');
});

test('before the last-working-day column exists: the offboarding date stands in', async () => {
  global.__noLastWorkingDayColumn = true;
  try {
    const f = await getEsiFile('c1', 10, 2026);
    expect(rowOf(f, 'e4')).toEqual(['3100000004', 'Kiran K', '0', '0', '2', '03/10/2026']);
  } finally {
    delete global.__noLastWorkingDayColumn;
  }
});

test('month and year are checked', async () => {
  await expect(getEsiFile('c1', 13, 2026)).rejects.toThrow(/month and year/);
  await expect(getEsiFile(null, 10, 2026)).rejects.toThrow(/companyId/);
});

// ── The browser's .xls (HRMS/src/lib/esiFile.js), run in Node with the app's SheetJS ──
const HRMS = path.resolve(__dirname, '../../../HRMS');
const hasSheetJs = fs.existsSync(path.join(HRMS, 'node_modules/xlsx/package.json'));
const writeAndRead = (file) => {
  const script = `
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    import { readFileSync } from 'node:fs';
    const hrms = process.argv[1];
    const XLSX = createRequire(hrms + '/package.json')('xlsx');
    const { esiWorkbookBytes } = await import(pathToFileURL(hrms + '/src/lib/esiFile.js').href);
    const bytes = Buffer.from(esiWorkbookBytes(XLSX, JSON.parse(readFileSync(0, 'utf8'))));
    // Each cell record in the BIFF8 stream and its number format (Excel's 49 = "@", Text).
    const stream = Buffer.from(XLSX.CFB.find(XLSX.CFB.read(bytes, { type: 'buffer' }), 'Workbook').content);
    const formats = [];
    const records = [];
    for (let off = 0; off + 4 <= stream.length;) {
      const type = stream.readUInt16LE(off);
      const len = stream.readUInt16LE(off + 2);
      const body = stream.subarray(off + 4, off + 4 + len);
      if (type === 0x00e0) formats.push(body.readUInt16LE(2));
      if ([0x00fd, 0x0204, 0x0201, 0x0203, 0x027e].includes(type)) {
        records.push({ kind: { 0x00fd: 'text', 0x0204: 'text', 0x0201: 'blank', 0x0203: 'number', 0x027e: 'number' }[type], r: body.readUInt16LE(0), c: body.readUInt16LE(2), xf: body.readUInt16LE(4) });
      }
      off += 4 + len;
    }
    const wb = XLSX.read(bytes, { type: 'buffer', cellNF: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const values = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    process.stdout.write(JSON.stringify({
      magic: bytes.subarray(0, 8).toString('hex'),
      sheets: wb.SheetNames,
      values,
      types: values.map((line, r) => line.map((_, c) => ws[XLSX.utils.encode_cell({ r, c })]?.t || null)),
      cells: records.map((x) => ({ kind: x.kind, r: x.r, c: x.c, format: formats[x.xf] })),
    }));
  `;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, HRMS], { input: JSON.stringify(file), encoding: 'utf8' }));
};

(hasSheetJs ? test : test.skip)('the .xls: Excel 97-2003 (BIFF8), header + rows in ESIC\'s order, every cell text', async () => {
  const f = await getEsiFile('c1', 10, 2026);
  const out = writeAndRead(f);
  // An OLE compound file (.xls), not a zip (.xlsx) or text.
  expect(out.magic).toBe('d0cf11e0a1b11ae1');
  expect(out.sheets).toEqual(['Sheet1']);
  expect(out.values[0]).toEqual(f.header);
  expect(out.values.slice(1)).toEqual(cells(f).map((r) => r.map((v) => (v === '' ? null : v))));
  // A leading-zero-safe IP number and a date stay strings.
  expect(out.types.slice(1).every((line) => line.every((t) => t === 's' || t === null))).toBe(true);
  // Every cell written is text-formatted; numbers never appear; an empty last working day is a blank text cell.
  expect(out.cells.length).toBe(6 * (f.rows.length + 1));
  expect(out.cells.every((x) => x.format === 49)).toBe(true);
  expect(out.cells.some((x) => x.kind === 'number')).toBe(false);
  expect(out.cells.filter((x) => x.kind === 'blank').map((x) => x.c)).toEqual(Array(f.rows.filter((r) => !r.lastWorkingDay).length).fill(5));
});
