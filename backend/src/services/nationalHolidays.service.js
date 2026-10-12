const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const settingsService = require('./settings.service');

/**
 * India's national holidays, added to every company's holiday calendar by
 * default. These three are the national holidays observed nationwide on
 * fixed dates; festival holidays move every year and differ by state, so
 * HR adds those (one at a time or with bulk import).
 */
const NATIONAL_HOLIDAYS = [
  { month: 1, day: 26, title: 'Republic Day' },
  { month: 8, day: 15, title: 'Independence Day' },
  { month: 10, day: 2, title: 'Gandhi Jayanti' },
];

// Years already added, per company. Once a year is done it is never redone,
// so a national holiday HR deletes stays deleted.
const MARKER_KEY = 'national_holidays_added';

const pad = (n) => String(n).padStart(2, '0');

/**
 * Adds the national holidays for one company and year, once. Skips any date
 * that already has a holiday (whatever it is called). Sends no email —
 * these are defaults, not announcements.
 * Returns the number of holidays added.
 */
const ensureNationalHolidays = async (companyId, year) => {
  const y = Number(year);
  if (!companyId || !Number.isInteger(y) || y < 2000 || y > 2100) return 0;
  const marker = (await settingsService.getSetting(MARKER_KEY, null, companyId)) || {};
  const done = Array.isArray(marker.years) ? marker.years.map(Number) : [];
  if (done.includes(y)) return 0;

  const dates = NATIONAL_HOLIDAYS.map((h) => `${y}-${pad(h.month)}-${pad(h.day)}`);
  const { data: existing, error } = await supabaseAdmin
    .from('holidays')
    .select('date')
    .eq('company_id', companyId)
    .in('date', dates);
  if (error) throw new Error(`Holiday lookup failed: ${error.message}`);
  const taken = new Set((existing || []).map((h) => String(h.date).slice(0, 10)));

  const rows = NATIONAL_HOLIDAYS
    .map((h) => ({ ...h, date: `${y}-${pad(h.month)}-${pad(h.day)}` }))
    .filter((h) => !taken.has(h.date))
    .map((h) => ({
      company_id: companyId,
      title: h.title,
      date: h.date,
      type: 'public',
      is_mandatory: true,
      description: 'National holiday',
    }));
  if (rows.length) {
    const { error: insErr } = await supabaseAdmin.from('holidays').insert(rows);
    if (insErr) throw new Error(`Could not add national holidays: ${insErr.message}`);
  }
  const { error: markErr } = await settingsService.setSetting(
    MARKER_KEY, { years: [...new Set([...done, y])].sort() }, null, companyId,
  );
  if (markErr) logger.warn('[NationalHolidays] Could not record the year as done', { companyId, year: y, error: markErr.message });
  if (rows.length) logger.info('[NationalHolidays] Added', { companyId, year: y, count: rows.length });
  return rows.length;
};

/** Every active company, this year and next. Failures are logged per company. */
const ensureForAllCompanies = async (years) => {
  const tenantService = require('./tenant.service');
  const companies = await tenantService.listActiveCompanies();
  let added = 0;
  for (const c of companies || []) {
    for (const y of years) {
      try {
        // eslint-disable-next-line no-await-in-loop
        added += await ensureNationalHolidays(String(c.id), y);
      } catch (err) {
        logger.warn('[NationalHolidays] Failed for company', { companyId: c.id, year: y, error: err.message });
      }
    }
  }
  return { companies: (companies || []).length, added };
};

module.exports = { NATIONAL_HOLIDAYS, ensureNationalHolidays, ensureForAllCompanies };
