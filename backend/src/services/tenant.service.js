const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const {
  DEFAULT_COMPANY_ID,
  getCompanyId,
  withCompanyId,
  settingsKey,
} = require('../utils/tenant');

let backfillDone = false;

/**
 * Assign legacy employees (no company_id) to the default company
 * so existing demo data stays together and new workspaces stay empty.
 */
const ensureTenantBackfill = async () => {
  if (backfillDone) return;
  try {
    const { data: rows, error } = await supabaseAdmin
      .from('employees')
      .select('id, address, company_id')
      .limit(5000);

    if (error) {
      logger.warn('Tenant backfill skipped', { error: error.message });
      return;
    }

    const need = (rows || []).filter((e) => {
      if (e.company_id) return false;
      const addr = (e.address && typeof e.address === 'object') ? e.address : {};
      return !addr.company_id && !addr.companyId;
    });

    for (const emp of need) {
      const nextAddr = withCompanyId(emp.address, DEFAULT_COMPANY_ID);
      const { error: upErr } = await supabaseAdmin
        .from('employees')
        .update({ address: nextAddr, company_id: DEFAULT_COMPANY_ID })
        .eq('id', emp.id);
      if (upErr) logger.warn('Tenant backfill row failed', { id: emp.id, error: upErr.message });
    }

    if (need.length) {
      logger.info('Tenant backfill complete', { updated: need.length, companyId: DEFAULT_COMPANY_ID });
    }

    // Ensure default company has a company_profile key (copy from legacy if present)
    const { data: legacy } = await supabaseAdmin
      .from('system_settings')
      .select('key,value')
      .eq('key', 'company_profile')
      .maybeSingle();

    const tenantProfileKey = settingsKey(DEFAULT_COMPANY_ID, 'company_profile');
    const { data: existingTenant } = await supabaseAdmin
      .from('system_settings')
      .select('key')
      .eq('key', tenantProfileKey)
      .maybeSingle();

    if (!existingTenant && legacy?.value) {
      await supabaseAdmin.from('system_settings').upsert({
        key: tenantProfileKey,
        value: legacy.value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }

    backfillDone = true;
  } catch (err) {
    logger.warn('Tenant backfill error', { error: err.message });
  }
};

/** Create / ensure a companies row (onboarding + repairs). */
const ensureCompanyRow = async ({ id, name, slug } = {}) => {
  const companyId = id || DEFAULT_COMPANY_ID;
  const { data: existing } = await supabaseAdmin
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .maybeSingle();
  if (existing) return existing;

  const safeSlug = (slug || `co-${String(companyId).replace(/-/g, '')}`).slice(0, 100);
  const { data, error } = await supabaseAdmin
    .from('companies')
    .insert({
      id: companyId,
      name: name || 'Company',
      slug: safeSlug,
      is_active: true,
    })
    .select('id')
    .single();

  if (error) {
    // Race / slug conflict — try update name only
    logger.warn('ensureCompanyRow insert failed', { companyId, error: error.message });
    return { id: companyId };
  }
  return data;
};

/** All employee ids belonging to a company (uses real column when present). */
const getCompanyEmployeeIds = async (companyId) => {
  const cid = companyId || DEFAULT_COMPANY_ID;
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('id, company_id, address')
    .eq('company_id', cid)
    .limit(5000);

  if (error) {
    // Fallback if column missing mid-deploy
    const { data: rows, error: err2 } = await supabaseAdmin
      .from('employees')
      .select('id, address')
      .limit(5000);
    if (err2) throw err2;
    return (rows || []).filter((e) => getCompanyId(e) === cid).map((e) => e.id);
  }

  return (data || []).map((e) => e.id);
};

const employeeBelongsToCompany = (employee, companyId) =>
  getCompanyId(employee) === (companyId || DEFAULT_COMPANY_ID);

/** Active HR/Admin ids for one company (notifications / approval fan-out). */
const getCompanyHrAdminIds = async (companyId) => {
  const cid = companyId || DEFAULT_COMPANY_ID;
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('id, company_id, address, role')
    .in('role', ['hr', 'admin'])
    .eq('is_active', true)
    .eq('company_id', cid)
    .limit(500);

  if (error) {
    const { data: rows, error: err2 } = await supabaseAdmin
      .from('employees')
      .select('id, address, role')
      .in('role', ['hr', 'admin'])
      .eq('is_active', true)
      .limit(500);
    if (err2) throw err2;
    return (rows || []).filter((e) => getCompanyId(e) === cid).map((e) => e.id);
  }
  return (data || []).map((e) => e.id);
};

/** True when target employee belongs to the same company as actor. */
const assertSameCompany = async (actorCompanyId, employeeId) => {
  const { data } = await supabaseAdmin
    .from('employees')
    .select('id, company_id, address')
    .eq('id', employeeId)
    .maybeSingle();
  if (!data) return false;
  return getCompanyId(data) === (actorCompanyId || DEFAULT_COMPANY_ID);
};

module.exports = {
  ensureTenantBackfill,
  ensureCompanyRow,
  getCompanyEmployeeIds,
  getCompanyHrAdminIds,
  employeeBelongsToCompany,
  assertSameCompany,
};
