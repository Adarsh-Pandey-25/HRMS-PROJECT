const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const { DEFAULT_COMPANY_ID, getCompanyId } = require('../utils/tenant');
const notificationService = require('./notification.service');
const tenantService = require('./tenant.service');

const emptyId = '00000000-0000-0000-0000-000000000000';

const resolveCompanyId = (companyId) => companyId || DEFAULT_COMPANY_ID;

const listTickets = async (query = {}, companyEmployeeIds = null, companyId = null) => {
  let db = supabaseAdmin
    .from('helpdesk_tickets')
    .select('*, comments:helpdesk_ticket_comments(*)')
    .order('created_at', { ascending: false });
  if (companyId) db = db.eq('company_id', resolveCompanyId(companyId));
  if (query.raised_by) db = db.eq('raised_by', query.raised_by);
  if (query.status) db = db.eq('status', query.status);
  if (!companyId && companyEmployeeIds && !query.raised_by) {
    db = db.in('raised_by', companyEmployeeIds.length ? companyEmployeeIds : [emptyId]);
  }
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

const createTicket = async (employeeId, body, companyId = null) => {
  let cid = companyId;
  if (!cid) {
    const { data: emp } = await supabaseAdmin
      .from('employees')
      .select('id, company_id, address')
      .eq('id', employeeId)
      .maybeSingle();
    cid = getCompanyId(emp);
  }
  let slaHours = 48;
  try {
    const settingsService = require('./settings.service');
    const cfg = await settingsService.getSetting('helpdesk_config', null, resolveCompanyId(cid));
    const map = cfg?.slaHours || cfg?.sla_hours || {};
    const key = String(body.priority || 'medium').toLowerCase();
    const hours = Number(map[key] ?? map.medium ?? 48);
    if (Number.isFinite(hours) && hours > 0) slaHours = hours;
  } catch {
    /* keep default */
  }
  const slaDue = new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();
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
      company_id: resolveCompanyId(cid),
    })
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);

  const resolvedCid = resolveCompanyId(cid);
  try {
    const { data: employee } = await supabaseAdmin
      .from('employees')
      .select('first_name, last_name')
      .eq('id', employeeId)
      .maybeSingle();
    const name = `${employee?.first_name || ''} ${employee?.last_name || ''}`.trim() || 'An employee';
    const hrIds = await tenantService.getCompanyHrAdminIds(resolvedCid);
    await notificationService.createNotifications(
      hrIds
        .filter((id) => id !== employeeId)
        .map((user_id) => ({
          user_id,
          type: 'TICKET',
          title: 'New helpdesk ticket',
          message: `${name} raised: ${data.subject}`,
          link: '/helpdesk/all',
          meta: { ticket_id: data.id },
        })),
    );
  } catch {
    /* notifications must not block ticket creation */
  }

  return { ...data, comments: [] };
};

const updateTicketStatus = async (id, status, companyEmployeeIds = null, companyId = null) => {
  if (companyId || companyEmployeeIds) {
    let q = supabaseAdmin.from('helpdesk_tickets').select('raised_by, company_id').eq('id', id);
    if (companyId) q = q.eq('company_id', resolveCompanyId(companyId));
    const { data: existing } = await q.maybeSingle();
    if (!existing) throw new NotFoundError('Ticket not found');
    if (companyEmployeeIds && !companyEmployeeIds.includes(existing.raised_by)) {
      throw new NotFoundError('Ticket not found');
    }
  }
  const patch = { status };
  if (['resolved', 'closed'].includes(status)) patch.resolved_at = new Date().toISOString();
  let upd = supabaseAdmin.from('helpdesk_tickets').update(patch).eq('id', id);
  if (companyId) upd = upd.eq('company_id', resolveCompanyId(companyId));
  const { data, error } = await upd.select('*, raised_by, subject').single();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Ticket not found');

  if (data.raised_by) {
    try {
      const isResolved = ['resolved', 'closed'].includes(String(status).toLowerCase());
      await notificationService.createNotification({
        user_id: data.raised_by,
        type: 'TICKET',
        title: isResolved ? 'Ticket resolved' : 'Ticket updated',
        message: `Your ticket "${data.subject}" is now ${status}.`,
        link: '/helpdesk/me',
        meta: { ticket_id: data.id, status },
      });
    } catch {
      /* non-blocking */
    }
  }

  return data;
};

