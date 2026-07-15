const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

const myGoals = async (employeeId) => {
  const { data, error } = await supabaseAdmin
    .from('performance_goals')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const listCycles = async () => {
  const { data, error } = await supabaseAdmin.from('review_cycles').select('*').order('start_date', { ascending: false });
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const createCycle = async (body) => {
  const name = String(body.name || '').trim();
  if (!name) throw new BadRequestError('Cycle name is required');
  const payload = {
    name,
    status: body.status || 'active',
    start_date: body.start_date || body.startDate || null,
    end_date: body.end_date || body.endDate || null,
    participants: Number(body.participants) || 0,
  };
  const { data, error } = await supabaseAdmin.from('review_cycles').insert(payload).select().single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const teamReviewsForManager = async (managerId) => {
  const { data, error } = await supabaseAdmin
    .from('performance_reviews')
    .select('*, employee:employee_id(id, first_name, last_name, department, designation)')
    .eq('manager_id', managerId)
    .order('created_at', { ascending: false });
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

/** Open pending reviews for direct reports against the active (or given) cycle */
const openTeamReviews = async (managerId, cycleId) => {
  let cycle = null;
  if (cycleId) {
    const { data } = await supabaseAdmin.from('review_cycles').select('*').eq('id', cycleId).maybeSingle();
    cycle = data;
  }
  if (!cycle) {
    const { data } = await supabaseAdmin
      .from('review_cycles')
      .select('*')
      .eq('status', 'active')
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    cycle = data;
  }
  if (!cycle) throw new BadRequestError('Create an active review cycle first');

  const { data: reports, error: repErr } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('manager_id', managerId)
    .eq('is_active', true);
  if (repErr) throw new BadRequestError(repErr.message);
  if (!reports?.length) throw new BadRequestError('No direct reports found');

  const { data: existing } = await supabaseAdmin
    .from('performance_reviews')
    .select('employee_id')
    .eq('manager_id', managerId)
    .eq('cycle_id', cycle.id);

  const have = new Set((existing || []).map((r) => r.employee_id));
  const toInsert = reports.filter((r) => !have.has(r.id)).map((r) => ({
    employee_id: r.id,
    manager_id: managerId,
    cycle_id: cycle.id,
    status: 'pending',
    progress: 0,
    score: null,
  }));

  if (toInsert.length) {
    const { error } = await supabaseAdmin.from('performance_reviews').insert(toInsert);
    if (error) throw new BadRequestError(error.message);
    await supabaseAdmin
      .from('review_cycles')
      .update({ participants: (existing?.length || 0) + toInsert.length })
      .eq('id', cycle.id);
  }

  return teamReviewsForManager(managerId);
};

const updateReview = async (reviewId, managerId, patch) => {
  const { data: review } = await supabaseAdmin
    .from('performance_reviews')
    .select('*')
    .eq('id', reviewId)
    .maybeSingle();
  if (!review) throw new NotFoundError('Review not found');
  if (review.manager_id !== managerId) throw new ForbiddenError('Not your review');

  const updates = { };
  if (patch.score != null) updates.score = Number(patch.score);
  if (patch.progress != null) updates.progress = Number(patch.progress);
  if (patch.status) updates.status = patch.status;
  if (updates.score != null && !updates.status) updates.status = 'completed';

  const { data, error } = await supabaseAdmin
    .from('performance_reviews')
    .update(updates)
    .eq('id', reviewId)
    .select('*, employee:employee_id(id, first_name, last_name, department, designation)')
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const createGoal = async (employeeId, body) => {
  const title = String(body.title || '').trim();
  if (!title) throw new BadRequestError('Goal title is required');
  const payload = {
    employee_id: employeeId,
    title,
    cycle: body.cycle || null,
    progress: Math.min(100, Math.max(0, Number(body.progress) || 0)),
    status: body.status || 'on_track',
    due_date: body.due_date || body.dueDate || null,
  };
  const { data, error } = await supabaseAdmin
    .from('performance_goals')
    .insert(payload)
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const updateGoal = async (id, employeeId, patch, isPrivileged) => {
  const { data: existing } = await supabaseAdmin
    .from('performance_goals')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!existing) throw new NotFoundError('Goal not found');
  if (!isPrivileged && existing.employee_id !== employeeId) {
    throw new ForbiddenError('Not authorized');
  }

  const updates = { updated_at: new Date().toISOString() };
  if (patch.title != null) updates.title = String(patch.title).trim();
  if (patch.cycle != null) updates.cycle = patch.cycle;
  if (patch.due_date != null || patch.dueDate != null) updates.due_date = patch.due_date || patch.dueDate;
  if (patch.progress != null) updates.progress = Math.min(100, Math.max(0, Number(patch.progress)));
  if (patch.status != null) updates.status = patch.status;

  const { data, error } = await supabaseAdmin
    .from('performance_goals')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

module.exports = {
  myGoals,
  listCycles,
  createCycle,
  teamReviewsForManager,
  openTeamReviews,
  updateReview,
  createGoal,
  updateGoal,
};
