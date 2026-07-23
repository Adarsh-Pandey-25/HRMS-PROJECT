const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const {
  DEFAULT_COMPANY_ID,
  getCompanyId,
  withCompanyId,
  settingsKey,
} = require('../utils/tenant');
const { ForbiddenError, BadRequestError } = require('../utils/errors');

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
const ensureCompanyRow = async ({
  id,
  name,
  slug,
  parent_company_id = null,
  company_type = 'standalone',
} = {}) => {
  const companyId = id || DEFAULT_COMPANY_ID;
  const existing = await getCompanyById(companyId);
  if (existing) return existing;

  const safeSlug = (slug || `co-${String(companyId).replace(/-/g, '')}`).slice(0, 100);
  const type = ['standalone', 'parent', 'child'].includes(company_type)
    ? company_type
    : 'standalone';

  const basePayload = {
    id: companyId,
    name: name || 'Company',
    slug: safeSlug,
    is_active: true,
  };

  // Prefer hierarchy insert; fall back if migration not applied yet
  const withHierarchy = {
    ...basePayload,
    company_type: type,
    parent_company_id: type === 'child' ? parent_company_id : null,
  };

  let { data, error } = await supabaseAdmin
    .from('companies')
    .insert(withHierarchy)
    .select('id, name, slug, is_active, parent_company_id, company_type, created_at')
    .single();

  if (error && isMissingHierarchyColumn(error)) {
    hierarchyColumnsReady = false;
    ({ data, error } = await supabaseAdmin
      .from('companies')
      .insert(basePayload)
      .select('id, name, slug, is_active, created_at')
      .single());
    if (!error && data) {
      return { ...data, parent_company_id: null, company_type: 'standalone' };
    }
  }

  if (error) {
    logger.warn('ensureCompanyRow insert failed', { companyId, error: error.message });
    return { id: companyId };
  }
  if (data?.company_type) hierarchyColumnsReady = true;
  return data;
};

/** True when Postgres error is about missing hierarchy columns. */
const isMissingHierarchyColumn = (err) => {
  const msg = String(err?.message || err?.details || err?.hint || '');
  return /parent_company_id|company_type/i.test(msg) && /does not exist/i.test(msg);
};

/** Cached: null = unknown, true/false after first probe. */
let hierarchyColumnsReady = null;

/**
 * Fetch one companies row (or null).
 * Falls back when hierarchy migration is not applied yet.
 */
const getCompanyById = async (companyId) => {
  if (!companyId) return null;

  const basicSelect = 'id, name, slug, is_active, created_at, updated_at';
  const fullSelect = `${basicSelect}, parent_company_id, company_type`;

  const runBasic = async () => {
    const { data, error } = await supabaseAdmin
      .from('companies')
      .select(basicSelect)
      .eq('id', companyId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { ...data, parent_company_id: null, company_type: 'standalone' };
  };

  if (hierarchyColumnsReady === false) {
    return runBasic();
  }

  const { data, error } = await supabaseAdmin
    .from('companies')
    .select(fullSelect)
    .eq('id', companyId)
    .maybeSingle();

  if (error) {
    if (isMissingHierarchyColumn(error)) {
      hierarchyColumnsReady = false;
      logger.warn(
        'Company hierarchy columns missing — run backend/supabase/migrations/20260723_company_hierarchy.sql in Supabase. Using single-company scope until then.',
      );
      return runBasic();
    }
    throw error;
  }

  hierarchyColumnsReady = true;
  return data;
};

/**
 * Company IDs the actor may manage:
 * - parent → self + all children
 * - standalone / child → self only
 * - hierarchy not migrated → self only (safe fallback)
 */
const getOrgCompanyIds = async (actorCompanyId) => {
  const cid = actorCompanyId || DEFAULT_COMPANY_ID;
  try {
    const self = await getCompanyById(cid);
    if (!self) return [cid];

    if (self.company_type === 'parent' && hierarchyColumnsReady !== false) {
      const { data: children, error } = await supabaseAdmin
        .from('companies')
        .select('id')
        .eq('parent_company_id', cid);
      if (error) {
        if (isMissingHierarchyColumn(error)) {
          hierarchyColumnsReady = false;
          return [cid];
        }
        throw error;
      }
      return [cid, ...(children || []).map((c) => c.id)];
    }
    return [cid];
  } catch (err) {
    if (isMissingHierarchyColumn(err)) {
      hierarchyColumnsReady = false;
      return [cid];
    }
    throw err;
  }
};

/** True when targetCompanyId is actor's company or a child of it. */
const isCompanyInOrg = async (actorCompanyId, targetCompanyId) => {
  if (!targetCompanyId) return false;
  const ids = await getOrgCompanyIds(actorCompanyId);
  const target = String(targetCompanyId);
  return (ids || []).some((id) => String(id) === target);
};

/** Promote standalone → parent when first child is added. */
const promoteToParentIfNeeded = async (companyId) => {
  if (hierarchyColumnsReady === false) {
    throw new BadRequestError(
      'Run migration 20260723_company_hierarchy.sql in Supabase before creating child companies.',
    );
  }
  const row = await getCompanyById(companyId);
  if (!row) return null;
  if (row.company_type === 'parent') return row;
  if (row.company_type === 'child') {
    throw new ForbiddenError('Child companies cannot create subsidiaries');
  }
  const { data, error } = await supabaseAdmin
    .from('companies')
    .update({
      company_type: 'parent',
      parent_company_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', companyId)
    .select('id, name, slug, is_active, parent_company_id, company_type, created_at, updated_at')
    .single();
  if (error) {
    if (isMissingHierarchyColumn(error)) {
      hierarchyColumnsReady = false;
      throw new BadRequestError(
        'Run migration 20260723_company_hierarchy.sql in Supabase before creating child companies.',
      );
    }
    throw error;
  }
  return data;
};

const assertHierarchyReady = () => {
  if (hierarchyColumnsReady === false) {
    throw new BadRequestError(
      'Company hierarchy is not set up yet. Run backend/supabase/migrations/20260723_company_hierarchy.sql in the Supabase SQL Editor, then retry.',
    );
  }
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

/**
 * Employee ids across the actor's org (parent + children for admin/HR home).
 * Standalone / child → same as getCompanyEmployeeIds.
 */
const getOrgEmployeeIds = async (actorCompanyId) => {
  const companyIds = await getOrgCompanyIds(actorCompanyId);
  if (!companyIds.length) return [];
  if (companyIds.length === 1) {
    return getCompanyEmployeeIds(companyIds[0]);
  }
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('id')
    .in('company_id', companyIds)
    .limit(10000);
  if (error) throw error;
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

/** True when target employee belongs to the actor's company or org (main + subsidiaries). */
const assertSameCompany = async (actorCompanyId, employeeId) => {
  const { data } = await supabaseAdmin
    .from('employees')
    .select('id, company_id, address')
    .eq('id', employeeId)
    .maybeSingle();
  if (!data) return false;
  const empCompanyId = getCompanyId(data);
  const home = actorCompanyId || DEFAULT_COMPANY_ID;
  if (empCompanyId === home) return true;
  return await isCompanyInOrg(home, empCompanyId);
};

module.exports = {
  ensureTenantBackfill,
  ensureCompanyRow,
  getCompanyById,
  getOrgCompanyIds,
  isCompanyInOrg,
  promoteToParentIfNeeded,
  assertHierarchyReady,
  getCompanyEmployeeIds,
  getOrgEmployeeIds,
  getCompanyHrAdminIds,
  employeeBelongsToCompany,
  assertSameCompany,
};
