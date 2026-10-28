const { supabaseAdmin } = require('../config/supabase');
const { getConfig } = require('../config/whatsapp');
const { successResponse } = require('../utils/helpers');
const { BadRequestError, ForbiddenError } = require('../utils/errors');
const settings = require('../services/whatsappSettings.service');
const linkService = require('../services/whatsappLink.service');
const { COMPANY_SWITCHABLE, describeGroups } = require('../services/whatsappGroups');
const L = require('../services/whatsappLookup');

/**
 * WhatsApp updates for the signed-in employee (connect, choose groups,
 * disconnect) and the company-wide switch for HR and admins. Only the
 * person themself can connect their WhatsApp — there is no endpoint for HR
 * to do it on someone's behalf.
 */

const REASONS = {
  not_set_up: 'WhatsApp updates are not available yet.',
  add_on_off: 'WhatsApp updates are not part of your company’s SpaxSync plan. Your admin can ask SpaxSync to switch them on.',
  company_off: 'Your company has switched WhatsApp updates off.',
};

const companyIdOf = (req) => req.user?.company_id || null;

const requireEmployee = (req) => {
  if (req.authType === 'api_key' || !req.user?.id) {
    throw new ForbiddenError('Sign in as an employee to manage WhatsApp updates');
  }
};

/** Can this company use WhatsApp right now, and if not, why not. */
const availability = async (companyId) => {
  const cfg = getConfig();
  const platformReady = cfg.enabled && Boolean(cfg.accessToken && cfg.phoneNumberId && cfg.businessNumber);
  if (!platformReady) return { available: false, reason: 'not_set_up', addOn: false, companyEnabled: false };
  const addOn = await settings.isAddOnEnabled(companyId);
  if (!addOn) return { available: false, reason: 'add_on_off', addOn, companyEnabled: false };
  const company = await settings.getCompanySettings(companyId);
  return {
    available: company.enabled,
    reason: company.enabled ? null : 'company_off',
    addOn,
    companyEnabled: company.enabled,
    companyGroups: company.groups,
  };
};

const describeMe = async (req) => {
  const companyId = companyIdOf(req);
  const state = await availability(companyId);
  // Switched off here: nobody can be connected, and the tables may not exist yet.
  const link = state.reason === 'not_set_up' ? null : await linkService.getLink('employee', req.user.id);
  const me = linkService.describeLink(link, req.user.role);
  // A group the company switched off for everyone is shown as off and locked.
  me.groups = me.groups.map((g) => ({ ...g, lockedByCompany: state.companyGroups?.[g.key] === false }));
  return { available: state.available, reason: state.reason, message: state.reason ? REASONS[state.reason] : null, ...me };
};

const getMine = async (req, res, next) => {
  try {
    requireEmployee(req);
    successResponse(res, 'WhatsApp updates', await describeMe(req));
  } catch (err) { next(err); }
};

const startLink = async (req, res, next) => {
  try {
    requireEmployee(req);
    const companyId = companyIdOf(req);
    const state = await availability(companyId);
    if (!state.available) throw new BadRequestError(REASONS[state.reason] || REASONS.not_set_up);
    const { data: company } = await supabaseAdmin.from('companies').select('id, name').eq('id', companyId).maybeSingle();
    const started = await linkService.startLink({
      subjectType: 'employee',
      subjectId: req.user.id,
      companyId,
      companyName: await L.companyName(company || { id: companyId }),
    });
    successResponse(res, 'Open WhatsApp and send the message to connect', started);
  } catch (err) { next(err); }
};

const updateMyGroups = async (req, res, next) => {
  try {
    requireEmployee(req);
    const { groups } = req.body || {};
    if (!groups || typeof groups !== 'object' || Array.isArray(groups)) throw new BadRequestError('groups must be an object of true/false switches');
    await linkService.updateGroups('employee', req.user.id, req.user.role, groups);
    successResponse(res, 'WhatsApp updates saved', await describeMe(req));
  } catch (err) { next(err); }
};

const disconnect = async (req, res, next) => {
  try {
    requireEmployee(req);
    await linkService.disconnect('employee', req.user.id);
    successResponse(res, 'WhatsApp disconnected', await describeMe(req));
  } catch (err) { next(err); }
};

const describeCompany = async (companyId) => {
  const cfg = getConfig();
  const state = await availability(companyId);
  // WhatsApp not switched on here: answer without touching its tables, which
  // may not exist yet on a server where the migration has not run.
  if (state.reason === 'not_set_up') {
    return {
      platformReady: false, addOn: false, enabled: false, available: false, reason: state.reason,
      message: REASONS.not_set_up, connectedCount: 0, businessNumber: null, groups: [], updatedAt: null,
    };
  }
  const companySettings = await settings.getCompanySettings(companyId);
  const { count } = await supabaseAdmin
    .from('whatsapp_links')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('subject_type', 'employee')
    .eq('status', 'active');
  return {
    platformReady: state.reason !== 'not_set_up',
    addOn: state.addOn,
    enabled: companySettings.enabled,
    available: state.available,
    reason: state.reason,
    message: state.reason ? REASONS[state.reason] : null,
    connectedCount: count || 0,
    businessNumber: cfg.businessNumber ? `+${cfg.businessNumber}` : null,
    groups: describeGroups(COMPANY_SWITCHABLE, companySettings.groups),
    updatedAt: companySettings.updatedAt,
  };
};

const getCompany = async (req, res, next) => {
  try {
    successResponse(res, 'WhatsApp settings', await describeCompany(companyIdOf(req)));
  } catch (err) { next(err); }
};

const updateCompany = async (req, res, next) => {
  try {
    const { enabled, groups } = req.body || {};
    if (enabled !== undefined && typeof enabled !== 'boolean') throw new BadRequestError('enabled must be true or false');
    if (groups !== undefined && (!groups || typeof groups !== 'object' || Array.isArray(groups))) {
      throw new BadRequestError('groups must be an object of true/false switches');
    }
    await settings.updateCompanySettings(companyIdOf(req), { enabled, groups }, req.user?.id || null);
    successResponse(res, 'WhatsApp settings saved', await describeCompany(companyIdOf(req)));
  } catch (err) { next(err); }
};

module.exports = {
  getMine, startLink, updateMyGroups, disconnect, getCompany, updateCompany,
};
