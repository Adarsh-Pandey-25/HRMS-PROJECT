/**
 * Reset all employee passwords to: "{FirstName}{LastName}@123"
 * Run: node scripts/reset-all-passwords.js
 */
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const { generateDefaultPassword } = require('../src/utils/helpers');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const resetAllPasswords = async () => {
  const { data: employees, error } = await supabase
    .from('employees')
    .select('id, email, first_name, last_name');

  if (error) {
    console.error('Failed to fetch employees:', error.message);
    process.exit(1);
  }

  console.log(`Resetting passwords for ${employees.length} employees...\n`);

  for (const emp of employees) {
    const password = generateDefaultPassword(emp.first_name, emp.last_name);
    const passwordHash = await bcrypt.hash(password, 10);

    const { error: updateError } = await supabase
      .from('employees')
      .update({ password_hash: passwordHash })
      .eq('id', emp.id);

    if (updateError) {
      console.error(`Failed: ${emp.email} — ${updateError.message}`);
    } else {
      console.log(`${emp.email} → ${password}`);
    }
  }

  await supabase.from('refresh_tokens').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  console.log('\nDone. All users must log in again.');
};

resetAllPasswords();
