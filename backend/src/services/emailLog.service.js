const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError } = require('../utils/errors');
const { paginate, buildMeta } = require('../utils/helpers');
const { getEmailType, AUDIENCE, describeCatalog } = require('./emailCatalog');

/**
 * Super-admin Email Log: every email the platform sent, skipped or failed to
 * send, written by email.service.js's sendEmail. An audit aid — it records
 * who got which email and why, never the body.
 */

const STATUSES = ['sent', 'mock', 'failed', 'skipped'];

/** Applies the shared filters to a query on email_log. */
const applyFilters = (query, { companyId, type, status, recipient, from, to }) => {
  let q = query;
  if (companyId === 'platform') q = q.is('company_id', null);
  else if (companyId) q = q.eq('company_id', companyId);
  if (type) q = q.eq('email_type', type);
  if (status) q = q.eq('status', status);
  // ilike on a caller-supplied string: strip the PostgREST/LIKE metacharacters
  // rather than letting them reshape the filter.
  if (recipient) {
    const safe = String(recipient).replace(/[%_,()*\\]/g, '').trim();
    if (safe) q = q.ilike('recipient', `%${safe}%`);
  }
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lte('created_at', to);
  return q;
};

const listEmailLog = async (filters = {}, pageQuery = {}) => {
  if (filters.status && !STATUSES.includes(filters.status)) {
    throw new BadRequestError(`status must be one of ${STATUSES.join(', ')}`);
  }
  const { page, limit, offset } = paginate(pageQuery);

  const { data, error, count } = await applyFilters(
    supabaseAdmin.from('email_log').select('*', { count: 'exact' }),
    filters,
  )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    // The migration may simply not be applied yet — say so plainly instead
    // of surfacing a raw PostgREST "relation does not exist".
    if (/email_log/.test(error.message) && /(does not exist|not find)/i.test(error.message)) {
      throw new BadRequestError('Email log is not set up yet — run migration 20260930_email_log_and_preferences.sql.');
    }
    throw new BadRequestError(error.message);
  }

  // Status totals for the same filters, ignoring the status filter itself,
  // so the screen can show "sent 120 · skipped 4 · failed 1" while one
  // status is selected.
  const { status: _ignored, ...withoutStatus } = filters;
  const counts = await Promise.all(STATUSES.map(async (s) => {
    const { count: c } = await applyFilters(
      supabaseAdmin.from('email_log').select('id', { count: 'exact', head: true }),
      { ...withoutStatus, status: s },
    );
    return [s, c || 0];
  }));

  const companyIds = [...new Set((data || []).map((r) => r.company_id).filter(Boolean))];
  const companyNames = new Map();
  if (companyIds.length) {
    const { data: companies } = await supabaseAdmin.from('companies').select('id, name').in('id', companyIds);
    for (const c of companies || []) companyNames.set(c.id, c.name);
  }

  const rows = (data || []).map((row) => {
    const entry = getEmailType(row.email_type);
    return {
      ...row,
      company_name: row.company_id ? (companyNames.get(row.company_id) || null) : null,
      email_label: entry?.label || row.email_type,
      trigger: entry?.trigger || null,
      audience_label: AUDIENCE[row.audience] || row.audience || null,
    };
  });

  return { rows, meta: buildMeta(page, limit, count || 0), statusCounts: Object.fromEntries(counts) };
};

module.exports = { listEmailLog, describeCatalog, STATUSES };
