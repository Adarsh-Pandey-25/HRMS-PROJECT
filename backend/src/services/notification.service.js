const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError } = require('../utils/errors');
const { paginate, buildMeta } = require('../utils/helpers');
const { notificationEmail } = require('./email.service');
const logger = require('../utils/logger');

const EVENT_BY_TYPE = {
  ANNOUNCEMENT: 'New announcement',
  PAYROLL: 'Payslip ready',
  ASSET: 'Asset assigned',
};

const resolveTriggerEvent = (item) => {
  const type = String(item?.type || '').toUpperCase();
  const title = String(item?.title || '').toLowerCase();
  if (type === 'LEAVE') {
    if (title.includes('approved')) return 'Leave approved';
    if (title.includes('rejected')) return 'Leave rejected';
    return 'Leave pending approval';
  }
  if (type === 'REIMBURSEMENT') {
    if (title.includes('rejected')) return 'Expense rejected';
    return 'Expense approved';
  }
  if (type === 'TICKET') {
    if (title.includes('resolved') || title.includes('closed')) return 'Helpdesk ticket resolved';
    return 'Helpdesk ticket updated';
  }
  if (type === 'BIRTHDAY' || title.includes('birthday')) return 'Birthday reminder (to HR)';
  if (type === 'ANNIVERSARY' || title.includes('anniversary')) return 'Work anniversary reminder';
  return EVENT_BY_TYPE[type] || null;
};

/** Honor Settings → Notifications & Email. No saved config = keep sending (current default). */
const filterItemsForEmail = async (items = []) => {
  const eligible = (items || []).filter((i) => i?.user_id && !i.skipEmail);
  if (!eligible.length) return [];

  const ids = [...new Set(eligible.map((i) => i.user_id))];
  const { data: emps } = await supabaseAdmin
    .from('employees')
    .select('id, company_id')
    .in('id', ids);
  const companyByUser = new Map((emps || []).map((e) => [e.id, e.company_id]));
  const configByCompany = new Map();
  const settingsService = require('./settings.service');

  const allowed = [];
  for (const item of eligible) {
    const cid = companyByUser.get(item.user_id);
    if (!configByCompany.has(cid)) {
      configByCompany.set(cid, await settingsService.getSetting('notification_config', null, cid));
    }
    const cfg = configByCompany.get(cid);
    if (!cfg || typeof cfg !== 'object') {
      allowed.push(item);
      continue;
    }
    if (cfg.smtp && cfg.smtp.enabled === false) continue;
    const event = resolveTriggerEvent(item);
    const trigger = event && Array.isArray(cfg.triggers)
      ? cfg.triggers.find((t) => t.event === event)
      : null;
    if (trigger && trigger.email === false) continue;
    allowed.push(item);
  }
  return allowed;
};

const getEmployeeMap = async (userIds) => {
  const unique = [...new Set((userIds || []).filter(Boolean))];
  if (!unique.length) return new Map();
  const { data } = await supabaseAdmin
    .from('employees')
    .select('id, email, first_name, last_name, is_active')
    .in('id', unique);
  const map = new Map();
  for (const emp of data || []) {
    if (emp.email && emp.is_active !== false) map.set(emp.id, emp);
  }
  return map;
};

/** Send email copies for in-app notifications (non-blocking). */
const dispatchNotificationEmails = async (items = []) => {
  const eligible = await filterItemsForEmail(items);
  if (!eligible.length) return;

  const employeeMap = await getEmployeeMap(eligible.map((i) => i.user_id));
  for (const item of eligible) {
    const employee = employeeMap.get(item.user_id);
    if (!employee?.email) continue;
    notificationEmail(employee, {
      title: item.title,
      message: item.message,
      link: item.link,
      type: item.type,
    }).catch((err) => {
      logger.warn('Notification email failed', { userId: item.user_id, error: err.message });
    });
  }
};

const createNotification = async ({
  user_id,
  type,
  title,
  message,
  link = null,
  meta = {},
  skipEmail = false,
}) => {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id,
      type,
      title,
      message,
      link,
      meta,
      is_read: false,
    })
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);

  dispatchNotificationEmails([{
    user_id, type, title, message, link, skipEmail,
  }]).catch(() => {});

  return data;
};

/** Fan-out the same notification shape to many users (batch insert). */
const createNotifications = async (items = []) => {
  const normalized = (items || []).filter((i) => i?.user_id);
  const rows = normalized.map(({
    user_id, type, title, message, link = null, meta = {},
  }) => ({
    user_id,
    type,
    title,
    message,
    link,
    meta,
    is_read: false,
  }));
  if (!rows.length) return [];
  const { data, error } = await supabaseAdmin.from('notifications').insert(rows).select();
  if (error) throw new BadRequestError(error.message);

  dispatchNotificationEmails(normalized).catch(() => {});

  return data || [];
};

const listMyNotifications = async (userId, query) => {
  const { page, limit, offset } = paginate(query);
  let dbQuery = supabaseAdmin
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.unread === '1') dbQuery = dbQuery.eq('is_read', false);

  const { data, error, count } = await dbQuery;
  if (error) throw new BadRequestError(error.message);
  return { data: data || [], meta: buildMeta(page, limit, count) };
};

const getUnreadCount = async (userId) => {
  const { count, error } = await supabaseAdmin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);
  if (error) throw new BadRequestError(error.message);
  return count || 0;
};

const markRead = async (userId, id) => {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const markAllRead = async (userId) => {
  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);
  if (error) throw new BadRequestError(error.message);
  return true;
};

module.exports = {
  createNotification,
  createNotifications,
  listMyNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
};

