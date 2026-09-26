const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');
const { slugify } = require('../utils/slug');
const { getTenantOriginForSlug } = require('./tenantUrl.service');
const { GST_RATE } = require('../utils/gst');

const LEAD_STATUSES = ['new', 'contacted', 'invited', 'rejected'];
const LEAD_TYPES = ['trial', 'contact'];

/** Public plan fields only — nothing internal (ids, timestamps, max_seats) leaves the backend. */
const listPublicPlans = async () => {
  const { data, error } = await supabaseAdmin
    .from('subscription_plans')
    .select('name, code, description, base_price_monthly, base_price_quarterly, base_price_annual, price_per_seat_monthly, price_per_seat_annual, included_seats, max_seats, features')
    .eq('is_active', true)
    .order('base_price_monthly', { ascending: true });
  if (error) throw new BadRequestError(error.message);

  return (data || []).map((p) => ({
    name: p.name,
    code: p.code,
    description: p.description || '',
    priceMonthly: Number(p.base_price_monthly) || 0,
    priceQuarterly: Number(p.base_price_quarterly) || 0,
    priceAnnual: Number(p.base_price_annual) || 0,
    pricePerSeatMonthly: Number(p.price_per_seat_monthly) || 0,
    pricePerSeatAnnual: Number(p.price_per_seat_annual) || 0,
    includedSeats: Number(p.included_seats) || 0,
    maxSeats: p.max_seats == null ? null : Number(p.max_seats),
    // All prices above are exclusive of GST; gstRate lets clients show the total.
    gstRate: GST_RATE,
    gstInclusive: false,
    // features is a { key: boolean } map in this schema — expose the enabled keys only.
    features: p.features && typeof p.features === 'object'
      ? Object.entries(p.features).filter(([, on]) => on === true).map(([key]) => key)
      : [],
  }));
};

const createLead = async (payload, { ipAddress, userAgent }) => {
  const type = LEAD_TYPES.includes(payload.type) ? payload.type : 'contact';
  const desiredSlug = type === 'trial' && payload.desired_slug ? slugify(payload.desired_slug) || null : null;

  const row = {
    type,
    full_name: payload.full_name,
    work_email: payload.work_email,
    phone: payload.phone || null,
    company_name: payload.company_name || null,
    company_size: payload.company_size || null,
    message: payload.message || null,
    desired_slug: desiredSlug,
    source_path: payload.source_path ? String(payload.source_path).slice(0, 200) : null,
    ip_address: ipAddress ? String(ipAddress).slice(0, 64) : null,
    user_agent: userAgent ? String(userAgent).slice(0, 500) : null,
  };

  const { data, error } = await supabaseAdmin
    .from('marketing_leads')
    .insert(row)
    .select('*')
    .single();
  if (error) throw new BadRequestError(error.message);

  // Notifications are best-effort — the lead is already safely stored.
  const {
    leadNotificationEmail, leadConfirmationEmail,
  } = require('./email.service');
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (superAdminEmail) {
    leadNotificationEmail(superAdminEmail, data)
      .catch((e) => logger.warn('[Leads] super-admin notification failed', { error: e.message }));
  }
  leadConfirmationEmail(data.work_email, { fullName: data.full_name, type: data.type })
    .catch((e) => logger.warn('[Leads] confirmation email failed', { error: e.message }));

  return data;
};

const listLeads = async ({ page = 1, limit = 20, status, type } = {}) => {
  const offset = (page - 1) * limit;
  let query = supabaseAdmin
    .from('marketing_leads')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (status && LEAD_STATUSES.includes(status)) query = query.eq('status', status);
  if (type && LEAD_TYPES.includes(type)) query = query.eq('type', type);

  const { data, error, count } = await query;
  if (error) throw new BadRequestError(error.message);
  return { data: data || [], total: count || 0 };
};

const getLead = async (id) => {
  const { data, error } = await supabaseAdmin
    .from('marketing_leads')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Lead not found');
  return data;
};

const updateLeadStatus = async (id, status) => {
  if (!LEAD_STATUSES.includes(status)) throw new BadRequestError('Invalid status');
  const before = await getLead(id);
  const { data, error } = await supabaseAdmin
    .from('marketing_leads')
    .update({ status })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new BadRequestError(error.message);
  return { before, after: data };
};

/**
 * Turns a trial lead into a company onboarding invite via the existing
 * invite service, emails the invite link to the lead, and links the two.
 */
const inviteFromLead = async (superAdminId, leadId, { companyName, slug, expiresInDays } = {}) => {
  const lead = await getLead(leadId);
  if (lead.status === 'invited' && lead.invite_id) {
    throw new ConflictError('This lead has already been invited');
  }
  const name = String(companyName || lead.company_name || '').trim();
  if (!name) throw new BadRequestError('Company name is required to send an invite');

  const superAdminService = require('./superAdmin.service');
  const result = await superAdminService.createInvite(superAdminId, {
    email: lead.work_email,
    companyNameHint: name,
    expiresInDays,
    slug: slug || lead.desired_slug || null,
  });

  const { error } = await supabaseAdmin
    .from('marketing_leads')
    .update({ status: 'invited', invite_id: result.invite.id })
    .eq('id', leadId);
  if (error) logger.warn('[Leads] invite created but lead not updated', { leadId, error: error.message });

  const { companyInviteEmail } = require('./email.service');
  companyInviteEmail(lead.work_email, {
    fullName: lead.full_name,
    companyName: name,
    inviteUrl: result.inviteUrl,
    workspaceUrl: getTenantOriginForSlug(result.companySlug),
    expiresAt: result.expiresAt,
  }).catch((e) => logger.warn('[Leads] invite email failed', { leadId, error: e.message }));

  return { lead: { ...lead, status: 'invited', invite_id: result.invite.id }, invite: result };
};

module.exports = {
  LEAD_STATUSES,
  LEAD_TYPES,
  listPublicPlans,
  createLead,
  listLeads,
  getLead,
  updateLeadStatus,
  inviteFromLead,
};
