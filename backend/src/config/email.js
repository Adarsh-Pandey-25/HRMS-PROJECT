const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const smtpPass = () => String(process.env.SMTP_PASSWORD || '').replace(/\s+/g, '');

const onRender = Boolean(process.env.RENDER || process.env.NODE_ENV === 'production');

const buildTransport = ({ port, secure }) =>
  nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    requireTLS: !secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: smtpPass(),
    },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 20_000,
    tls: { minVersion: 'TLSv1.2' },
  });

const smtpAttempts = () => {
  const configured = parseInt(process.env.SMTP_PORT, 10);
  const forceSecure = process.env.SMTP_SECURE === 'true';
  // Render often blocks/times out SMTP 587 STARTTLS. Prefer 465 SSL in production.
  if (configured) {
    const first = { port: configured, secure: forceSecure || configured === 465 };
    const second = configured === 465
      ? { port: 587, secure: false }
      : { port: 465, secure: true };
    return [first, second];
  }
  if (onRender) {
    return [
      { port: 465, secure: true },
      { port: 587, secure: false },
    ];
  }
  return [{ port: 587, secure: false }];
};

/** Cached only for local/dev helpers; sendMail uses sendWithFallback. */
let transporter = null;

const createTransporter = () => {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    logger.warn('SMTP not configured. Email notifications will be logged only.');
    return null;
  }
  const [first] = smtpAttempts();
  transporter = buildTransport(first);
  return transporter;
};

const sendViaResend = async (mail) => {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: mail.from,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.message || `Resend HTTP ${res.status}`);
  }
  logger.info('Email sent via Resend', { id: body.id });
  return { success: true, messageId: body.id, mock: false };
};

/**
 * Every email opens its own SMTP connection, so a burst — an announcement to
 * the whole company fired at once — opened dozens in parallel and the mail
 * server (Google) refused about half with "421 Temporary System Problem".
 * Two guards, for every email the app sends:
 *  - at most SMTP_MAX_PARALLEL (default 3) sends in flight at a time; the
 *    rest queue in order;
 *  - an SMTP "try again later" answer (any 4xx code) is retried after
 *    2s, 6s and 15s before the email counts as failed. Nothing was accepted
 *    by the server in that case, so a retry cannot send it twice.
 */
const MAX_PARALLEL = Math.max(1, parseInt(process.env.SMTP_MAX_PARALLEL, 10) || 3);
const RETRY_DELAYS_MS = [2000, 6000, 15000];
let inFlight = 0;
const waiting = [];
const acquireSlot = () => new Promise((resolve) => {
  if (inFlight < MAX_PARALLEL) { inFlight += 1; resolve(); } else { waiting.push(resolve); }
});
const releaseSlot = () => {
  const next = waiting.shift();
  if (next) next(); else inFlight -= 1; // hand the slot straight to the next in line
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The server answered "not now" (SMTP 4xx) rather than "never" (5xx). */
const isTemporaryRefusal = (err) => {
  const code = Number(err?.responseCode);
  if (code >= 400 && code < 500) return true;
  return /^4\d\d[ -]/.test(String(err?.response || '')) || /\b4\d\d[- ]4\.\d\.\d\b/.test(String(err?.message || ''));
};

const sendWithFallback = async (mail) => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    if (process.env.RESEND_API_KEY) return sendViaResend(mail);
    logger.info('Email (mock)', { subject: String(mail.subject || '').slice(0, 80) });
    return { success: true, mock: true };
  }

  // Render's free web services block all outbound SMTP traffic (ports 25/465/587),
  // so every SMTP attempt there is guaranteed to time out (~12s each) no matter how
  // correct the credentials are. Skip straight to the HTTP API instead of stalling
  // requests (e.g. employee creation awaits this) for ~25s before falling back.
  if (onRender && process.env.RESEND_API_KEY) {
    return sendViaResend(mail);
  }

  for (let attempt = 0; ; attempt += 1) {
    await acquireSlot();
    try {
      return await sendOverSmtp(mail);
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !isTemporaryRefusal(err)) throw err;
      logger.warn('SMTP said try again later — retrying', { attempt: attempt + 1, inMs: RETRY_DELAYS_MS[attempt], error: err.message });
    } finally {
      releaseSlot();
    }
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
};

const sendOverSmtp = async (mail) => {
  let lastErr;
  // A "try again later" from any port decides the outcome — otherwise an
  // unrelated error from the fallback port would hide it and skip the retry.
  let temporary = null;
  for (const attempt of smtpAttempts()) {
    try {
      const t = buildTransport(attempt);
      const info = await t.sendMail(mail);
      logger.info('Email sent', { port: attempt.port, messageId: info.messageId });
      return { success: true, messageId: info.messageId, mock: false };
    } catch (err) {
      lastErr = err;
      if (!temporary && isTemporaryRefusal(err)) temporary = err;
      logger.warn('SMTP attempt failed', { port: attempt.port, error: err.message });
    }
  }

  try {
    const viaApi = await sendViaResend(mail);
    if (viaApi) return viaApi;
  } catch (err) {
    lastErr = err;
    logger.warn('Resend API failed', { error: err.message });
  }

  throw temporary || lastErr;
};

module.exports = { createTransporter, sendWithFallback, buildTransport, isTemporaryRefusal };