const addComment = async (id, comment, companyEmployeeIds = null, companyId = null) => {
  let ticket = null;
  if (companyId || companyEmployeeIds) {
    let q = supabaseAdmin.from('helpdesk_tickets').select('raised_by, company_id, subject').eq('id', id);
    if (companyId) q = q.eq('company_id', resolveCompanyId(companyId));
    const { data: existing } = await q.maybeSingle();
    if (!existing) throw new NotFoundError('Ticket not found');
    ticket = existing;
    if (companyEmployeeIds && !companyEmployeeIds.includes(existing.raised_by)) {
      throw new NotFoundError('Ticket not found');
    }
  } else {
    const { data: existing } = await supabaseAdmin
      .from('helpdesk_tickets')
      .select('raised_by, company_id, subject')
      .eq('id', id)
      .maybeSingle();
    ticket = existing;
  }

  const { error: cErr } = await supabaseAdmin.from('helpdesk_ticket_comments').insert({
    ticket_id: id,
    author_id: comment.by,
    text: comment.text,
  });
  if (cErr) throw new BadRequestError(cErr.message);

  if (ticket) {
    try {
      if (ticket.raised_by && ticket.raised_by !== comment.by) {
        await notificationService.createNotification({
          user_id: ticket.raised_by,
          type: 'TICKET',
          title: 'New reply on your ticket',
          message: `Support replied on "${ticket.subject}".`,
          link: '/helpdesk/me',
          meta: { ticket_id: id },
        });
      } else if (ticket.raised_by === comment.by) {
        const hrIds = await tenantService.getCompanyHrAdminIds(ticket.company_id);
        await notificationService.createNotifications(
          hrIds
            .filter((uid) => uid !== comment.by)
            .map((user_id) => ({
              user_id,
              type: 'TICKET',
              title: 'Ticket updated',
              message: `New comment on "${ticket.subject}".`,
              link: '/helpdesk/all',
              meta: { ticket_id: id },
            })),
        );
      }
    } catch {
      /* non-blocking */
    }
  }

  const all = await listTickets({}, companyEmployeeIds, companyId);
  return all.find((t) => t.id === id) || null;
};

const logger = require('../utils/logger');

