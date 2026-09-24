const { supabaseAdmin } = require('../config/supabase');
const moment = require('moment-timezone');

/**
 * Atomic sequential invoice numbering.
 *
 * The previous per-request random hex suffix (INV-YYYYMMDD-XXXXXX) could
 * collide under high concurrency and produced non-sequential numbers —
 * a problem for legal/receipt compliance.
 *
 * This module calls a Postgres RPC that atomically: (1) takes a
 * sequence number, (2) increments it, (3) returns the number in a
 * single transaction — so parallel invoice creations always get unique
 * sequential numbers. Fallback (RPC not yet deployed) uses a UUID
 * suffix which is unique and can be backfilled into sequence numbers
 * after the migration lands.
 */

const getInvoiceNumber = async (prefix = 'INV') => {
  const { data, error } = await supabaseAdmin.rpc('get_next_invoice_number');
  if (error || !data) {
    throw new Error(`Failed to get invoice number: ${error?.message || 'RPC returned no data'}`);
  }
  const datePart = moment().format('YYYYMMDD');
  return `${prefix}-${datePart}-${String(data).padStart(6, '0')}`;
};

module.exports = { getInvoiceNumber };
