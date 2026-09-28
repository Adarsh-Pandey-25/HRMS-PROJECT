const { randomUUID } = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const moment = require('moment-timezone');
const logger = require('../utils/logger');

/**
 * Atomic sequential invoice numbering.
 *
 * The previous per-request random hex suffix (INV-YYYYMMDD-XXXXXX) could
 * collide under high concurrency and produced non-sequential numbers —
 * a problem for legal/receipt compliance.
 *
 * This module calls a Postgres RPC that atomically takes and increments
 * `subscription_invoice_seq` (see 20260917_invoice_number_sequence.sql),
 * so parallel invoice creations always get unique sequential numbers.
 *
 * Fallback: if that RPC is unavailable — migration not applied yet, or the
 * sequence missing — we emit a UUID-suffixed number instead of throwing.
 * Billing an invoice with an ugly-but-unique number is strictly better than
 * failing the subscription activation/renewal that triggered it. Every
 * fallback is logged at error level so it can be backfilled later.
 */

const datePart = () => moment().format('YYYYMMDD');

/** Unique, obviously-not-sequential suffix so fallback rows are easy to find. */
const fallbackNumber = (prefix) => `${prefix}-${datePart()}-F${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

const getInvoiceNumber = async (prefix = 'INV') => {
  try {
    const { data, error } = await supabaseAdmin.rpc('get_next_invoice_number');
    if (error) throw new Error(error.message);
    if (data === null || data === undefined) throw new Error('RPC returned no data');
    return `${prefix}-${datePart()}-${String(data).padStart(6, '0')}`;
  } catch (err) {
    const number = fallbackNumber(prefix);
    logger.error(
      '[InvoiceNumber] Sequence RPC failed — issued a non-sequential fallback number. '
      + 'Apply 20260917_invoice_number_sequence.sql (it creates subscription_invoice_seq), '
      + 'then renumber any INV-*-F* rows.',
      { error: err.message, fallbackNumber: number },
    );
    return number;
  }
};

module.exports = { getInvoiceNumber };
