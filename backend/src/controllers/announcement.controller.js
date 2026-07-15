const { supabaseAdmin } = require('../config/supabase');
const { announcementEmail } = require('../services/email.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { BadRequestError } = require('../utils/errors');

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
        .select('email, first_name')
        .eq('is_active', true);

      (employees || []).slice(0, 50).forEach((emp) => {
        announcementEmail(emp, data).catch(() => {});
      });
    }

    successResponse(res, 'Announcement created', data, null, 201);
  } catch (err) { next(err); }
};

const all = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req.query);
    const { data, error, count } = await supabaseAdmin
      .from('announcements')
      .select('*, publisher:published_by(first_name, last_name)', { count: 'exact' })
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Announcements fetched', data, buildMeta(page, limit, count));
  } catch (err) { next(err); }
};

const active = async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    let query = supabaseAdmin
      .from('announcements')
      .select('*, publisher:published_by(first_name, last_name)')
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
    successResponse(res, 'Active announcements fetched', data);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
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
    await supabaseAdmin.from('announcements').delete().eq('id', req.params.id);
    successResponse(res, 'Announcement deleted');
  } catch (err) { next(err); }
};

const acknowledge = async (req, res, next) => {
  try {
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
