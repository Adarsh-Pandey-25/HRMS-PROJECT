/**
 * One-off: sync company slug to match display name for renamed subsidiaries.
 * Usage: node scripts/sync-company-slugs.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } },
);

const slugify = (name) => {
  const base = String(name || 'company')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'company';
};

async function uniqueSlug(name, excludeId) {
  const base = slugify(name);
  let candidate = base;
  for (let i = 0; i < 8; i += 1) {
    let q = supabase.from('companies').select('id').eq('slug', candidate);
    if (excludeId) q = q.neq('id', excludeId);
    const { data } = await q.maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

(async () => {
  const { data: rows, error } = await supabase
    .from('companies')
    .select('id, name, slug, company_type')
    .eq('company_type', 'child');
  if (error) throw error;

  let fixed = 0;
  for (const row of rows || []) {
    const desired = slugify(row.name);
    if (!desired || desired === row.slug) continue;
    const next = await uniqueSlug(row.name, row.id);
    const { error: upErr } = await supabase
      .from('companies')
      .update({ slug: next, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (upErr) {
      console.error('FAIL', row.id, row.name, upErr.message);
      continue;
    }
    console.log(`OK  ${row.name}: ${row.slug} → ${next}`);
    fixed += 1;
  }
  console.log(`Done. Updated ${fixed} subsidiar${fixed === 1 ? 'y' : 'ies'}.`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
