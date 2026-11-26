const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { isMissingColumnError } = require('../utils/helpers');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const { getTemplate } = require('./whatsappTemplates');

/**
 * Super Admin → WhatsApp → Templates: an On / Off switch for each message
 * (owner's request, 26 Nov 2026). Off means nobody, in any company, gets
 * that WhatsApp message: it is not queued (whatsappOutbox.service.js), and
 * one already waiting is skipped (whatsappWorker.js). Emails and in-app
 * notifications are not affected, and nothing changes until a super admin
 * switches something off.
 *
 * approval_request (Approve / Reject buttons) falls back to approval_waiting:
 * with it off, approvers get the plain approval_waiting message instead, and
 * with both off, nothing.
 *
 * Stored per environment, like the pause, on
 * platform_whatsapp_state.template_switches: {"attendance_short_hours": false}.
 * A template not listed there is on. Until
 * 20261126_whatsapp_template_switches.sql has run, every template stays on
 * and the switches can't be saved.
 */

const SQL_FILE = '20261126_whatsapp_template_switches.sql';

// Never switched off: these are how a number gets connected and confirmed.
const FIRST_MESSAGE = 'The first message on a newly connected number. It tells the person they are connected and how to stop, so it always goes.';
const ALWAYS_ON = {
  welcome_new_employee: FIRST_MESSAGE,
  whatsapp_number_linked: FIRST_MESSAGE,
  hr_updates_on_whatsapp: FIRST_MESSAGE,
  whatsapp_verify_code: 'The code that confirms an approver’s WhatsApp number for the Approve / Reject buttons.',
};

const CACHE_MS = 15 * 1000;
const cache = new Map();

/** Only known, switchable templates that are off: { name: false }. */
const sanitize = (value) => {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [name, on] of Object.entries(value)) {
    if (on === false && getTemplate(name) && !ALWAYS_ON[name]) out[name] = false;
  }
  return out;
};

/**
 * { available, failed, off } for one environment. A read that fails for any
 * other reason than the missing column keeps every template on, as before
 * this switch existed, and is not trusted for saving.
 */
const readSwitches = async (environment) => {
  let data;
  let error;
  try {
    ({ data, error } = await supabaseAdmin
      .from('platform_whatsapp_state')
      .select('template_switches')
      .eq('environment', environment)
      .maybeSingle());
  } catch (err) {
    error = err;
  }
  if (error) {
    const missing = isMissingColumnError(error.message, 'template_switches');
    if (!missing) logger.warn('[WhatsApp] could not read the template switches; every template stays on', { error: error.message });
    return { available: !missing, failed: !missing, off: {} };
  }
  return { available: true, failed: false, off: sanitize(data?.template_switches) };
};

const getSwitches = async (environment, { fresh = false } = {}) => {
  const hit = cache.get(environment);
  if (!fresh && hit && hit.expires > Date.now()) return hit.value;
  const value = await readSwitches(environment);
  cache.set(environment, { value, expires: Date.now() + CACHE_MS });
  return value;
};

/** Is this template switched on? Always-on templates are, whatever is stored. */
const isOn = (switches, name) => Boolean(ALWAYS_ON[name]) || switches?.off?.[name] !== false;

/** May a message with this template go at all: it is on, or the plain message it falls back to is. */
const mayGo = (switches, template) => Boolean(template)
  && (isOn(switches, template.name) || Boolean(template.fallback && isOn(switches, template.fallback)));

/** Switches one template on or off; returns { name, enabled, before }. */
const setSwitch = async (environment, name, enabled) => {
  if (typeof enabled !== 'boolean') throw new BadRequestError('enabled must be true or false');
  const key = String(name || '');
  if (!getTemplate(key)) throw new NotFoundError('There is no WhatsApp template with that name');
  if (ALWAYS_ON[key]) throw new BadRequestError(`${key} is always on: ${ALWAYS_ON[key]}`);

  const current = await readSwitches(environment);
  if (!current.available) throw new BadRequestError(`Run ${SQL_FILE} in Supabase first, then try again.`);
  if (current.failed) throw new BadRequestError('Could not read the current switches. Nothing was changed; please try again.');

  const before = isOn(current, key);
  const off = { ...current.off };
  if (enabled) delete off[key];
  else off[key] = false;
  const { error } = await supabaseAdmin.from('platform_whatsapp_state').upsert({
    environment,
    template_switches: off,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'environment' });
  if (error) {
    logger.error('[WhatsApp] could not save a template switch', { template: key, error: error.message });
    throw new BadRequestError('Could not save the switch. Please try again.');
  }
  cache.delete(environment);
  return { name: key, enabled, before };
};

module.exports = {
  ALWAYS_ON,
  SQL_FILE,
  getSwitches,
  isOn,
  mayGo,
  setSwitch,
  _resetForTests: () => cache.clear(),
};
