/**
 * Training v2 schema check. Run SQL in Supabase if tables are missing.
 * Usage: node scripts/migrate-training-v2.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../src/config/supabase');

async function main() {
  const { error } = await supabaseAdmin.from('courses').select('id').limit(1);
  if (!error) {
    console.log('courses table already exists — migration not needed.');
    return;
  }

  console.log('Training v2 tables not found. Run this SQL in Supabase SQL editor:\n');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'training_v2.sql'), 'utf8');
  console.log(sql);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
