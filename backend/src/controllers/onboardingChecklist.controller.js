const { supabaseAdmin } = require('../config/supabase');
const { successResponse } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');

/**
 * Admin-configurable onboarding checklist templates — the company-wide list
 * of items shown on every candidate's Onboarding Checklist (Recruitment >
 * Offers). Same shape as Employee Document Config: HR/Admin can add, rename,
 * reorder, disable, or delete items, and it applies company-wide.
 */

/** Every template for this company (active + inactive), ordered for display and reordering. */
const list = async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('onboarding_checklist_templates')
      .select('id, label, sort_order, is_active, created_at')
      .eq('company_id', req.user.company_id)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    successResponse(res, 'Onboarding checklist templates fetched', data || []);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const label = String(req.body?.label || '').trim();
    if (!label) throw new BadRequestError('label is required');

    let sortOrder = Number(req.body?.sort_order);
    if (!Number.isFinite(sortOrder)) {
      const { data: maxRow } = await supabaseAdmin
        .from('onboarding_checklist_templates')
        .select('sort_order')
        .eq('company_id', req.user.company_id)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      sortOrder = (maxRow?.sort_order ?? -1) + 1;
    }

    const { data, error } = await supabaseAdmin
      .from('onboarding_checklist_templates')
      .insert({ company_id: req.user.company_id, label, sort_order: sortOrder, is_active: true })
      .select('id, label, sort_order, is_active, created_at')
      .single();
    if (error) {
      if (error.code === '23505') throw new ConflictError('A checklist item with this label already exists');
      throw error;
    }
    successResponse(res, 'Checklist template created', data, null, 201);
  } catch (err) { next(err); }
};

/** Confirm this template id belongs to the requesting HR/Admin's own company before mutating it. */
const requireOwnTemplate = async (id, companyId) => {
  const { data, error } = await supabaseAdmin
    .from('onboarding_checklist_templates')
    .select('id')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError('Checklist template not found');
};

const update = async (req, res, next) => {
  try {
    await requireOwnTemplate(req.params.id, req.user.company_id);

    const patch = {};
    if (req.body?.label !== undefined) {
      const label = String(req.body.label).trim();
      if (!label) throw new BadRequestError('label cannot be empty');
      patch.label = label;
    }
    if (req.body?.sort_order !== undefined) {
      const sortOrder = Number(req.body.sort_order);
      if (!Number.isFinite(sortOrder)) throw new BadRequestError('sort_order must be a number');
      patch.sort_order = sortOrder;
    }
    if (req.body?.is_active !== undefined) {
      patch.is_active = Boolean(req.body.is_active);
    }
    if (!Object.keys(patch).length) throw new BadRequestError('Nothing to update');

    const { data, error } = await supabaseAdmin
      .from('onboarding_checklist_templates')
      .update(patch)
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .select('id, label, sort_order, is_active, created_at')
      .single();
    if (error) {
      if (error.code === '23505') throw new ConflictError('A checklist item with this label already exists');
      throw error;
    }
    successResponse(res, 'Checklist template updated', data);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    await requireOwnTemplate(req.params.id, req.user.company_id);
    const { error } = await supabaseAdmin
      .from('onboarding_checklist_templates')
      .delete()
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id);
    if (error) throw error;
    successResponse(res, 'Checklist template removed');
  } catch (err) { next(err); }
};

module.exports = { list, create, update, remove };
