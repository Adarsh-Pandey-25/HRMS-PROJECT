const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError } = require('../utils/errors');
const { paginate, buildMeta } = require('../utils/helpers');

const createNotification = async ({
  user_id,
  type,
  title,
  message,
  link = null,
  meta = {},
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
  return data;
};

/** Fan-out the same notification shape to many users (batch insert). */
const createNotifications = async (items = []) => {
  const rows = (items || []).filter((i) => i?.user_id).map(({
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

