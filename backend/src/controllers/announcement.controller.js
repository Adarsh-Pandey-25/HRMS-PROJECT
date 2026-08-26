const { supabaseAdmin } = require('../config/supabase');
const { announcementEmail } = require('../services/email.service');
const notificationService = require('../services/notification.service');
const settingsService = require('../services/settings.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { BadRequestError } = require('../utils/errors');
const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');
const logger = require('../utils/logger');

const companyIdOf = (req) => req.user.company_id || getCompanyId(req.user) || DEFAULT_COMPANY_ID;

const DEFAULT_ANNOUNCEMENT_CONFIG = {
  defaultChannels: { inApp: true, mobilePush: true, email: false },
  emailSubjectTemplate: '[{{company}}] {{priority}}: {{title}}',
  requireApproval: false,
};

const isTenantAnnouncement = (row, companyId) => {
  if (row?.company_id) return String(row.company_id) === String(companyId);
  return row?.publisher && getCompanyId(row.publisher) === companyId;
};

const requireTenantAnnouncement = async (id, companyId) => {
  const { data } = await supabaseAdmin
    .from('announcements')
    .select('id, published_by, company_id, publisher:published_by(id, address, company_id)')
    .eq('id', id)
    .maybeSingle();
  if (!data || !isTenantAnnouncement(data, companyId)) {
    throw new (require('../utils/errors').NotFoundError)('Announcement not found');
  }
  return data;
};

/** Set of announcement ids the given employee has already acknowledged. */
const getAcknowledgedIds = async (employeeId, announcementIds) => {
  if (!employeeId || !announcementIds.length) return new Set();
  const { data } = await supabaseAdmin
    .from('announcement_acknowledgements')
    .select('announcement_id')
    .eq('employee_id', employeeId)
    .in('announcement_id', announcementIds);
  return new Set((data || []).map((r) => r.announcement_id));
};

const withAcknowledged = async (rows, employeeId) => {
  const acked = await getAcknowledgedIds(employeeId, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, is_acknowledged: acked.has(r.id) }));
};

const audienceMatches = (emp, announcement) => {
  const audience = announcement.target_audience || 'all';
  if (audience === 'all') return true;
  if (audience === 'employees') return emp.role === 'employee';
  if (audience === 'managers') return emp.role === 'manager';
  if (audience === 'hr') return ['hr', 'admin'].includes(emp.role);
  if (announcement.department && emp.department === announcement.department) return true;
  return false;
};

const normalizeAnnouncementConfig = (raw) => {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_ANNOUNCEMENT_CONFIG };
  const channels = raw.defaultChannels || raw.default_channels || {};
  return {
    defaultChannels: {
      inApp: channels.inApp !== false && channels.in_app !== false,
      mobilePush: channels.mobilePush !== false && channels.mobile_push !== false,
      email: Boolean(channels.email),
    },
    emailSubjectTemplate:
      raw.emailSubjectTemplate
      || raw.email_subject_template
      || DEFAULT_ANNOUNCEMENT_CONFIG.emailSubjectTemplate,
    requireApproval: Boolean(raw.requireApproval ?? raw.require_approval),
  };
};

const getAnnouncementConfig = async (companyId) => {
  const raw = await settingsService.getSetting('announcement_config', null, companyId);
  return normalizeAnnouncementConfig(raw);
};

const resolveDeliveryChannels = (body, config) => {
  const defaults = config.defaultChannels || DEFAULT_ANNOUNCEMENT_CONFIG.defaultChannels;
  let raw = body?.channels || body?.delivery_channels;
  // multipart/form-data (announcement attachments) can only carry string
  // fields, so the frontend JSON.stringifies the channels object in that case.
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  if (!raw || typeof raw !== 'object') return defaults;
  return {
    inApp: true,
    email: raw.email != null ? Boolean(raw.email) : defaults.email,
    mobilePush: raw.mobilePush != null
      ? Boolean(raw.mobilePush)
      : (raw.mobile_push != null ? Boolean(raw.mobile_push) : defaults.mobilePush),
  };
};

const renderEmailSubject = (template, { company, priority, title }) =>
  String(template || DEFAULT_ANNOUNCEMENT_CONFIG.emailSubjectTemplate)
    .replace(/\{\{company\}\}/g, company || 'Company')
    .replace(/\{\{priority\}\}/g, String(priority || 'medium').toUpperCase())
    .replace(/\{\{title\}\}/g, title || 'Announcement');

const getCompanyName = async (companyId) => {
  const profile = await settingsService.getSetting('company_profile', {}, companyId);
  if (profile?.name) return profile.name;
  const { data } = await supabaseAdmin
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .maybeSingle();
  return data?.name || 'Company';
};

