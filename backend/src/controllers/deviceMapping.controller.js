const { supabaseAdmin } = require('../config/supabase');
const { successResponse } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');
const { DEFAULT_DEVICE_SERIAL } = require('../utils/constants');

const withEmployeeName = (row) => {
  const emp = row.employees;
  return {
    id: row.id,
    deviceUserId: row.device_user_id,
    deviceSerial: row.device_serial,
    employeeId: row.employee_id,
    employeeName: emp ? `${emp.first_name} ${emp.last_name}`.trim() : null,
    employeeCode: emp?.employee_code || null,
    createdAt: row.created_at,
  };
};

/** Only expose mappings/employees that belong to the requesting HR/Admin's company. */
const create = async (req, res, next) => {
  try {
    const { device_user_id: deviceUserId, employee_id: employeeId, device_serial: deviceSerial } = req.body || {};
    if (!deviceUserId || !employeeId) {
      throw new BadRequestError('device_user_id and employee_id are required');
    }
    const serial = deviceSerial || DEFAULT_DEVICE_SERIAL;

    const { data: employee, error: employeeError } = await supabaseAdmin
      .from('employees')
      .select('id, company_id')
      .eq('id', employeeId)
      .eq('company_id', req.user.company_id)
      .maybeSingle();
    if (employeeError) throw employeeError;
    if (!employee) throw new NotFoundError('Employee not found');

    const { data, error } = await supabaseAdmin
      .from('device_employee_mapping')
      .insert({ device_user_id: String(deviceUserId), employee_id: employeeId, device_serial: serial })
      .select('id, device_user_id, device_serial, employee_id, created_at, employees(first_name, last_name, employee_code)')
      .single();

    if (error) {
      if (error.code === '23505') throw new ConflictError('This device user ID is already mapped on this device');
      throw error;
    }

    successResponse(res, 'Mapping created', withEmployeeName(data), null, 201);
  } catch (err) { next(err); }
};

const list = async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('device_employee_mapping')
      .select('id, device_user_id, device_serial, employee_id, created_at, employees(first_name, last_name, employee_code, company_id)')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const scoped = (data || []).filter((row) => row.employees?.company_id === req.user.company_id);
    successResponse(res, 'Mappings fetched', scoped.map(withEmployeeName));
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const deviceUserId = req.params.deviceUserId;
    const deviceSerial = req.query.device_serial || DEFAULT_DEVICE_SERIAL;

    const { data: existing, error: findError } = await supabaseAdmin
      .from('device_employee_mapping')
      .select('id, employees(company_id)')
      .eq('device_user_id', deviceUserId)
      .eq('device_serial', deviceSerial)
      .maybeSingle();
    if (findError) throw findError;
    if (!existing || existing.employees?.company_id !== req.user.company_id) {
      throw new NotFoundError('Mapping not found');
    }

    const { error } = await supabaseAdmin.from('device_employee_mapping').delete().eq('id', existing.id);
    if (error) throw error;

    successResponse(res, 'Mapping removed');
  } catch (err) { next(err); }
};

/** Recent punches that arrived with no matching mapping, for devices this company has already mapped at least once. */
const unmapped = async (req, res, next) => {
  try {
    const { data: mapped, error: mappedError } = await supabaseAdmin
      .from('device_employee_mapping')
      .select('device_serial, employees!inner(company_id)')
      .eq('employees.company_id', req.user.company_id);
    if (mappedError) throw mappedError;

    const serials = [...new Set((mapped || []).map((m) => m.device_serial))];
    if (!serials.length) return successResponse(res, 'Unmapped punches', []);

    const { data, error } = await supabaseAdmin
      .from('device_punches')
      .select('id, device_user_id, punch_time, punch_type, verify_mode, device_serial')
      .is('employee_id', null)
      .in('device_serial', serials)
      .order('punch_time', { ascending: false })
      .limit(200);
    if (error) throw error;

    successResponse(res, 'Unmapped punches', data || []);
  } catch (err) { next(err); }
};

module.exports = { create, list, remove, unmapped };
