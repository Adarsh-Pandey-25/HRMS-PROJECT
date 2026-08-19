/**
 * Upload the Spaxads sidebar wordmark for companies whose name matches Spaxads.
 * Run from backend/: node scripts/set-spaxads-sidebar-logo.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../src/config/supabase');
const { uploadCompanyLogo } = require('../src/services/storage.service');
const settingsService = require('../src/services/settings.service');

const LOGO_FILE = path.resolve(__dirname, '../../HRMS/public/brand/spaxads-wordmark.jpg');

async function main() {
  if (!fs.existsSync(LOGO_FILE)) {
    throw new Error(`Logo file missing: ${LOGO_FILE}`);
  }
  const buffer = fs.readFileSync(LOGO_FILE);
  const { data: companies, error } = await supabaseAdmin.from('companies').select('id, name');
  if (error) throw new Error(error.message);

  const targets = (companies || []).filter((c) => /spaxads/i.test(c.name || ''));
  if (!targets.length) {
    throw new Error(`No Spaxads company found. Names: ${(companies || []).map((c) => c.name).join(', ') || 'none'}`);
  }

  for (const company of targets) {
    const file = {
      originalname: 'spaxads-wordmark.jpg',
      mimetype: 'image/jpeg',
      buffer,
    };
    const { path: storagePath } = await uploadCompanyLogo(file, company.id);
    const existing = await settingsService.getSetting('company_profile', {}, company.id) || {};
    await settingsService.setSetting('company_profile', {
      ...existing,
      logoPath: storagePath,
      logoName: 'spaxads-wordmark.jpg',
    }, null, company.id);
    console.log(`Updated logo for ${company.name} (${company.id}) -> ${storagePath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
