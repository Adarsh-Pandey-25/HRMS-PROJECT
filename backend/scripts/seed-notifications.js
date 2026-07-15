/**
 * Seed sample in-app notifications for UI / API testing.
 * Usage: node scripts/seed-notifications.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const SAMPLES = [
  {
    email: 'hr1@company.com',
    rows: [
      { type: 'LEAVE', title: 'Leave request pending approval', message: 'Neha Gupta applied for leave (CL) from 2026-07-20 to 2026-07-22.', link: '/leave/team', is_read: false },
      { type: 'REIMBURSEMENT', title: 'Reimbursement submitted', message: 'A reimbursement claim was submitted and needs review.', link: '/expenses/all', is_read: false },
      { type: 'DOCUMENT', title: 'Document pending verification', message: 'A document (AADHAAR) was uploaded and needs verification.', link: '/employees', is_read: true },
    ],
  },
  {
    email: 'neha.gupta@company.com',
    rows: [
      { type: 'LEAVE', title: 'Leave approved', message: 'Your leave request (CL) has been approved.', link: '/leave/me', is_read: false },
      { type: 'PAYROLL', title: 'Payslip published', message: 'Your payslip for July 2026 is now available.', link: '/payroll/me', is_read: false },
      { type: 'REIMBURSEMENT', title: 'Reimbursement approved', message: 'Your reimbursement claim was approved.', link: '/expenses/me', is_read: true },
    ],
  },
  {
    email: 'admin@company.com',
    rows: [
      { type: 'LEAVE', title: 'Leave needs HR approval', message: 'Manager approved a leave request (SL). Please review and approve/reject.', link: '/leave/approvals', is_read: false },
    ],
  },
];

async function main() {
  console.log('Seeding notifications...\n');

  let inserted = 0;
  for (const group of SAMPLES) {
    const { data: emp, error: empErr } = await supabase
      .from('employees')
      .select('id, first_name, last_name, email')
      .eq('email', group.email)
      .maybeSingle();

    if (empErr) throw empErr;
    if (!emp) {
      console.warn(`  skip ${group.email} (not found)`);
      continue;
    }

    for (const row of group.rows) {
      const { error } = await supabase.from('notifications').insert({
        user_id: emp.id,
        type: row.type,
        title: row.title,
        message: row.message,
        link: row.link,
        meta: row.meta || {},
        is_read: row.is_read,
      });
      if (error) throw error;
      inserted++;
    }
    console.log(`  + ${group.rows.length} for ${emp.first_name} ${emp.last_name} (${emp.email})`);
  }

  console.log(`\nDone. Inserted ${inserted} notification(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