const DEFAULT_KB_ARTICLES = [
  {
    category: 'it',
    title: 'How to set up VPN on your laptop',
    content: 'Download the company VPN client from the IT portal. Install it, sign in with your work email, and connect before accessing internal tools. If connection fails, verify your password and ensure you are not on a restricted network. Contact IT via Helpdesk if you need a new activation link.',
    views: 342,
  },
  {
    category: 'it',
    title: 'Resetting your work email password',
    content: 'Go to Login → Forgot password and follow the email OTP flow. New passwords must include uppercase, lowercase, a number, and a special character. After reset, sign out of all devices and sign in again. If you are locked out, raise an IT ticket with your employee ID.',
    views: 218,
  },
  {
    category: 'it',
    title: 'Requesting a new laptop or monitor',
    content: 'Raise an Asset Request from Assets → Asset Requests (employees) or assign from Asset Inventory (HR/Admin). Include your role, reason, and urgency. Standard hardware is usually provisioned within 3–5 business days after manager approval.',
    views: 156,
  },
  {
    category: 'payroll',
    title: 'Understanding your salary breakup',
    content: 'Your payslip shows Basic, HRA, DA, allowances, and statutory deductions (PF, PT, TDS, ESI where applicable). Net pay = Gross − Total deductions. LOP reduces earnings when attendance or leave rules apply. Download the published PDF from Payroll → My Payslips or Run Payroll (HR).',
    views: 511,
  },
  {
    category: 'payroll',
    title: 'When will my payslip be available?',
    content: 'Payslips are generated after payroll is run for the month and published by HR/Admin. You receive an in-app notification when your payslip is ready. Published slips can be downloaded as PDF from the salary sheet or My Payslips page.',
    views: 287,
  },
  {
    category: 'payroll',
    title: 'Updating bank account for salary credit',
    content: 'Submit updated bank proof (cancelled cheque or bank letter) to HR through Documents or a Helpdesk ticket tagged Payroll. Changes apply from the next payroll cycle after verification. Ensure account name matches your legal name on record.',
    views: 194,
  },
  {
    category: 'leave',
    title: 'How to apply for leave and approval flow',
    content: 'Open Leave → Apply Leave, choose leave type, dates, and reason, then submit. Your manager (and HR for certain types) receives the request in Leave → Approvals. You can track status under My Leaves. Approved leave reflects on your attendance calendar automatically.',
    views: 289,
  },
  {
    category: 'leave',
    title: 'Leave balance and LOP rules',
    content: 'Check Leave → My Leaves for available balance by type. Unapproved absence or exhausted balance may result in Loss of Pay (LOP), which affects payroll. Holiday calendar shows company holidays. For corrections, use Attendance → Regularization or contact HR.',
    views: 203,
  },
  {
    category: 'benefits',
    title: 'Health insurance coverage explained',
    content: 'Corporate health cover includes employee + dependents as per your grade and policy year. Pre-existing conditions may have a waiting period—see the policy PDF in Documents. For cashless claims, use network hospitals listed in the insurer portal. Raise a Benefits ticket for card or enrollment issues.',
    views: 198,
  },
  {
    category: 'benefits',
    title: 'Provident Fund (PF) and tax declarations',
    content: 'PF is deducted as per statutory rates on eligible wages. Submit investment proofs and tax declarations before the payroll cut-off date each financial year. HR publishes deadlines via Announcements. Use Payroll settings for TDS and component queries.',
    views: 167,
  },
  {
    category: 'onboarding',
    title: 'First week checklist for new joiners',
    content: 'Day 1: Complete profile, upload KYC, and read company policies. Day 2–3: Attend orientation and IT setup (email, VPN, assets). Day 4–5: Meet your manager, review goals, and complete mandatory training in the Course Catalog. Mark attendance daily from Attendance → My Attendance.',
    views: 156,
  },
  {
    category: 'onboarding',
    title: 'Who to contact during onboarding',
    content: 'HR: documents, leave policy, and benefits. IT/Helpdesk: laptop, access, and software. Your manager: role expectations and team introductions. Admin: payroll setup and org-wide announcements. Use Helpdesk → Raise Ticket if you are unsure which team owns your request.',
    views: 124,
  },
];

const ensureKbArticlesSeeded = async (companyId) => {
  const cid = resolveCompanyId(companyId);
  const { count, error: countErr } = await supabaseAdmin
    .from('kb_articles')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', cid);
  if (countErr) throw new BadRequestError(countErr.message);
  if (count > 0) return;

  const today = new Date().toISOString().slice(0, 10);
  const rows = DEFAULT_KB_ARTICLES.map((a) => ({
    category: a.category,
    title: a.title,
    content: a.content,
    views: a.views || 0,
    updated_on: today,
    company_id: cid,
  }));

  const { error } = await supabaseAdmin.from('kb_articles').insert(rows);
  if (error) throw new BadRequestError(error.message);
  logger.info('KB articles seeded for company', { companyId: cid, count: rows.length });
};

const listKbCategories = async (companyId) => {
  const cid = resolveCompanyId(companyId);
  await ensureKbArticlesSeeded(cid);

  const [{ data: cats, error: catErr }, { data: articles, error: artErr }] = await Promise.all([
    supabaseAdmin.from('kb_categories').select('*').order('name'),
    supabaseAdmin.from('kb_articles').select('category').eq('company_id', cid),
  ]);
  if (catErr) throw new BadRequestError(catErr.message);
  if (artErr) throw new BadRequestError(artErr.message);

  const counts = {};
  (articles || []).forEach((a) => {
    counts[a.category] = (counts[a.category] || 0) + 1;
  });

  return (cats || []).map((c) => ({
    id: c.id,
    name: c.name,
    count: counts[c.id] || 0,
  }));
};

const listKbArticles = async (category, companyId) => {
  const cid = resolveCompanyId(companyId);
  await ensureKbArticlesSeeded(cid);

  let db = supabaseAdmin
    .from('kb_articles')
    .select('*')
    .eq('company_id', cid)
    .order('updated_on', { ascending: false });
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
