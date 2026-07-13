const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError } = require('../utils/errors');

const listTickets = async (query = {}) => {
  let db = supabaseAdmin
    .from('helpdesk_tickets')
    .select('*, comments:helpdesk_ticket_comments(*)')
    .order('created_at', { ascending: false });
  if (query.raised_by) db = db.eq('raised_by', query.raised_by);
  if (query.status) db = db.eq('status', query.status);
  const { data, error } = await db;
  if (error) throw new BadRequestError(error.message);
  return (data || []).map((t) => ({
    ...t,
    comments: (t.comments || []).map((c) => ({
      by: c.author_id,
      text: c.text,
      at: c.created_at,
    })),
  }));
};

const createTicket = async (employeeId, body) => {
  const slaDue = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('helpdesk_tickets')
    .insert({
      raised_by: employeeId,
      subject: body.subject,
      category: body.category || 'it',
      priority: body.priority || 'medium',
      description: body.description || '',
      status: 'open',
      sla_due_by: slaDue,
    })
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  return { ...data, comments: [] };
};

const updateTicketStatus = async (id, status) => {
  const patch = { status };
  if (['resolved', 'closed'].includes(status)) patch.resolved_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('helpdesk_tickets').update(patch).eq('id', id).select().single();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Ticket not found');
  return data;
};

const addComment = async (id, comment) => {
  const { error: cErr } = await supabaseAdmin.from('helpdesk_ticket_comments').insert({
    ticket_id: id,
    author_id: comment.by,
    text: comment.text,
  });
  if (cErr) throw new BadRequestError(cErr.message);
  const tickets = await listTickets({});
  return tickets.find((t) => t.id === id) || null;
};

const listKbCategories = async () => {
  const { data, error } = await supabaseAdmin.from('kb_categories').select('*').order('name');
  if (error) throw new BadRequestError(error.message);
  return (data || []).map((c) => ({ id: c.id, name: c.name, count: c.article_count }));
};

const listKbArticles = async (category) => {
  let db = supabaseAdmin.from('kb_articles').select('*').order('updated_on', { ascending: false });
  if (category) db = db.eq('category', category);
  const { data, error } = await db;
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

module.exports = {
  listTickets,
  createTicket,
  updateTicketStatus,
  addComment,
  listKbCategories,
  listKbArticles,
};
