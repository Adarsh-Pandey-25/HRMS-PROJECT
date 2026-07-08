/**
 * Seed a few "out today" approved leaves so the admin dashboard isn't empty.
 * Run: node scripts/seed-out-today.js
 */
require('dotenv').config();
const moment = require('moment-timezone');
const { createClient } = require('@supabase/supabase-js');
const { TIMEZONE } = require('../src/utils/constants');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function main() {
  const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');

  const { data: admin } = await supabase.from('employees').select('id').eq('role', 'admin').limit(1).single();
  const { data: hr } = await supabase.from('employees').select('id').eq('role', 'hr').limit(1).single();
  const adminId = admin?.id;
  const hrId = hr?.id || adminId;
  if (!adminId) {
    console.error('No admin found. Run: node scripts/seed-admin.js');
    process.exit(1);
  }

  // Pick some active employees that have a manager set (for manager→HR workflow).
  const { data: employees, error: empErr } = await supabase
    .from('employees')
    .select('id, first_name, last_name, manager_id')
    .eq('role', 'employee')
    .eq('is_active', true)
    .not('manager_id', 'is', null)
    .limit(20);

  if (empErr) throw empErr;
  if (!employees?.length) {
    console.log('No employees with manager found; skipping.');
    return;
  }

  const targets = employees.sort(() => 0.5 - Math.random()).slice(0, 3);
  const leaveTypes = ['EL', 'SL', 'SL'];
  const durations = [2, 1, 3];

  console.log(`Seeding "out today" leaves for ${today}...`);

  for (let i = 0; i < targets.length; i++) {
    const emp = targets[i];
    const leaveType = leaveTypes[i] || pick(['EL', 'SL', 'CL']);
    const days = durations[i] || 1;
    const from = moment(today).subtract(0, 'days').format('YYYY-MM-DD');
    const to = moment(today).add(days - 1, 'days').format('YYYY-MM-DD');

    // Avoid duplicates for same employee overlapping today.
    const { data: existing } = await supabase
      .from('leaves')
      .select('id')
      .eq('employee_id', emp.id)
      .eq('status', 'approved')
      .lte('from_date', today)
      .gte('to_date', today)
      .limit(1);

    if (existing?.length) {
      console.log(`  = Already out today: ${emp.first_name} ${emp.last_name}`);
      continue;
    }

    const { error } = await supabase.from('leaves').insert({
      employee_id: emp.id,
      leave_type: leaveType,
      from_date: from,
      to_date: to,
      total_days: days,
      is_half_day: false,
      reason: leaveType === 'SL' ? 'Not feeling well' : 'Planned leave',
      status: 'approved',
      manager_approved_by: emp.manager_id,
      manager_approved_at: new Date().toISOString(),
      approved_by: hrId,
      approved_at: new Date().toISOString(),
    });

    if (error) {
      console.error(`  ! Failed for ${emp.first_name} ${emp.last_name}: ${error.message}`);
    } else {
      console.log(`  + ${emp.first_name} ${emp.last_name} (${leaveType}) ${from} → ${to}`);
    }
  }

  console.log('Done.');
}

main().catch((e) => {
  console.error('Seed failed:', e.message || e);
  process.exit(1);
});

