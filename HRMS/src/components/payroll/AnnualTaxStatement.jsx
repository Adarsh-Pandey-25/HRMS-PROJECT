import { formatCurrency } from '../../lib/utils';

const Row = ({ label, value, strong, minus }) => (
  <tr className="border-b border-border/60">
    <td className={strong ? 'py-1.5 font-semibold text-fg' : 'py-1.5 text-fg-muted'}>{label}</td>
    <td className={strong ? 'py-1.5 text-right font-semibold tabular-nums text-fg' : 'py-1.5 text-right tabular-nums text-fg'}>
      {minus && Number(value) > 0 ? '− ' : ''}{formatCurrency(value || 0)}
    </td>
  </tr>
);

/**
 * An employee's salary and tax for a tax year on what was actually paid —
 * the figures behind their annual TDS certificate (Form 130 Part B,
 * formerly Form 16). `s` is the API's annual tax statement.
 */
export function AnnualTaxStatement({ s }) {
  if (!s) return null;
  const old = s.regime === 'old';
  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-fg-subtle">
        {s.employee.name}{s.employee.code ? ` (${s.employee.code})` : ''} · PAN {s.employee.pan || 'not recorded'} · {old ? 'old' : 'new'} regime ·
        {' '}{s.months} published payslip{s.months === 1 ? '' : 's'} in {s.taxYear}
        {s.draftsNotCounted > 0 ? ` (${s.draftsNotCounted} draft${s.draftsNotCounted === 1 ? '' : 's'} not counted)` : ''}
      </p>
      <table className="w-full">
        <tbody>
          <Row label="Salary paid here" value={s.salary.paidHere} />
          {s.salary.previousEmployer > 0 && <Row label="Salary from a previous employer" value={s.salary.previousEmployer} />}
          {s.salary.outsideSpaxSync > 0 && <Row label="Salary paid outside SpaxSync" value={s.salary.outsideSpaxSync} />}
          <Row label="Gross salary" value={s.salary.total} strong />
          {old && <Row label="Exempt allowances (HRA, LTA)" value={s.exemptions} minus />}
          <Row label="Standard deduction" value={s.standardDeduction} minus />
          {old && <Row label="Professional Tax" value={s.professionalTax} minus />}
          <Row label="Income from salary" value={s.incomeFromSalary} strong />
          {s.otherIncome > 0 && <Row label="Other income declared" value={s.otherIncome} />}
          {old && <Row label="Chapter VIII deductions (80C-type etc.)" value={s.chapter8Deductions} minus />}
          {old && s.otherDeductions > 0 && <Row label="Other deductions" value={s.otherDeductions} minus />}
          <Row label="Taxable income (to ₹10)" value={s.taxableIncome} strong />
          <Row label="Tax on it" value={s.tax.onIncome} />
          {s.tax.rebate > 0 && <Row label="Rebate" value={s.tax.rebate} minus />}
          {s.tax.surcharge > 0 && <Row label="Surcharge" value={s.tax.surcharge} />}
          <Row label="Health and education cess (4%)" value={s.tax.cess} />
          <Row label="Tax for the year (to ₹10)" value={s.tax.total} strong />
        </tbody>
      </table>
      <table className="w-full">
        <tbody>
          {s.tds.byQuarter.map((q) => <Row key={q.quarter} label={`TDS deducted here — ${q.quarter}`} value={q.amount} />)}
          {s.tds.previousEmployer > 0 && <Row label="TDS by the previous employer" value={s.tds.previousEmployer} />}
          {s.tds.outsideSpaxSync > 0 && <Row label="TDS on salary paid outside SpaxSync" value={s.tds.outsideSpaxSync} />}
          <Row label="Total TDS" value={s.tds.total} strong />
        </tbody>
      </table>
      <p className={s.balance > 0 ? 'rounded-xl bg-warning/10 px-3 py-2 text-xs text-fg' : 'rounded-xl bg-success/10 px-3 py-2 text-xs text-fg'}>
        {s.balance > 0
          ? `${formatCurrency(s.balance)} of the year's tax is not yet deducted.`
          : s.balance < 0
            ? `${formatCurrency(-s.balance)} more was deducted than the year's tax so far — it is adjusted in the coming months or refunded through the income-tax return.`
            : 'TDS deducted equals the year\'s tax.'}
      </p>
      <p className="text-[11px] text-fg-subtle">
        These are the figures for the annual TDS certificate (Form 130 Part B, formerly Form 16); the certificate itself is
        issued by your company&apos;s accountant, with Part A from the TDS portal.
      </p>
    </div>
  );
}
