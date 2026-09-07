const { supabaseAdmin } = require('../config/supabase');
const { successResponse } = require('../utils/helpers');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const auditLogService = require('../services/auditLog.service');

/**
 * Section 0/C: manual entries into the SAME real ip_whitelist table
 * beacons write into — the pre-existing "IP Whitelist" Settings UI card
 * previously wrote to a disconnected JSON blob nothing enforced; this
 * makes that same UI card actually work, on the real table.
 */
const list = async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('ip_whitelist')
      .select('*')
      .eq('company_id', req.user.company_id)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'IP whitelist fetched', data || []);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const cidr = String(req.body?.cidr || req.body?.ip || '').trim();
    if (!cidr) throw new BadRequestError('cidr (IP or CIDR) is required');
    const { data, error } = await supabaseAdmin
      .from('ip_whitelist')
      .insert({ company_id: req.user.company_id, cidr, label: req.body?.label || null, created_by: req.user.id })
      .select('*')
      .single();
    if (error) throw new BadRequestError(error.message);
    await auditLogService.logAudit({
      companyId: req.user.company_id, actorId: req.user.id, actorRole: req.user.role,
      actionType: 'ip_whitelist_entry_created', targetType: 'ip_whitelist', targetId: data.id, afterState: data,
    });
    successResponse(res, 'IP whitelist entry created', data, null, 201);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('ip_whitelist')
      .delete()
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestError(error.message);
    if (!data) throw new NotFoundError('Entry not found');
    await auditLogService.logAudit({
      companyId: req.user.company_id, actorId: req.user.id, actorRole: req.user.role,
      actionType: 'ip_whitelist_entry_removed', targetType: 'ip_whitelist', targetId: req.params.id,
    });
    successResponse(res, 'IP whitelist entry removed', { removed: true });
  } catch (err) { next(err); }
};

module.exports = { list, create, remove };
