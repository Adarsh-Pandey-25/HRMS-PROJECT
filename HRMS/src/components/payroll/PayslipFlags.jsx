import { Badge } from '../ui';
import { payslipFlags } from '../../lib/payslipView';

/**
 * A salary sheet row's flags: deductions held back by the limit on total
 * deductions (or a final payslip over it), and TDS at 20% without a PAN.
 * The badge's tooltip says what happened, in the payslip's words.
 */
export function PayslipFlags({ payslip }) {
  const flags = payslipFlags(payslip);
  if (!flags.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span key={f.key} title={f.title}>
          <Badge tone={f.tone}>{f.label}</Badge>
        </span>
      ))}
    </span>
  );
}
