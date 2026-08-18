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

const sendWithFallback = async (mail) => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    if (process.env.RESEND_API_KEY) return sendViaResend(mail);
    logger.info('Email (mock)', { subject: String(mail.subject || '').slice(0, 80) });
    return { success: true, mock: true };
  }

  let lastErr;
  for (const attempt of smtpAttempts()) {
    try {
      const t = buildTransport(attempt);
      const info = await t.sendMail(mail);
      logger.info('Email sent', { port: attempt.port, messageId: info.messageId });
      return { success: true, messageId: info.messageId, mock: false };
    } catch (err) {
      lastErr = err;
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

  throw lastErr;
};

module.exports = { createTransporter, sendWithFallback, buildTransport };
