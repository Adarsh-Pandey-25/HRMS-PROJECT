const { supabaseAdmin } = require('../config/supabase');
const { announcementEmail } = require('../services/email.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { BadRequestError } = require('../utils/errors');
const { getCompanyId } = require('../utils/tenant');

const isTenantAnnouncement = (row, companyId) =>
  row?.publisher && getCompanyId(row.publisher) === companyId;

const requireTenantAnnouncement = async (id, companyId) => {
  const { data } = await supabaseAdmin
    .from('announcements')
    .select('id, published_by, publisher:published_by(id, address)')
    .eq('id', id)
    .maybeSingle();
  if (!data || !isTenantAnnouncement(data, companyId)) {
    throw new (require('../utils/errors').NotFoundError)('Announcement not found');
  }
  return data;
};

const create = async (req, res, next) => {
  try {
    let attachmentUrl = null;
    if (req.file) {
      const storageService = require('../services/storage.service');
      const { path } = await storageService.uploadFile('documents', req.file, 'announcements');
      attachmentUrl = path;
    }

    let isActive = true;
    if (req.body.is_active === false || req.body.is_active === 'false') isActive = false;
    else if (req.body.is_active === true || req.body.is_active === 'true') isActive = true;

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
    };

    const { data, error } = await supabaseAdmin
      .from('announcements')
      .insert(payload)
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);

    if (data.priority === 'urgent' || data.priority === 'high') {
      const { data: employees } = await supabaseAdmin
        .from('employees')
        .select('email, first_name, address')
        .eq('is_active', true);

      (employees || [])
        .filter((emp) => getCompanyId(emp) === req.user.company_id)
        .slice(0, 50)
        .forEach((emp) => {
        announcementEmail(emp, data).catch(() => {});
      });
    }

    successResponse(res, 'Announcement created', data, null, 201);
  } catch (err) { next(err); }
};

const all = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req.query);
    const { data, error } = await supabaseAdmin
      .from('announcements')
      .select('*, publisher:published_by(first_name, last_name, address)')
      .order('published_at', { ascending: false })
      .limit(5000);

    if (error) throw new BadRequestError(error.message);
    const scoped = (data || []).filter((row) => isTenantAnnouncement(row, req.user.company_id));
    successResponse(
      res,
      'Announcements fetched',
      scoped.slice(offset, offset + limit),
      buildMeta(page, limit, scoped.length)
    );
  } catch (err) { next(err); }
};

const active = async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    let query = supabaseAdmin
      .from('announcements')
      .select('*, publisher:published_by(first_name, last_name, address)')
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
    const scoped = (data || []).filter((row) => isTenantAnnouncement(row, req.user.company_id));
    successResponse(res, 'Active announcements fetched', scoped);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    await requireTenantAnnouncement(req.params.id, req.user.company_id);
    const { data, error } = await supabaseAdmin
      .from('announcements')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Announcement updated', data);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    await requireTenantAnnouncement(req.params.id, req.user.company_id);
    await supabaseAdmin.from('announcements').delete().eq('id', req.params.id);
    successResponse(res, 'Announcement deleted');
  } catch (err) { next(err); }
};

const acknowledge = async (req, res, next) => {
  try {
    await requireTenantAnnouncement(req.params.id, req.user.company_id);
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
