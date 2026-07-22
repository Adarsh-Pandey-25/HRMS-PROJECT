const { supabaseAdmin } = require('../config/supabase');
const { uploadTrainingMaterial } = require('../services/storage.service');
const { trainingAssignmentEmail } = require('../services/email.service');
const attendanceService = require('../services/attendance.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { BadRequestError, NotFoundError } = require('../utils/errors');

const create = async (req, res, next) => {
  try {
    let materialsUrl = null;
    if (req.file) {
      const { path } = await uploadTrainingMaterial(req.file);
      materialsUrl = path;
    }

    const { data, error } = await supabaseAdmin
      .from('trainings')
      .insert({
        ...req.body,
        materials_url: materialsUrl,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Training created', data, null, 201);
  } catch (err) { next(err); }
};

const allTrainings = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req.query);
    const { data, error, count } = await supabaseAdmin
      .from('trainings')
      .select('*', { count: 'exact' })
      .order('start_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Trainings fetched', data, buildMeta(page, limit, count));
  } catch (err) { next(err); }
};

const myTrainings = async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('employee_trainings')
      .select('*, training:training_id(*)')
      .eq('employee_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'My trainings fetched', data);
  } catch (err) { next(err); }
};

const assign = async (req, res, next) => {
  try {
    const { training_id, employee_ids } = req.body;
    const assignments = [];

    for (const employeeId of employee_ids) {
      const { data, error } = await supabaseAdmin
        .from('employee_trainings')
        .upsert({
          training_id,
          employee_id: employeeId,
          assigned_by: req.user.id,
          status: 'assigned',
        }, { onConflict: 'training_id,employee_id' })
        .select('*, employee:employee_id(id, first_name, last_name, email, employee_code, department), training:training_id(*)')
        .single();

      if (!error && data?.employee && data?.training) {
        trainingAssignmentEmail(data.employee, data.training).catch(() => {});
        assignments.push(data);
      }
    }

    successResponse(res, 'Training assigned', assignments, null, 201);
  } catch (err) { next(err); }
};

const complete = async (req, res, next) => {
  try {
    const { feedback, rating } = req.body;
    const { data, error } = await supabaseAdmin
      .from('employee_trainings')
      .update({
        status: 'completed',
        completion_date: new Date().toISOString(),
        feedback,
        rating,
      })
      .eq('training_id', req.params.id)
      .eq('employee_id', req.user.id)
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Training marked complete', data);
  } catch (err) { next(err); }
};

const participants = async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('employee_trainings')
      .select('*, employee:employee_id(id, first_name, last_name, employee_code, department)')
      .eq('training_id', req.params.id);

    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Participants fetched', data);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from('trainings').delete().eq('id', req.params.id);
    if (error) throw new BadRequestError(error.message);
    successResponse(res, 'Training deleted');
  } catch (err) { next(err); }
};

module.exports = {
  create, allTrainings, myTrainings, assign, complete, participants, remove,
};