const notifyAnnouncementAudience = async (announcement, companyId, options = {}) => {
  if (!announcement?.is_active) return;

  const config = options.config || await getAnnouncementConfig(companyId);
  const channels = options.channels || config.defaultChannels || DEFAULT_ANNOUNCEMENT_CONFIG.defaultChannels;

  const { data: employees } = await supabaseAdmin
    .from('employees')
    .select('id, role, department, email, first_name')
    .eq('is_active', true)
    .eq('company_id', companyId);

  const recipients = (employees || []).filter(
    (emp) => emp.id !== announcement.published_by && audienceMatches(emp, announcement),
  );

  if (!recipients.length) return;

  const urgent = ['urgent', 'high'].includes(String(announcement.priority || '').toLowerCase());

  if (channels.inApp !== false) {
    await notificationService.createNotifications(
      recipients.map((emp) => ({
        user_id: emp.id,
        type: 'ANNOUNCEMENT',
        title: urgent ? 'Important announcement' : 'New announcement',
        message: announcement.title,
        link: '/announcements',
        meta: { announcement_id: announcement.id, priority: announcement.priority },
        skipEmail: Boolean(channels.email),
      })),
    );
  }

  if (channels.email) {
    const companyName = await getCompanyName(companyId);
    const subject = renderEmailSubject(config.emailSubjectTemplate, {
      company: companyName,
      priority: announcement.priority,
      title: announcement.title,
    });
    recipients
      .filter((emp) => emp.email)
      .forEach((emp) => {
        announcementEmail(emp, announcement, { subject }).catch((err) => {
          logger.error('Announcement email failed', { employeeId: emp.id, error: err.message });
        });
      });
  }
};

const create = async (req, res, next) => {
  try {
    const companyId = companyIdOf(req);
    const config = await getAnnouncementConfig(companyId);
    const deliveryChannels = resolveDeliveryChannels(req.body, config);

    let attachmentUrl = null;
    if (req.file) {
      const storageService = require('../services/storage.service');
      const { path } = await storageService.uploadFile('documents', req.file, 'announcements');
      attachmentUrl = path;
    }

    let isActive = true;
    if (req.body.is_active === false || req.body.is_active === 'false') isActive = false;
    else if (req.body.is_active === true || req.body.is_active === 'true') isActive = true;

    const wantsPublish = isActive;
    if (config.requireApproval && req.user.role !== 'admin' && wantsPublish) {
      isActive = false;
    }

    const payload = {
      title: String(req.body.title || '').trim(),
      content: String(req.body.content || '').trim(),
      priority: req.body.priority || 'medium',
      target_audience: req.body.target_audience || 'all',
      department: req.body.department || null,
      expires_at: req.body.expires_at || null,
      is_active: isActive,
      attachment_url: attachmentUrl,
      published_by: req.user.id,
      company_id: companyId,
    };

    const { data, error } = await supabaseAdmin
      .from('announcements')
      .insert(payload)
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);

    const pendingApproval = config.requireApproval && req.user.role !== 'admin' && wantsPublish && !data.is_active;

    if (data.is_active) {
      try {
        await notifyAnnouncementAudience(data, companyId, { config, channels: deliveryChannels });
      } catch {
        /* non-blocking */
      }
    }

    successResponse(
      res,
      pendingApproval ? 'Announcement submitted for admin approval' : 'Announcement created',
      { ...data, pending_approval: pendingApproval },
      null,
      201,
    );
  } catch (err) { next(err); }
};

const all = async (req, res, next) => {
  try {
    const companyId = companyIdOf(req);
    const { page, limit, offset } = paginate(req.query);
    const { data, error } = await supabaseAdmin
      .from('announcements')
      .select('*, publisher:published_by(first_name, last_name, address, company_id)')
      .eq('company_id', companyId)
      .order('published_at', { ascending: false })
      .limit(5000);

    if (error) throw new BadRequestError(error.message);
    const scoped = data || [];
    const pageRows = await withAcknowledged(scoped.slice(offset, offset + limit), req.user.id);
    successResponse(
      res,
      'Announcements fetched',
      pageRows,
      buildMeta(page, limit, scoped.length)
    );
  } catch (err) { next(err); }
};

const active = async (req, res, next) => {
  try {
    const companyId = companyIdOf(req);
    const now = new Date().toISOString();
    let query = supabaseAdmin
      .from('announcements')
      .select('*, publisher:published_by(first_name, last_name, address, company_id)')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('priority', { ascending: false });

    const role = req.user.role;
    if (role === 'employee') {
      query = query.in('target_audience', ['all', 'employees']);
    } else if (role === 'manager') {
      query = query.in('target_audience', ['all', 'managers', 'employees']);
    }

    const { data, error } = await query;
    if (error) throw new BadRequestError(error.message);
    const withAck = await withAcknowledged(data || [], req.user.id);
    successResponse(res, 'Active announcements fetched', withAck);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    await requireTenantAnnouncement(req.params.id, companyIdOf(req));
    const companyId = companyIdOf(req);
    const config = await getAnnouncementConfig(companyId);
    const deliveryChannels = resolveDeliveryChannels(req.body, config);

    const { data, error } = await supabaseAdmin
      .from('announcements')
      .update(req.body)
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);

    if (req.body.is_active === true || req.body.is_active === 'true') {
      try {
        await notifyAnnouncementAudience(data, companyId, { config, channels: deliveryChannels });
      } catch {
        /* non-blocking */
      }
    }

    successResponse(res, 'Announcement updated', data);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    await requireTenantAnnouncement(req.params.id, companyIdOf(req));
    await supabaseAdmin
      .from('announcements')
      .delete()
      .eq('id', req.params.id)
      .eq('company_id', companyIdOf(req));
    successResponse(res, 'Announcement deleted');
  } catch (err) { next(err); }
};

const acknowledge = async (req, res, next) => {
  try {
    await requireTenantAnnouncement(req.params.id, companyIdOf(req));
    const { data, error } = await supabaseAdmin
      .from('announcement_acknowledgements')
      .upsert({
        announcement_id: req.params.id,
        employee_id: req.user.id,
      }, { onConflict: 'announcement_id,employee_id' })
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Announcement acknowledged', data);
  } catch (err) { next(err); }
};

module.exports = { create, all, active, update, remove, acknowledge };
