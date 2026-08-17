import * as XLSX from 'xlsx';
import { getEmployee } from '../data';
import { formatDate } from './utils';

/** Builds and downloads a real, formatted .xlsx salary sheet for a payroll run. */
export function exportSalarySheetXlsx(sheet, month) {
  const rows = sheet.map((p) => {
    const e = getEmployee(p.employeeId);
    return {
      'Employee ID': p.employeeId,
      'Name': e?.name || '—',
      'Department': e?.department || '—',
      'Days Worked': `${p.daysWorked}/${p.daysInMonth}`,
      'Basic': p.earnings.basic,
      'HRA': p.earnings.hra,
      'DA': p.earnings.da,
      'Special Allowance': p.earnings.specialAllowance,
      'Incentive': p.earnings.incentive,
      'Gross': p.earnings.gross,
      'PF': p.deductions.pf,
      'ESI': p.deductions.esic,
      'Professional Tax': p.deductions.pt,
      'TDS': p.deductions.tds,
      'Total Deductions': p.deductions.total,
      'Net Pay': p.netPay,
    };
  });

  const totalsRow = {
    'Employee ID': '', 'Name': 'TOTAL', 'Department': '', 'Days Worked': '',
    'Basic': rows.reduce((a, r) => a + r.Basic, 0),
    'HRA': rows.reduce((a, r) => a + r.HRA, 0),
    'DA': rows.reduce((a, r) => a + r.DA, 0),
    'Special Allowance': rows.reduce((a, r) => a + r['Special Allowance'], 0),
    'Incentive': rows.reduce((a, r) => a + r.Incentive, 0),
    'Gross': rows.reduce((a, r) => a + r.Gross, 0),
    'PF': rows.reduce((a, r) => a + r.PF, 0),
    'ESI': rows.reduce((a, r) => a + r.ESI, 0),
    'Professional Tax': rows.reduce((a, r) => a + r['Professional Tax'], 0),
    'TDS': rows.reduce((a, r) => a + r.TDS, 0),
    'Total Deductions': rows.reduce((a, r) => a + r['Total Deductions'], 0),
    'Net Pay': rows.reduce((a, r) => a + r['Net Pay'], 0),
  };

  const worksheet = XLSX.utils.json_to_sheet([...rows, totalsRow]);
  worksheet['!cols'] = [
    { wch: 14 }, { wch: 22 }, { wch: 16 }, { wch: 11 },
    { wch: 11 }, { wch: 10 }, { wch: 9 }, { wch: 16 }, { wch: 10 }, { wch: 12 },
    { wch: 10 }, { wch: 9 }, { wch: 12 }, { wch: 10 }, { wch: 15 }, { wch: 12 },
  ];

  const workbook = XLSX.utils.book_new();
  const sheetLabel = formatDate(`${month}-01`, 'MMMM yyyy');
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetLabel.slice(0, 31));
  XLSX.writeFile(workbook, `salary-sheet-${month}.xlsx`);
}
