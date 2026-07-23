const { supabaseAdmin } = require('../config/supabase');
const { newCompanyId } = require('../utils/tenant');
const {
  ensureCompanyRow,
  getCompanyById,
  getOrgCompanyIds,
  isCompanyInOrg,
  promoteToParentIfNeeded,
  assertHierarchyReady,
} = require('./tenant.service');
const settingsService = require('./settings.service');
const { uploadCompanyLogo, getSignedUrl, STORAGE_BUCKETS } = require('./storage.service');
const {
  BadRequestError, ForbiddenError, NotFoundError, ConflictError,
} = require('../utils/errors');

const slugify = (name) => {
  const base = String(name || 'company')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'company';
};

const uniqueSlug = async (name) => {
  const base = slugify(name);
  let candidate = base;
  for (let i = 0; i < 8; i += 1) {
    const { data } = await supabaseAdmin
      .from('companies')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${base}-${Date.now().toString(36)}`;
};

const countEmployees = async (companyId) => {
  const { count, error } = await supabaseAdmin
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .neq('role', 'admin');
  if (error) return 0;
  return count || 0;
};

const resolveLogoUrl = async (companyId) => {
  try {
    const profile = await settingsService.getSetting('company_profile', {}, companyId);
    const logoPath = profile?.logoPath || profile?.logo_path;
    if (!logoPath) return { logoPath: null, logoUrl: null };
    const logoUrl = await getSignedUrl(STORAGE_BUCKETS.documents, logoPath, 86400);
    return { logoPath, logoUrl };
  } catch {
    return { logoPath: null, logoUrl: null };
  }
};

const enrichCompany = async (row, { isHome = false } = {}) => {
  if (!row) return null;
  const [employeeCount, logo] = await Promise.all([
    countEmployees(row.id),
    resolveLogoUrl(row.id),
  ]);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    isActive: row.is_active !== false,
    companyType: row.company_type || 'standalone',
    parentCompanyId: row.parent_company_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    employeeCount,
    logoPath: logo.logoPath,
    logoUrl: logo.logoUrl,
    isHome,
  };
};

/** Assert target company is in actor's org scope. */
const assertOrgCompany = async (actorCompanyId, targetCompanyId) => {
  const ok = await isCompanyInOrg(actorCompanyId, targetCompanyId);
  if (!ok) throw new ForbiddenError('Company is outside your organization');
  const row = await getCompanyById(targetCompanyId);
  if (!row) throw new NotFoundError('Company not found');
  return row;
};

/** Current company + whether admin can manage children. */
const getMyCompany = async (actorCompanyId) => {
  const row = await getCompanyById(actorCompanyId);
  if (!row) throw new NotFoundError('Company not found');
  const enriched = await enrichCompany(row, { isHome: true });
  const canManageChildren = row.company_type !== 'child';
  return { ...enriched, canManageChildren };
};

/** Parent + children visible to this admin. */
const listAccessibleCompanies = async (actorCompanyId) => {
  const ids = await getOrgCompanyIds(actorCompanyId);
  const homeId = String(actorCompanyId);
  const list = [];
  for (const id of ids) {
    const row = await getCompanyById(id);
    if (row) list.push(await enrichCompany(row, { isHome: String(row.id) === homeId }));
  }
  return list;
};

const listChildren = async (actorCompanyId) => {
  const self = await getCompanyById(actorCompanyId);
  if (!self) throw new NotFoundError('Company not found');
  if (self.company_type === 'child') {
    throw new ForbiddenError('Child companies cannot list subsidiaries');
  }
  if (self.company_type !== 'parent') {
    return [];
  }

  const ids = await getOrgCompanyIds(actorCompanyId);
  const list = [];
  for (const id of ids) {
    if (String(id) === String(actorCompanyId)) continue;
    const row = await getCompanyById(id);
    if (row) list.push(await enrichCompany(row, { isHome: false }));
  }
  return list;
};

/**
 * Create a child under the admin's company.
 * Promotes standalone → parent on first child.
 */
const createChild = async (actorCompanyId, actorUserId, { name, slug } = {}) => {
  // Probe DB; assertHierarchyReady throws if migration missing after probe
  await getCompanyById(actorCompanyId);
  assertHierarchyReady();

  const trimmed = String(name || '').trim();
  if (trimmed.length < 2) throw new BadRequestError('Company name is required');

  const self = await getCompanyById(actorCompanyId);
  if (!self) throw new NotFoundError('Company not found');
  if (self.company_type === 'child') {
    throw new ForbiddenError('Child companies cannot create subsidiaries');
  }
  if (self.is_active === false) {
    throw new ForbiddenError('Your company is inactive');
  }

  await promoteToParentIfNeeded(actorCompanyId);

  const childId = newCompanyId();
  const childSlug = slug
    ? String(slug).trim().slice(0, 100)
    : await uniqueSlug(trimmed);

  const { data: slugTaken } = await supabaseAdmin
    .from('companies')
    .select('id')
    .eq('slug', childSlug)
    .maybeSingle();
  if (slugTaken) throw new ConflictError('Company slug already exists');

  const child = await ensureCompanyRow({
    id: childId,
    name: trimmed,
    slug: childSlug,
    parent_company_id: actorCompanyId,
    company_type: 'child',
  });

  if (!child?.id || child.company_type !== 'child') {
    const verify = await getCompanyById(childId);
    if (!verify || verify.company_type !== 'child') {
      throw new BadRequestError(
        'Failed to create child company. Ensure migration 20260723_company_hierarchy.sql is applied in Supabase.',
      );
    }
  }

  await settingsService.seedCompanySettings(
    childId,
    { name: trimmed },
    actorUserId,
    actorCompanyId,
  );

  const row = await getCompanyById(childId);
  return enrichCompany(row, { isHome: false });
};

const updateChild = async (actorCompanyId, childId, { name, is_active } = {}) => {
  const self = await getCompanyById(actorCompanyId);
  if (!self) throw new NotFoundError('Company not found');
  if (self.company_type === 'child') {
    throw new ForbiddenError('Child companies cannot manage siblings');
  }

  const child = await getCompanyById(childId);
  if (!child || String(child.parent_company_id || '') !== String(actorCompanyId)) {
    throw new NotFoundError('Child company not found');
  }

  const patch = { updated_at: new Date().toISOString() };
  if (name !== undefined) {
    const trimmed = String(name || '').trim();
    if (trimmed.length < 2) throw new BadRequestError('Company name is required');
    patch.name = trimmed;
    // Always regenerate slug from the new display name
    const desiredSlug = slugify(trimmed);
    if (desiredSlug) {
      const { data: slugTaken } = await supabaseAdmin
        .from('companies')
        .select('id')
        .eq('slug', desiredSlug)
        .neq('id', childId)
        .maybeSingle();
      patch.slug = slugTaken ? await uniqueSlug(trimmed) : desiredSlug;
    }
  }
  if (is_active !== undefined) {
    patch.is_active = Boolean(is_active);
  }

  const { data, error } = await supabaseAdmin
    .from('companies')
    .update(patch)
    .eq('id', childId)
    .select('id, name, slug, is_active, created_at, updated_at')
    .single();
  if (error) throw new BadRequestError(error.message);

  if (name !== undefined) {
    try {
      const profile = await settingsService.getSetting('company_profile', {}, childId);
      await settingsService.setSetting(
        'company_profile',
        { ...(profile && typeof profile === 'object' ? profile : {}), name: data.name },
        null,
        childId,
      );
    } catch {
      /* best-effort profile sync */
    }
  }

  const refreshed = await getCompanyById(childId);
  return enrichCompany(refreshed || data, { isHome: false });
};

/**
 * List employees belonging to a company in the admin's org (parent or child).
 * Excludes admin role accounts from the roster.
 */
const listCompanyEmployees = async (actorCompanyId, targetCompanyId) => {
  await assertOrgCompany(actorCompanyId, targetCompanyId);

  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('id, employee_code, first_name, last_name, email, department, designation, role, is_active, created_at')
    .eq('company_id', targetCompanyId)
    .neq('role', 'admin')
    .order('first_name', { ascending: true });

  if (error) throw new BadRequestError(error.message);

  return (data || []).map((e) => ({
    id: e.id,
    employeeCode: e.employee_code,
    firstName: e.first_name,
    lastName: e.last_name,
    name: [e.first_name, e.last_name].filter(Boolean).join(' ').trim() || e.email,
    email: e.email,
    department: e.department,
    designation: e.designation,
    role: e.role,
    isActive: e.is_active !== false,
    createdAt: e.created_at,
    companyId: targetCompanyId,
  }));
};

/** Upload / replace logo for any company in the admin's org. */
const uploadOrgCompanyLogo = async (actorCompanyId, targetCompanyId, file, actorUserId) => {
  if (!file) throw new BadRequestError('Logo file is required');
  const ext = String(file.originalname || '').split('.').pop().toLowerCase();
  if (!['png', 'jpg', 'jpeg'].includes(ext)) {
    throw new BadRequestError('Logo must be PNG or JPG');
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new BadRequestError('Logo must be 2MB or smaller');
  }

  await assertOrgCompany(actorCompanyId, targetCompanyId);

  const { path } = await uploadCompanyLogo(file, targetCompanyId);
  const existing = await settingsService.getSetting('company_profile', {}, targetCompanyId) || {};
  const profile = {
    ...(existing && typeof existing === 'object' ? existing : {}),
    logoPath: path,
    logoName: file.originalname,
  };
  await settingsService.setSetting('company_profile', profile, actorUserId, targetCompanyId);
  const logoUrl = await getSignedUrl(STORAGE_BUCKETS.documents, path, 86400);
  const company = await enrichCompany(await getCompanyById(targetCompanyId), {
    isHome: String(targetCompanyId) === String(actorCompanyId),
  });
  return {
    logoPath: path,
    logoUrl,
    logoName: file.originalname,
    company,
  };
};

module.exports = {
  getMyCompany,
  listAccessibleCompanies,
  listChildren,
  createChild,
  updateChild,
  listCompanyEmployees,
  uploadOrgCompanyLogo,
};
