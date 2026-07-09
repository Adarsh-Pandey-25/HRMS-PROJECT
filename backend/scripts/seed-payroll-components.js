require('dotenv').config();
const { supabaseAdmin } = require('../src/config/supabase');

async function main() {
  console.log('No default payroll components are seeded anymore.');
  console.log('Please configure Salary Structure from Admin → Settings → Salary Structure.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

