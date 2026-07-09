/**
 * Applies payroll v2 schema changes via Supabase REST (run once).
 * Usage: node scripts/migrate-payroll-v2.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(url, key);

  // Check if payroll_months exists
  const { error: checkErr } = await supabase.from('payroll_months').select('id').limit(1);
  if (!checkErr) {
    console.log('payroll_months table already exists — skipping migration.');
    return;
  }

  console.log('Please run backend/supabase/payroll_v2.sql in the Supabase SQL editor.');
  console.log('File path:', path.join(__dirname, '..', 'supabase', 'payroll_v2.sql'));
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'payroll_v2.sql'), 'utf8');
  console.log('\n--- SQL to run ---\n');
  console.log(sql);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
