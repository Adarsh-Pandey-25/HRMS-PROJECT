const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError } = require('../utils/errors');

/** EMP001, EMP002, … (at least 3 digits; grows naturally after 999). */
const formatEmployeeCode = (n) => `EMP${String(n).padStart(3, '0')}`;

/**
 * Next human-facing employee code for a company: EMP001, EMP002, …
 * Unique per company — each company has its own sequence starting at 1.
 * Prefers the atomic DB function; falls back to max(EMP#) + 1 if RPC is missing.
 */
const allocateNextEmployeeCode = async (companyId) => {
  if (!companyId) throw new BadRequestError('Company is required to allocate employee code');

  const { data, error } = await supabaseAdmin.rpc('next_employee_code', {
    p_company_id: companyId,
  });

  if (!error && data) return data;

  const { data: rows, error: qErr } = await supabaseAdmin
    .from('employees')
    .select('employee_code')
    .eq('company_id', companyId);

  if (qErr) throw new BadRequestError(qErr.message || error?.message || 'Failed to allocate employee code');

  let max = 0;
  for (const row of rows || []) {
    const match = /^EMP(\d+)$/i.exec(String(row.employee_code || ''));
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }

  return formatEmployeeCode(max + 1);
};

module.exports = {
  allocateNextEmployeeCode,
  formatEmployeeCode,
};
