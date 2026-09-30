const emailLogService = require('../services/emailLog.service');
const { successResponse } = require('../utils/helpers');

const listEmailLog = async (req, res, next) => {
  try {
    const { rows, meta, statusCounts } = await emailLogService.listEmailLog(
      {
        companyId: req.query.company_id,
        type: req.query.type,
        status: req.query.status,
        recipient: req.query.recipient,
        from: req.query.from,
        to: req.query.to,
      },
      req.query,
    );
    // Rows as `data` and the totals in `meta`, the shape every other
    // paginated endpoint uses — the client's paginated helper expects data
    // to be the array and would otherwise quietly return nothing.
    successResponse(res, 'Email log fetched', rows, { ...meta, statusCounts });
  } catch (err) { next(err); }
};

/** Which email goes to whom, for what — straight from emailCatalog.js. */
const getEmailCatalog = async (req, res, next) => {
  try {
    successResponse(res, 'Email catalogue fetched', emailLogService.describeCatalog());
  } catch (err) { next(err); }
};

module.exports = { listEmailLog, getEmailCatalog };
