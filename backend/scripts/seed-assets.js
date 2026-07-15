/**
 * Seed random Assets module data for E2E / UI testing.
 * - asset_categories
 * - assets (available / assigned / in-repair / retired)
 * - asset_requests (requested / approved / rejected)
 *
 * Usage: node scripts/seed-assets.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const CATEGORIES = [
  { name: 'Laptop', description: 'Notebooks and ultrabooks' },
  { name: 'Phone', description: 'Company mobiles' },
  { name: 'Tablet', description: 'iPads and Android tablets' },
  { name: 'Monitor', description: 'External displays' },
  { name: 'Furniture', description: 'Desks, chairs, cabinets' },
  { name: 'Peripheral', description: 'Keyboards, mice, headsets, docks' },
];

const BRANDS = {
  Laptop: ['Dell', 'HP', 'Lenovo', 'Apple', 'Asus'],
  Phone: ['Apple', 'Samsung', 'OnePlus', 'Google'],
  Tablet: ['Apple', 'Samsung', 'Lenovo'],
  Monitor: ['Dell', 'LG', 'Samsung', 'BenQ'],
  Furniture: ['Godrej', 'Ikea', 'Featherlite', 'Nilkamal'],
  Peripheral: ['Logitech', 'Jabra', 'Anker', 'Dell'],
};

const MODELS = {
  Laptop: ['Latitude 5440', 'EliteBook 840', 'ThinkPad T14', 'MacBook Air M3', 'ZenBook 14'],
  Phone: ['iPhone 15', 'Galaxy S24', 'Nord 4', 'Pixel 8'],
  Tablet: ['iPad Air', 'Galaxy Tab S9', 'Tab M10'],
  Monitor: ['U2723QE', '27UL850', 'Odyssey G5', 'GW2780'],
  Furniture: ['Ergo Chair', 'Sit-Stand Desk', 'Storage Cabinet'],
  Peripheral: ['MX Master 3S', 'Evolve2 65', 'USB-C Hub', 'WD19 Dock'],
};

const LOCATIONS = ['Bangalore HQ', 'Mumbai Office', 'Remote Kit', 'Warehouse A', 'Floor 3 Storage'];

const REASONS = [
  'New joiners kit required',
  'Current device underperforms for workload',
  'Broken device needs replacement',
  'Project-specific hardware requirement',
  'Remote work setup',
  'Upgrade after warranty expiry',
];

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function serial(prefix) {
  return `${prefix}-${rand(100000, 999999)}-${rand(10, 99)}`;
}

async function ensureCategories() {
  const { data: existing, error } = await supabase.from('asset_categories').select('id, name');
  if (error) throw error;
  const have = new Set((existing || []).map((c) => c.name.toLowerCase()));
  const missing = CATEGORIES.filter((c) => !have.has(c.name.toLowerCase()));
  if (!missing.length) {
    console.log(`Categories: ${existing.length} already present`);
    return existing;
  }
  const { data, error: insErr } = await supabase.from('asset_categories').insert(missing).select();
  if (insErr) throw insErr;
  console.log(`Categories: inserted ${data.length}, total ~${have.size + data.length}`);
  return [...(existing || []), ...(data || [])];
}

async function loadEmployees() {
  const { data, error } = await supabase
    .from('employees')
    .select('id, first_name, last_name, email, department, role, is_active')
    .eq('is_active', true);
  if (error) throw error;
  return data || [];
}

function buildAssets(employees) {
  const rows = [];
  const assignable = employees.filter((e) => e.role !== 'admin' || true);

  // 18 available
  for (let i = 0; i < 18; i += 1) {
    const category = pick(CATEGORIES).name;
    const brand = pick(BRANDS[category]);
    const model = pick(MODELS[category]);
    rows.push({
      name: `${brand} ${model}`,
      category,
      brand,
      model,
      serial_number: serial(category.slice(0, 3).toUpperCase()),
      purchase_date: isoDaysAgo(rand(30, 900)),
      purchase_cost: rand(8, 180) * 1000,
      warranty_expiry: isoDaysAgo(-rand(60, 700)),
      status: 'available',
      assigned_to: null,
      assigned_on: null,
      location: pick(LOCATIONS),
    });
  }

  // 14 assigned
  for (let i = 0; i < 14; i += 1) {
    const emp = pick(assignable);
    const category = pick(['Laptop', 'Phone', 'Monitor', 'Peripheral', 'Tablet']);
    const brand = pick(BRANDS[category]);
    const model = pick(MODELS[category]);
    rows.push({
      name: `${brand} ${model}`,
      category,
      brand,
      model,
      serial_number: serial('ASN'),
      purchase_date: isoDaysAgo(rand(60, 800)),
      purchase_cost: rand(10, 160) * 1000,
      warranty_expiry: isoDaysAgo(-rand(30, 500)),
      status: 'assigned',
      assigned_to: emp.id,
      assigned_on: isoDaysAgo(rand(5, 200)),
      location: emp.department ? `${emp.department} Desk` : pick(LOCATIONS),
    });
  }

  // 4 in-repair
  for (let i = 0; i < 4; i += 1) {
    const category = pick(['Laptop', 'Phone', 'Monitor']);
    const brand = pick(BRANDS[category]);
    const model = pick(MODELS[category]);
    rows.push({
      name: `${brand} ${model} (repair)`,
      category,
      brand,
      model,
      serial_number: serial('RPR'),
      purchase_date: isoDaysAgo(rand(200, 1000)),
      purchase_cost: rand(15, 120) * 1000,
      warranty_expiry: isoDaysAgo(rand(10, 200)),
      status: 'in-repair',
      assigned_to: null,
      assigned_on: null,
      location: 'Service Center',
    });
  }

  // 3 retired
  for (let i = 0; i < 3; i += 1) {
    const category = pick(['Laptop', 'Phone', 'Furniture']);
    const brand = pick(BRANDS[category]);
    const model = pick(MODELS[category]);
    rows.push({
      name: `${brand} ${model} (retired)`,
      category,
      brand,
      model,
      serial_number: serial('RET'),
      purchase_date: isoDaysAgo(rand(800, 1800)),
      purchase_cost: rand(5, 80) * 1000,
      warranty_expiry: isoDaysAgo(rand(100, 600)),
      status: 'retired',
      assigned_to: null,
      assigned_on: null,
      location: 'Scrap Store',
    });
  }

  return rows;
}

function buildRequests(employees) {
  const statuses = ['requested', 'requested', 'requested', 'approved', 'approved', 'rejected'];
  const urgencies = ['low', 'medium', 'high'];
  const types = CATEGORIES.map((c) => c.name);
  const rows = [];
  for (let i = 0; i < 16; i += 1) {
    const emp = pick(employees);
    rows.push({
      employee_id: emp.id,
      asset_type: pick(types),
      reason: pick(REASONS),
      urgency: pick(urgencies),
      status: pick(statuses),
      requested_on: isoDaysAgo(rand(0, 45)),
    });
  }
  return rows;
}

async function main() {
  console.log('Seeding Assets module…');

  await ensureCategories();

  const employees = await loadEmployees();
  if (!employees.length) {
    throw new Error('No active employees found. Seed employees first.');
  }
  console.log(`Employees available: ${employees.length}`);

  // Optional clean of previous seed batches tagged by serial prefixes? Keep additive.
  const assetRows = buildAssets(employees);
  const { data: assets, error: aErr } = await supabase.from('assets').insert(assetRows).select('id, status');
  if (aErr) throw aErr;
  const byStatus = (assets || []).reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});
  console.log(`Assets inserted: ${assets.length}`, byStatus);

  const requestRows = buildRequests(employees);
  const { data: requests, error: rErr } = await supabase.from('asset_requests').insert(requestRows).select('id, status');
  if (rErr) throw rErr;
  const reqByStatus = (requests || []).reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log(`Asset requests inserted: ${requests.length}`, reqByStatus);

  const [{ count: assetCount }, { count: reqCount }, { count: catCount }] = await Promise.all([
    supabase.from('assets').select('id', { count: 'exact', head: true }),
    supabase.from('asset_requests').select('id', { count: 'exact', head: true }),
    supabase.from('asset_categories').select('id', { count: 'exact', head: true }),
  ]);

  console.log('\nTotals in DB:');
  console.log(`  categories: ${catCount}`);
  console.log(`  assets: ${assetCount}`);
  console.log(`  requests: ${reqCount}`);
  console.log('\nDone. Check UI: /assets/inventory, /assets/requests, /assets/categories, /assets/me');
}

main().catch((err) => {
  console.error('Seed failed:', err.message || err);
  process.exit(1);
});
