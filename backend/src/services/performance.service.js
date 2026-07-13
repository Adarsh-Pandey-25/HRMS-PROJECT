const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError } = require('../utils/errors');

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

const teamReviewsForManager = async (managerId) => {
  const { data, error } = await supabaseAdmin
    .from('performance_reviews')
    .select('*, employee:employee_id(id, first_name, last_name)')
    .eq('manager_id', managerId)
    .order('created_at', { ascending: false });
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const createGoal = async (employeeId, body) => {
  const { data, error } = await supabaseAdmin
    .from('performance_goals')
    .insert({ employee_id: employeeId, progress: 0, status: 'on_track', ...body })
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const updateGoal = async (id, patch) => {
  const { data, error } = await supabaseAdmin
    .from('performance_goals')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Goal not found');
  return data;
};

module.exports = {
  myGoals,
  listCycles,
  teamReviewsForManager,
  createGoal,
  updateGoal,
};
