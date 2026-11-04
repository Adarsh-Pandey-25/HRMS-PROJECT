const { supabaseAdmin } = require('../config/supabase');
const { getConfig, canSend } = require('../config/whatsapp');
const logger = require('../utils/logger');

/**
 * WhatsApp starts by itself on the live server, with no button for anyone
 * (owner's decision, 4 Nov 2026: "after deploy automatically whole WhatsApp
 * integration start"). Every 10 minutes:
 * - message templates Meta doesn't have yet are submitted, as Templates →
 *   Submit to Meta does (never a resubmission);
 * - once Meta has approved the existing-employee message, each active
 *   company with WhatsApp on (the add-on, and HR/admin's switch in
 *   Settings → Integrations → WhatsApp) has its employees connected to the
 *   mobile numbers on file, and that message goes to them first. Left out:
 *   people already connected, people who stopped or disconnected before,
 *   and people without a valid mobile — someone whose number is added
 *   later is connected at the next check.
 * New employees are connected when HR adds them (whatsappLink.service).
 * At most CONNECT_AT_ONCE first messages a day: until the business is
 * verified, Meta limits how many people it can message in a day.
 * Only on the live server with scheduled jobs on — never on a PC.
 */

const FIRST_CHECK_AFTER_MS = 60 * 1000;
const CHECK_EVERY_MS = 10 * 60 * 1000;
// Once every template is at Meta, looked at again a few times a day (a deploy may add one).
const TEMPLATES_AGAIN_AFTER_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

let firstTimer = null;
let timer = null;
let running = false;
let templatesDoneAt = 0;

/** Submits the templates Meta doesn't have; one that failed is tried again at the next check. */
const submitMissingTemplates = async () => {
  if (Date.now() - templatesDoneAt < TEMPLATES_AGAIN_AFTER_MS) return;
  const results = await require('./whatsappAdmin.service').syncTemplates();
  const submitted = results.filter((r) => r?.result === 'submitted').map((r) => r.name);
  const failed = results.filter((r) => r?.result === 'error').map((r) => r.name);
  const invalid = results.filter((r) => r?.result === 'not_sent').map((r) => r.name);
  if (submitted.length) logger.info(`[WhatsApp] submitted to Meta by itself: ${submitted.join(', ')}`);
  if (invalid.length) logger.warn('[WhatsApp] templates with problems were not submitted', { invalid });
  if (failed.length) logger.warn('[WhatsApp] Meta refused some templates; trying again in 10 minutes', { failed });
  else templatesDoneAt = Date.now();
};

/** First messages queued in the last 24 hours: each is a new person in Meta's daily count. */
const firstMessagesToday = async (environment) => {
  const { count, error } = await supabaseAdmin
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('environment', environment)
    .eq('event_key', 'whatsapp_connected')
    .gte('created_at', new Date(Date.now() - DAY_MS).toISOString());
  if (error) throw new Error(error.message);
  return count || 0;
};

/** Connects every company's existing employees once Meta has approved their first message. */
const connectExisting = async (cfg) => {
  // Required here: these modules need each other.
  const linkService = require('./whatsappLink.service');
  const approvals = require('./whatsappApprovals.service');
  if (!(await approvals.isApprovedAtMeta(linkService.FIRST_MESSAGE.existing))) return 0;
  let room = linkService.CONNECT_AT_ONCE - (await firstMessagesToday(cfg.environment));
  if (room <= 0) return 0;
  const { data: companies, error } = await supabaseAdmin.from('companies').select('id, is_active');
  if (error) throw new Error(error.message);
  let total = 0;
  for (const company of companies || []) {
    if (room <= 0) break;
    if (company.is_active === false) continue;
    // eslint-disable-next-line no-await-in-loop
    if (!(await linkService.companyWhatsappOn(company.id))) continue;
    // eslint-disable-next-line no-await-in-loop
    const { ready } = await linkService.connectCandidates(company.id);
    if (!ready.length) continue;
    // eslint-disable-next-line no-await-in-loop
    const { connected } = await linkService.connectExistingEmployees(company.id, { limit: room, source: 'auto:connect_existing' });
    if (connected) logger.info(`[WhatsApp] ${connected} existing employees connected by themselves`, { companyId: company.id });
    room -= connected;
    total += connected;
  }
  return total;
};

const check = async () => {
  if (running) return;
  running = true;
  try {
    const cfg = getConfig();
    if (!cfg.production || !canSend(cfg) || !cfg.wabaId) return;
    // Paused by a super admin (Super Admin → WhatsApp): wait.
    if ((await require('./whatsappSettings.service').getPlatformState(cfg.environment)).paused) return;
    try {
      await submitMissingTemplates();
    } catch (err) {
      logger.warn('[WhatsApp] could not submit templates; trying again in 10 minutes', { error: err?.title || err?.message });
    }
    try {
      await connectExisting(cfg);
    } catch (err) {
      logger.warn('[WhatsApp] could not connect existing employees; trying again in 10 minutes', { error: err?.title || err?.message });
    }
  } catch (err) {
    logger.warn('[WhatsApp] start-up check failed', { error: err?.message });
  } finally {
    running = false;
  }
};

/** Started with the sender (whatsappWorker.start): only on the live server, with scheduled jobs on. */
const start = () => {
  if (timer) return;
  if (!getConfig().production || process.env.DISABLE_CRONS === 'true') return;
  firstTimer = setTimeout(() => { check().catch(() => {}); }, FIRST_CHECK_AFTER_MS);
  timer = setInterval(() => { check().catch(() => {}); }, CHECK_EVERY_MS);
  for (const t of [firstTimer, timer]) if (typeof t.unref === 'function') t.unref();
  logger.info('[WhatsApp] starts by itself: new templates go to Meta, and employees are connected once their first message is approved');
};

const stop = () => {
  if (firstTimer) clearTimeout(firstTimer);
  if (timer) clearInterval(timer);
  firstTimer = null;
  timer = null;
};

module.exports = {
  start, stop, check, submitMissingTemplates, connectExisting, firstMessagesToday,
};
