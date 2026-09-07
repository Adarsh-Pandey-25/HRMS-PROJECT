const { ForbiddenError } = require('../utils/errors');
const { getExportAuthorization } = require('../services/exportGate.service');
const { getCompanyId } = require('../utils/tenant');

/**
 * Reusable guard for a genuine BULK/administrative data-export backend
 * endpoint (never for normal list/view endpoints — those must stay open,
 * per item 6.6). Drop this on any future server-side bulk-export or
 * bulk-download route (e.g. a server-generated ZIP of every payslip).
 *
 * Investigated first, as instructed: every current "export" in this app
 * (Settings > Data & Backup, employee/attendance/payroll/reports/leave/
 * expenses/assets/helpdesk exports) reformats data CLIENT-SIDE from
 * already-fetched, already-authorized-to-view list data — there is no
 * dedicated backend export endpoint to attach this to today (confirmed by
 * a full grep of backend/src/routes + backend/src/controllers; the one
 * real backend file-download endpoint, payroll.controller.js's
 * downloadPayslip, is single-record and explicitly excluded from this
 * rule). Real enforcement for those 12 lives in the shared ExportButton
 * component + exportAllData.js instead, both backed by the SAME
 * getExportAuthorization() check this middleware also uses — see
 * GET /companies/me/export-status.
 */
const requireGoodStanding = () => async (req, res, next) => {
  try {
    const companyId = req.user?.company_id || getCompanyId(req.user);
    const { allowed } = await getExportAuthorization(companyId);
    if (!allowed) {
      throw new ForbiddenError(
        "Data export is unavailable while your subscription is not in good standing. Contact your account administrator or billing to resolve this.",
      );
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireGoodStanding };
