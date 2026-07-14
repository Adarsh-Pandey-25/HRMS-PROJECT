/**
 * Reopen published payslips for a month, recalculate drafts, and republish.
 * Usage: node scripts/recalc-month-payslips.js [month] [year]
 * Default: July 2026
 */
require('dotenv').config();
const { supabaseAdmin } = require('../src/config/supabase');
const payrollService = require('../src/services/payroll.service');

const month = parseInt(process.argv[2] || '7', 10);
const year = parseInt(process.argv[3] || '2026', 10);

async function main() {
  const { data: pm, error: pmErr } = await supabaseAdmin
    .from('payroll_months')
    .select('*')
    .eq('month', month)
    .eq('year', year)
    .maybeSingle();
  if (pmErr) throw pmErr;
  if (!pm) throw new Error(`No payroll_months row for ${month}/${year}`);

  const { data: admin } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('email', 'admin@company.com')
    .maybeSingle();
  const publisherId = admin?.id || pm.created_by;

  const { data: reopened, error: reErr } = await supabaseAdmin
    .from('payroll')
    .update({ payslip_status: 'DRAFT', updated_at: new Date().toISOString() })
    .eq('month', month)
    .eq('year', year)
    .eq('payslip_status', 'PUBLISHED')
    .select('id, employee_id');
  if (reErr) throw reErr;
  console.log(`Reopened ${reopened?.length || 0} published slips → DRAFT`);

  await supabaseAdmin
    .from('payroll_months')
    .update({ status: 'PENDING' })
    .eq('id', pm.id);

  const gen = await payrollService.generateAllDraftPayslips(pm.id);
  const ok = gen.filter((g) => g.status === 'generated');
  const skip = gen.filter((g) => g.status !== 'generated');
  console.log(`Recalculated: ${ok.length}; skipped: ${skip.length}`);
  skip.forEach((g) => console.log('  skip', g.user_id, g.reason));
  ok.forEach((g) => {
    const p = g.payslip;
    console.log(
      `  ${p.first_name} ${p.last_name}: gross=${p.gross_salary} net=${p.net_salary || p.net_pay} lop=${p.lop_deduction}`
    );
  });

  let published = 0;
  for (const g of ok) {
    if (!g.payslip?.id) continue;
    try {
      await payrollService.publishPayslip(g.payslip.id, publisherId);
      published += 1;
    } catch (err) {
      console.log('  publish fail', g.payslip.id, err.message);
    }
  }
  console.log(`Published ${published} payslips for ${month}/${year}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
