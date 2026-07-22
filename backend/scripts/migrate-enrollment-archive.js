/**
 * Adds is_archived to course_enrollments. Safe to run multiple times.
 * Usage: node scripts/migrate-enrollment-archive.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../src/config/supabase');

async function main() {
  const { error: probeErr } = await supabaseAdmin
    .from('course_enrollments')
    .select('is_archived')
    .limit(1);

  if (!probeErr) {
    console.log('course_enrollments.is_archived already exists.');
    return;
  }

  if (!String(probeErr.message || '').includes('is_archived')) {
    console.error('Unexpected error probing course_enrollments:', probeErr.message);
    process.exit(1);
  }

  console.log('Column is_archived is missing. Run this SQL in Supabase SQL editor:\n');
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260720_course_enrollment_archive.sql'),
    'utf8',
  );
  console.log(sql);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
