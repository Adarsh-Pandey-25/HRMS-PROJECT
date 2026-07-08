const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const { generateDefaultPassword } = require('../src/utils/helpers');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const seedAdmin = async () => {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@company.com';
  const firstName = 'System';
  const lastName = 'Admin';
  const password = generateDefaultPassword(firstName, lastName);
  const passwordHash = await bcrypt.hash(password, 10);

  const { data: existing } = await supabase
    .from('employees')
    .select('id')
    .eq('email', email)
    .single();

  if (existing) {
    await supabase
      .from('employees')
      .update({ password_hash: passwordHash })
      .eq('id', existing.id);
    console.log('Admin already exists — password reset to:', password);
    return;
  }

  const { data, error } = await supabase
    .from('employees')
    .insert({
      employee_code: 'EMP00001',
      first_name: firstName,
      last_name: lastName,
      email,
      password_hash: passwordHash,
      role: 'admin',
      department: 'Administration',
      designation: 'System Administrator',
      date_of_joining: new Date().toISOString().split('T')[0],
      employment_type: 'full_time',
      is_active: true,
      salary_details: { basic: 100000, hra: 40000 },
    })
    .select()
    .single();

  if (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }

  console.log('Admin user created successfully');
  console.log('Email:', email);
  console.log('Password:', password);
  console.log('Employee ID:', data.id);
};

seedAdmin();
