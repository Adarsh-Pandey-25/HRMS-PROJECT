const moment = require('moment-timezone');
const { sendWithFallback } = require('../config/email');
const logger = require('../utils/logger');

// ============================================================================
// DESIGN SYSTEM — "Premium v2"
// Ported from hrms_email_templates_premium.html (style/UX reference only —
// per-template copy, field names, and data all come from real objects
// below, not the reference's illustrative sample data).
//
// The reference uses CSS classes (.et-*) + a <style> block, and CSS Grid for
// stat rows / dual buttons / digest tables. Neither survives Gmail/Outlook
// reliably: Gmail strips <style> blocks in several contexts, and Outlook
// (Word rendering engine) doesn't support `display:grid` at all. Everything
// below is the same visual result, reimplemented as inline styles on
// <table>-based layouts — the same approach the previous version of this
// file already used successfully. No inliner library (e.g. juice) exists in
// this codebase's dependencies, so inline-at-the-source is the only reliable
// path without adding one.
// ============================================================================

const COLOR = {
  navy: '#0F172A', navySoft: '#1E293B', navyLine: '#334155',
  slate: '#64748B', slateSoft: '#94A3B8',
  line: '#E2E8F0', bg: '#F1F5F9', paper: '#FAF9F6', white: '#FFFFFF', ink: '#374151',

  emerald: '#0D6E4F', emeraldBg: '#EAF5EF',
  rose: '#A23B55', roseBg: '#FBEEEE', roseDeep: '#9F1239',
  amber: '#AB6A17', amberBg: '#FBF4E9', amberDeep: '#92400E',
  sky: '#0E7C8C', skyBg: '#EAF3F4',
  violet: '#5B3A99', violetBg: '#F3F0F7', violetDeep: '#3730A3',
  blue: '#27408B', blueBg: '#EEF0F7',
  stone: '#57534E', stoneBg: '#FAFAF9',
  red: '#A3342F', redBg: '#FBEEEE',
};

// Header gradients per category, matching the reference exactly.
const GRADIENT = {
  emerald: 'linear-gradient(140deg,#064E3B 0%,#0D6E4F 60%,#5FB68C 100%)',
  emeraldSolid: 'linear-gradient(140deg,#064E3B 0%,#0D6E4F 100%)',
  navyBlue: 'linear-gradient(140deg,#0F172A 0%,#1E40AF 100%)',
  charcoal: 'linear-gradient(140deg,#1C1917 0%,#292524 50%,#44403C 100%)',
  charcoalSoft: 'linear-gradient(140deg,#1C1917 0%,#44403C 100%)',
  amber: 'linear-gradient(140deg,#78350F 0%,#AB6A17 100%)',
  amberDeep: 'linear-gradient(140deg,#713F12 0%,#8F6B12 100%)',
  slateDark: 'linear-gradient(140deg,#1E293B 0%,#334155 100%)',
  navySolid: 'linear-gradient(140deg,#0F172A 0%,#1E293B 100%)',
  blueDeep: 'linear-gradient(140deg,#1E3A5F 0%,#27408B 100%)',
  blueRoll: 'linear-gradient(140deg,#0F172A 0%,#1E3A5F 60%,#27408B 100%)',
  rose: 'linear-gradient(140deg,#881337 0%,#A23B55 100%)',
  sky: 'linear-gradient(140deg,#0C4A6E 0%,#0E7C8C 100%)',
  skyDeep: 'linear-gradient(140deg,#0C4A6E 0%,#106787 100%)',
  amberDigest: 'linear-gradient(140deg,#451A03 0%,#92400E 60%,#AB6A17 100%)',
  redAlert: 'linear-gradient(140deg,#7F1D1D 0%,#A3342F 100%)',
  violet: 'linear-gradient(140deg,#2E1065 0%,#5B3A99 100%)',
  violetDeep: 'linear-gradient(140deg,#1E1B4B 0%,#3B3486 100%)',
  violetRoll: 'linear-gradient(140deg,#1E1B4B 0%,#3730A3 60%,#3B3486 100%)',
};

const FONT_SANS = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONT_SERIF = "'Instrument Serif',Georgia,Cambria,'Times New Roman',serif";
const FONT_MONO = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const FONTS_LINK = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const getAppUrl = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

const monthName = (m) => MONTH_NAMES[(Number(m) - 1 + 12) % 12] || escapeHtml(m);

const formatCurrency = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return escapeHtml(value);
  return `&#8377;${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

const formatDate = (value, fmt = 'DD MMMM YYYY') => {
  if (!value) return '—';
  const m = moment(value);
  return m.isValid() ? m.format(fmt) : escapeHtml(value);
};

const fullName = (employee) => `${employee?.first_name || ''} ${employee?.last_name || ''}`.trim() || 'there';

// ── Core document shell ─────────────────────────────────────────────────────
// Header (gradient + eyebrow + serif title + icon), a white body card, footer.
const etDocument = ({ preheader = '', gradient, eyebrow, titleHtml, icon, bodyHtml, footerHtml }) => `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FONTS_LINK}</head>
  <body style="margin:0;padding:0;background-color:${COLOR.paper};">
    <span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:${COLOR.paper};">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLOR.paper};font-family:${FONT_SANS};">
      <tr>
        <td align="center" style="padding:28px 16px 36px;">
          <table role="presentation" width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;">
            <tr>
              <td style="background:${gradient};border-radius:12px 12px 0 0;padding:30px 32px 28px;position:relative;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#ffffff;opacity:0.65;font-family:${FONT_SANS};margin:0 0 8px;">${escapeHtml(eyebrow)}</div>
                      <div style="font-family:${FONT_SERIF};font-size:28px;font-weight:400;line-height:1.15;letter-spacing:-0.01em;color:#ffffff;">${titleHtml}</div>
                    </td>
                    <td width="54" style="vertical-align:middle;">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="54" height="54" style="background:rgba(255,255,255,0.15);border-radius:50%;">
                        <tr><td align="center" valign="middle" style="font-size:24px;line-height:54px;height:54px;">${icon}</td></tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:${COLOR.white};border-radius:0 0 12px 12px;padding:28px 32px;box-shadow:0 1px 2px rgba(15,23,42,0.04);">
                ${bodyHtml}
                ${footerHtml || etFooter()}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const etP = (html, opts = {}) =>
  `<p style="margin:0 0 12px;font-size:14px;line-height:1.75;color:${opts.color || COLOR.ink};font-weight:${opts.weight || 400};font-family:${FONT_SANS};">${html}</p>`;

/** Info/detail rows — table-based (not the reference's flex row) for email-client width reliability. */
const etInfo = (rows) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.paper};border-radius:9px;border:1px solid #F1F5F9;margin:20px 0;">
    ${rows.map((r, i) => `
      <tr>
        <td style="padding:9px 18px;${i < rows.length - 1 ? `border-bottom:1px solid #F1F5F9;` : ''}font-size:12px;color:${COLOR.slateSoft};font-weight:500;font-family:${FONT_SANS};white-space:nowrap;">${escapeHtml(r.label)}</td>
        <td align="right" style="padding:9px 18px;${i < rows.length - 1 ? `border-bottom:1px solid #F1F5F9;` : ''}font-size:13px;color:${COLOR.navy};font-weight:600;font-family:${r.mono ? FONT_MONO : FONT_SANS};letter-spacing:${r.mono ? '0.04em' : 'normal'};">${r.valueHtml ?? escapeHtml(r.value)}</td>
      </tr>
    `).join('')}
  </table>`;

const etCta = (url, label, bg = COLOR.navy) => `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0 4px;">
    <tr><td style="background-color:${bg};border-radius:9px;">
      <a href="${url}" style="display:block;text-align:center;padding:13px 28px;font-size:13.5px;font-weight:700;letter-spacing:-0.01em;color:#ffffff;text-decoration:none;font-family:${FONT_SANS};">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;

const etDualCta = (left, right) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 4px;">
    <tr>
      <td width="49%" style="background-color:${left.bg};border-radius:9px;">
        <a href="${left.url}" style="display:block;text-align:center;padding:13px 10px;font-size:13.5px;font-weight:700;color:#ffffff;text-decoration:none;font-family:${FONT_SANS};">${escapeHtml(left.label)}</a>
      </td>
      <td width="2%"></td>
      <td width="49%" style="background-color:${right.bg};border-radius:9px;">
        <a href="${right.url}" style="display:block;text-align:center;padding:13px 10px;font-size:13.5px;font-weight:700;color:#ffffff;text-decoration:none;font-family:${FONT_SANS};">${escapeHtml(right.label)}</a>
      </td>
    </tr>
  </table>`;

const etAlert = (html, { bg = COLOR.amberBg, color = COLOR.amberDeep, icon = '⚠' } = {}) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border-radius:8px;margin:16px 0;">
    <tr>
      <td width="30" style="padding:12px 0 12px 16px;font-size:15px;color:${color};vertical-align:top;">${icon}</td>
      <td style="padding:12px 16px 12px 6px;font-size:13px;line-height:1.6;color:${color};font-family:${FONT_SANS};">${html}</td>
    </tr>
  </table>`;

const etQuote = (text, { border = COLOR.slate, bg = COLOR.stoneBg, color = COLOR.ink } = {}) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
    <tr><td style="border-left:3px solid ${border};background:${bg};border-radius:0 8px 8px 0;padding:11px 16px;font-size:13px;line-height:1.65;font-style:italic;color:${color};font-family:${FONT_SERIF};">&ldquo;${escapeHtml(text)}&rdquo;</td></tr>
  </table>`;

/** 2 or 3-column stat grid, table-based. */
const etStats = (items) => {
  const w = Math.floor(100 / items.length);
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
    <tr>
      ${items.map((it, i) => `
        <td width="${w}%" style="${i < items.length - 1 ? 'padding-right:10px;' : ''}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.paper};border-radius:9px;border:1px solid #F1F5F9;">
            <tr><td align="center" style="padding:16px 8px;">
              <div style="font-size:26px;font-weight:800;letter-spacing:-0.04em;line-height:1;color:${it.color || COLOR.navy};font-family:${FONT_SANS};">${escapeHtml(it.num)}</div>
              <div style="font-size:11px;color:${COLOR.slateSoft};margin-top:5px;font-weight:500;font-family:${FONT_SANS};">${escapeHtml(it.label)}</div>
            </td></tr>
          </table>
        </td>
      `).join('')}
    </tr>
  </table>`;
};

const etList = (items) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;">
    ${items.map((it, i) => `
      <tr>
        <td width="30" style="padding:9px 0;${i < items.length - 1 ? 'border-bottom:1px solid #FAF9F6;' : ''}vertical-align:top;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="22" height="22" style="background:${it.iconBg || COLOR.stoneBg};border-radius:50%;">
            <tr><td align="center" valign="middle" style="font-size:10px;font-weight:800;color:${it.iconColor || COLOR.slate};line-height:22px;height:22px;font-family:${FONT_SANS};">${it.icon || '•'}</td></tr>
          </table>
        </td>
        <td style="padding:9px 0 9px 11px;${i < items.length - 1 ? 'border-bottom:1px solid #FAF9F6;' : ''}font-size:13.5px;color:${COLOR.ink};line-height:1.5;font-family:${FONT_SANS};">${it.html}</td>
      </tr>
    `).join('')}
  </table>`;

const etOtp = (code, expiryText, { bg = COLOR.violetBg, color = COLOR.violet } = {}) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" style="background:${bg};border-radius:12px;">
        <tr><td style="padding:22px 44px;text-align:center;">
          <div style="font-family:${FONT_MONO};font-size:36px;font-weight:700;letter-spacing:0.18em;line-height:1;color:${color};">${escapeHtml(code)}</div>
          <div style="font-size:11.5px;margin-top:8px;font-weight:600;letter-spacing:0.02em;color:${color};font-family:${FONT_SANS};">${escapeHtml(expiryText)}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>`;

/** Digest table — columns: [{label,width}], rows: [[cellHtml,...]]. */
const etTable = (columns, rows) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLOR.line};border-radius:9px;margin:18px 0;overflow:hidden;">
    <tr style="background:${COLOR.paper};">
      ${columns.map((c) => `<td width="${c.width || ''}" style="padding:9px 16px;font-size:10.5px;font-weight:700;color:${COLOR.slateSoft};letter-spacing:0.07em;text-transform:uppercase;border-bottom:1px solid ${COLOR.line};font-family:${FONT_SANS};">${escapeHtml(c.label)}</td>`).join('')}
    </tr>
    ${rows.map((cells, ri) => `
      <tr style="background:${ri % 2 === 1 ? '#FAFBFC' : COLOR.white};">
        ${cells.map((cellHtml, ci) => `<td width="${columns[ci]?.width || ''}" style="padding:11px 16px;${ri < rows.length - 1 ? `border-bottom:1px solid #F1F5F9;` : ''}font-size:12.5px;color:${COLOR.navySoft};font-family:${FONT_SANS};">${cellHtml}</td>`).join('')}
      </tr>
    `).join('')}
  </table>`;

const etBadge = (text, { bg = COLOR.stoneBg, color = COLOR.slate } = {}) =>
  `<span style="display:inline-block;background:${bg};color:${color};border-radius:20px;padding:2px 9px;font-size:11px;font-weight:700;letter-spacing:0.04em;font-family:${FONT_SANS};">${escapeHtml(text)}</span>`;

const etDividerLabel = (text) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
    <tr>
      <td style="font-size:11px;color:${COLOR.slateSoft};font-weight:600;letter-spacing:0.06em;text-transform:uppercase;font-family:${FONT_SANS};padding-bottom:6px;border-bottom:1px solid #F1F5F9;">${escapeHtml(text)}</td>
    </tr>
  </table>`;

const etSublink = (html) => `<p style="text-align:center;font-size:12px;color:${COLOR.slateSoft};margin:14px 0 0;font-family:${FONT_SANS};">${html}</p>`;

const etFooter = () => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:1px solid #F1F5F9;">
    <tr><td align="center" style="padding:20px 0 4px;">
      <div style="font-family:${FONT_SERIF};font-style:italic;font-size:14px;color:${COLOR.slateSoft};margin-bottom:4px;">HRMS</div>
      <div style="font-size:11px;color:${COLOR.slateSoft};line-height:1.8;font-family:${FONT_SANS};">Automated message &mdash; please don&rsquo;t reply to this email.</div>
    </td></tr>
  </table>`;

// ── Transport ────────────────────────────────────────────────────────────
const sendEmail = async ({ to, subject, html, text }) => {
  const redactTo = (addr) => {
    const s = String(addr || '');
    const at = s.indexOf('@');
    if (at < 1) return '[redacted]';
    return `${s[0]}***${s.slice(at)}`;
  };

  try {
    const info = await sendWithFallback({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    });
    if (info?.mock) {
      logger.info('Email (mock)', { to: redactTo(to), subject: String(subject || '').slice(0, 80) });
    }
    return { success: true, messageId: info?.messageId, mock: Boolean(info?.mock) };
  } catch (err) {
    logger.error('Email send failed', { to: redactTo(to), error: err.message });
    throw err;
  }
};

// ============================================================================
// ONBOARDING
// ============================================================================

/** Sent when an employee account is created (single create, or company-admin bootstrap). Real trigger: employee.controller.js create(), auth.service.js completeOnboarding(). */
const welcomeEmail = (employee, tempPassword) => {
  const rows = [
    { label: 'Employee ID', value: employee.employee_code },
    { label: 'Department', value: employee.department || '—' },
    { label: 'Designation', value: employee.designation || '—' },
    { label: 'Joining date', value: formatDate(employee.date_of_joining) },
  ];
  return sendEmail({
    to: employee.email,
    subject: `Welcome to HRMS, ${employee.first_name} — your account is ready`,
    html: etDocument({
      preheader: `Your HRMS account is ready, ${employee.first_name || ''}.`,
      gradient: GRADIENT.emerald,
      eyebrow: 'HRMS',
      titleHtml: `Welcome aboard,<br><em style="font-style:italic;">${escapeHtml(employee.first_name)}.</em>`,
      icon: '🎉',
      bodyHtml: `
        ${etP(`We&rsquo;re glad to have you with us. Your HRMS account is ready &mdash; it&rsquo;s your single place to manage attendance, leaves, payslips, and everything work-related.`)}
        ${etInfo(rows)}
        ${tempPassword ? etInfo([{ label: 'Login email', value: employee.email }, { label: 'Temporary password', valueHtml: `<span style="font-family:${FONT_MONO};letter-spacing:0.06em;font-size:12px;">${escapeHtml(tempPassword)}</span>` }]) : ''}
        ${tempPassword ? etAlert('You&rsquo;ll be asked to set your own password on first login.', { bg: COLOR.amberBg, color: COLOR.amberDeep }) : ''}
        ${etCta(`${getAppUrl()}/login`, 'Log in to HRMS', COLOR.emerald)}
      `,
    }),
  });
};

/** No real trigger exists — no cron computes "2 days before join date". Ready to wire once one is built. */
const prejoiningEmail = (employee, { reportTime, location, contactName, contactPhone, dressCode } = {}) =>
  sendEmail({
    to: employee.email,
    subject: `You join us in 2 days — here's what to know`,
    html: etDocument({
      preheader: `Your first day is coming up.`,
      gradient: GRADIENT.navyBlue,
      eyebrow: 'Joining in 2 days',
      titleHtml: `${escapeHtml(formatDate(employee.date_of_joining, 'dddd, D MMM'))}.<br><em style="font-style:italic;">We&rsquo;re ready for you.</em>`,
      icon: '📅',
      bodyHtml: `
        ${etP(`A quick note before your first day. Here&rsquo;s everything you need.`)}
        ${etInfo([
          { label: 'Report time', value: reportTime || '10:00 AM' },
          { label: 'Location', value: location || '—' },
          { label: 'Contact on arrival', value: contactName ? `${contactName}${contactPhone ? ' · ' + contactPhone : ''}` : '—' },
          { label: 'Dress code', value: dressCode || 'Business casual' },
        ])}
        ${etDividerLabel('Bring originals of')}
        ${etList([
          { icon: '✓', iconBg: COLOR.emeraldBg, iconColor: COLOR.emerald, html: 'Aadhaar + PAN card' },
          { icon: '✓', iconBg: COLOR.emeraldBg, iconColor: COLOR.emerald, html: "Last 3 months' salary slips" },
          { icon: '✓', iconBg: COLOR.emeraldBg, iconColor: COLOR.emerald, html: 'Educational certificates' },
          { icon: '✓', iconBg: COLOR.emeraldBg, iconColor: COLOR.emerald, html: 'Relieving letter from previous employer' },
        ])}
        ${etCta(`${getAppUrl()}/onboarding`, 'View Joining Guide', COLOR.blue)}
      `,
    }),
  });

/** No real trigger exists. Ready to wire to a joining-morning cron once built. tempPassword must come from the same 48h mechanism as bulk_import (see auth.service.js). */
const dayOneEmail = (employee, tempPassword, expiryHours = 48) =>
  sendEmail({
    to: employee.email,
    subject: `Good morning, ${employee.first_name} — your first day starts here`,
    html: etDocument({
      preheader: `Your first day starts here.`,
      gradient: GRADIENT.charcoal,
      eyebrow: `Day 1 · ${formatDate(employee.date_of_joining)}`,
      titleHtml: `Good morning,<br><em style="font-style:italic;">${escapeHtml(employee.first_name)}.</em>`,
      icon: '☀️',
      bodyHtml: `
        ${etP(`Today is the day. Your workspace is set up and your team is expecting you. Here are your login details.`)}
        ${etInfo([
          { label: 'Portal', value: getAppUrl().replace(/^https?:\/\//, '') },
          { label: 'Login', value: employee.email },
          { label: 'Temp password', valueHtml: `<span style="font-family:${FONT_MONO};letter-spacing:0.08em;font-size:12px;">${escapeHtml(tempPassword)}</span>` },
        ])}
        ${etAlert(`You&rsquo;ll be prompted to change your password on first login. Your temporary password expires in <strong>${expiryHours} hours</strong>.`, { bg: COLOR.amberBg, color: COLOR.amberDeep })}
        ${etCta(`${getAppUrl()}/login`, 'Open HRMS Portal', COLOR.navy)}
        ${etSublink('Start with your onboarding checklist after logging in.')}
      `,
    }),
  });

/** No real trigger exists — no cron checks pending onboarding_checklist items after N days. */
const checklistReminderEmail = (employee, pendingItems) =>
  sendEmail({
    to: employee.email,
    subject: `${employee.first_name}, ${pendingItems.length} onboarding task${pendingItems.length === 1 ? '' : 's'} still pending`,
    html: etDocument({
      preheader: `${pendingItems.length} onboarding tasks need your attention.`,
      gradient: GRADIENT.amber,
      eyebrow: 'Onboarding checklist',
      titleHtml: `${pendingItems.length} task${pendingItems.length === 1 ? '' : 's'} still<br><em style="font-style:italic;">need your attention.</em>`,
      icon: '📋',
      bodyHtml: `
        ${etP(`A few onboarding tasks are still open. Please complete them when you get a moment.`)}
        ${etList(pendingItems.map((label) => ({ icon: '!', iconBg: COLOR.amberBg, iconColor: COLOR.amber, html: escapeHtml(label) })))}
        ${etCta(`${getAppUrl()}/onboarding`, 'Complete My Checklist', COLOR.amber)}
      `,
    }),
  });

/** No real trigger exists — nothing currently fires when the last onboarding_checklist item completes. */
const onboardingCompleteEmail = (employee, { tasksDone, daysTaken } = {}) =>
  sendEmail({
    to: employee.email,
    subject: `You're fully onboarded, ${employee.first_name}`,
    html: etDocument({
      preheader: `All onboarding tasks complete.`,
      gradient: GRADIENT.emeraldSolid,
      eyebrow: 'Onboarding complete',
      titleHtml: `All done.<br><em style="font-style:italic;">You&rsquo;re set up.</em>`,
      icon: '✅',
      bodyHtml: `
        ${etP(`Every task on your checklist is complete. You now have full access to everything in the HRMS.`)}
        ${etStats([
          { num: tasksDone ?? '—', label: 'Tasks done', color: COLOR.emerald },
          { num: daysTaken ?? '—', label: 'Days taken', color: COLOR.emerald },
          { num: '100%', label: 'Complete', color: COLOR.emerald },
        ])}
        ${etCta(`${getAppUrl()}/dashboard`, 'Go to My Dashboard', COLOR.emerald)}
      `,
    }),
  });

// ============================================================================
// BULK IMPORT — existing staff migrated onto the platform (distinct from `welcome`)
// ============================================================================

/** Sent when an employee is created via the bulk-import flow (employee.controller.js create() with source:'bulk_import'), not the single-add form. */
const bulkImportEmail = (employee, tempPassword, { recordTypesLabel = 'Attendance & leave history', expiryHours = 48 } = {}) =>
  sendEmail({
    to: employee.email,
    subject: `Your HRMS account is ready`,
    html: etDocument({
      preheader: `Your HRMS account has been provisioned.`,
      gradient: GRADIENT.blueRoll,
      eyebrow: 'HRMS · System rollout',
      titleHtml: `Your HRMS account<br><em style="font-style:italic;">is ready, ${escapeHtml(employee.first_name)}.</em>`,
      icon: '🗂️',
      bodyHtml: `
        ${etP(`We&rsquo;re now managing attendance, leave, and payroll through HRMS. Everything already on your record stays intact &mdash; we&rsquo;ve simply given it a better home.`)}
        ${etInfo([
          { label: 'Employee ID', value: employee.employee_code },
          { label: 'Department', value: employee.department || '—' },
          { label: 'Employed since', value: formatDate(employee.date_of_joining) },
          { label: 'Records migrated', value: recordTypesLabel },
        ])}
        ${etDividerLabel('Your login details')}
        ${etInfo([
          { label: 'Login email', value: employee.email },
          { label: 'Temporary password', valueHtml: `<span style="font-family:${FONT_MONO};letter-spacing:0.06em;font-size:12px;">${escapeHtml(tempPassword)}</span>` },
        ])}
        ${etP(`Log in with the details above. You&rsquo;ll be asked to set your own password on first login &mdash; nothing else to re-enter.`)}
        ${etAlert(`This temporary password expires in <strong>${expiryHours} hours</strong>. Please log in and set your own before then.`, { bg: COLOR.amberBg, color: COLOR.amberDeep })}
        ${etCta(`${getAppUrl()}/login`, 'Login to My Account', COLOR.blue)}
        ${etAlert('Notice something off in your migrated records? Contact HR &mdash; corrections are quick to make.', { bg: COLOR.blueBg, color: '#1E3A5F', icon: 'ℹ' })}
      `,
    }),
  });

// ============================================================================
// OFFBOARDING
// ============================================================================

/** Wired: employee.controller.js offboard(). */
const offboardingInitiatedEmail = (employee, { resignationDate, noticePeriodDays, lastWorkingDay } = {}) =>
  sendEmail({
    to: employee.email,
    subject: 'Your resignation has been accepted — next steps',
    html: etDocument({
      preheader: 'Your resignation has been accepted.',
      gradient: GRADIENT.slateDark,
      eyebrow: 'Offboarding',
      titleHtml: `Your resignation<br><em style="font-style:italic;">has been accepted.</em>`,
      icon: '📤',
      bodyHtml: `
        ${etP(`We&rsquo;ve received and accepted your resignation. Thank you for everything you&rsquo;ve contributed.`)}
        ${etInfo([
          { label: 'Resignation date', value: formatDate(resignationDate) },
          { label: 'Notice period', value: noticePeriodDays ? `${noticePeriodDays} days` : '—' },
          { label: 'Last working day', value: formatDate(lastWorkingDay) },
        ])}
        ${etP('Complete your exit checklist before your last day to ensure a smooth final settlement.')}
        ${etCta(`${getAppUrl()}/employees/${employee.id}`, 'View My Profile', COLOR.navySoft)}
      `,
    }),
  });

/** No exit-checklist tracking table exists yet. Sends a fixed, standard checklist rather than a dynamic tracked one — flagged as a real limitation, not fabricated data. */
const exitChecklistEmail = (employee, { lastWorkingDay, items } = {}) => {
  const defaultItems = [
    'Return laptop and accessories to IT',
    'Hand over project documentation',
    'Complete knowledge transfer',
    'Update bank account for final settlement',
    'Return access card & ID badge',
  ];
  return sendEmail({
    to: employee.email,
    subject: `Exit checklist — before ${formatDate(lastWorkingDay)}`,
    html: etDocument({
      preheader: 'Your exit checklist.',
      gradient: GRADIENT.charcoalSoft,
      eyebrow: `Last working day · ${formatDate(lastWorkingDay)}`,
      titleHtml: `Exit checklist.<br><em style="font-style:italic;">${(items || defaultItems).length} tasks.</em>`,
      icon: '📝',
      bodyHtml: `
        ${etP('Your final settlement will be processed only after all items below are cleared.')}
        ${etList((items || defaultItems).map((label) => ({ icon: '○', iconBg: COLOR.stoneBg, iconColor: COLOR.slate, html: escapeHtml(label) })))}
        ${etCta(`${getAppUrl()}/employees/${employee.id}`, 'View My Profile', '#44403C')}
      `,
    }),
  });
};

/** No full & final settlement calculation exists in this codebase (no gratuity/leave-encashment engine). Template accepts a computed amount — building that computation is a separate payroll feature, not invented here. */
const finalSettlementEmail = (employee, { lastWorkingDay, settlementDate, bankLast4, netPayable } = {}) =>
  sendEmail({
    to: employee.email,
    subject: 'Your full & final settlement has been processed',
    html: etDocument({
      preheader: 'Your final settlement has been processed.',
      gradient: GRADIENT.blueDeep,
      eyebrow: 'Full & final settlement',
      titleHtml: `Payment has been<br><em style="font-style:italic;">processed.</em>`,
      icon: '💳',
      bodyHtml: `
        ${etP('Your full & final settlement has been calculated and payment initiated to your registered bank account.')}
        ${etInfo([
          { label: 'Last working day', value: formatDate(lastWorkingDay) },
          { label: 'Settlement date', value: formatDate(settlementDate) },
          { label: 'Credited to', value: bankLast4 ? `···· ${bankLast4}` : '—' },
          { label: 'Net payable', valueHtml: `<span style="color:${COLOR.emerald};font-size:15px;">${formatCurrency(netPayable)}</span>` },
        ])}
        ${etCta(`${getAppUrl()}/employees/${employee.id}`, 'View My Documents', COLOR.blue)}
        ${etP(`It was a pleasure having you with us. All the best.`, { color: COLOR.slateSoft })}
      `,
    }),
  });

/** Wired: employee.controller.js offboard() finalization / deactivate(). */
const accountDeactivatedEmail = (employee, { docsUntil } = {}) =>
  sendEmail({
    to: employee.email,
    subject: 'Your HRMS access has been deactivated',
    html: etDocument({
      preheader: 'Your HRMS access has been deactivated.',
      gradient: GRADIENT.navySolid,
      eyebrow: `${formatDate(new Date())}`,
      titleHtml: `Access<br><em style="font-style:italic;">deactivated.</em>`,
      icon: '🔒',
      bodyHtml: `
        ${etP('Your HRMS access has been deactivated as of your last working day.')}
        ${etP('If you need any documents — payslips, letters — contact HR within 30 days.')}
        ${etInfo([{ label: 'Document access until', value: docsUntil ? formatDate(docsUntil) : '—' }])}
        ${etP('Thank you for everything. Wishing you the very best.', { color: COLOR.slateSoft })}
      `,
    }),
  });

// ============================================================================
// ATTENDANCE — employee-only alerts + regularization decisions
// ============================================================================

/** Wired: attendanceAnomaly.service.js, via attendanceAnomaly.cron.js. */
const attendanceAbsentAlertEmail = (employee, dateLabel) =>
  sendEmail({
    to: employee.email,
    subject: `Attendance: no check-in on ${dateLabel}`,
    html: etDocument({
      preheader: `You did not check in on ${dateLabel}.`,
      gradient: GRADIENT.rose,
      eyebrow: 'Attendance alert',
      titleHtml: `No check-in<br><em style="font-style:italic;">${escapeHtml(dateLabel)}</em>`,
      icon: '⚠️',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(employee.first_name || 'there')}, we didn&rsquo;t receive an attendance record for you on ${escapeHtml(dateLabel)}, and you weren&rsquo;t on approved leave that day.`)}
        ${etP('If this is a mistake, submit a regularization request explaining what happened.')}
        ${etAlert('This will be counted as a Loss of Pay (LOP) day if not resolved before payroll processing.', { bg: COLOR.roseBg, color: COLOR.roseDeep, icon: 'ℹ' })}
        ${etCta(`${getAppUrl()}/attendance/regularize`, 'Submit Regularization Request', COLOR.rose)}
      `,
    }),
  });

const attendanceLateAlertEmail = (employee, dateLabel, minutesLate) =>
  sendEmail({
    to: employee.email,
    subject: `Attendance: marked late on ${dateLabel}`,
    html: etDocument({
      preheader: `You were marked late by ${minutesLate} minutes on ${dateLabel}.`,
      gradient: GRADIENT.amber,
      eyebrow: 'Attendance alert',
      titleHtml: `Late check-in<br><em style="font-style:italic;">${escapeHtml(dateLabel)}</em>`,
      icon: '🕐',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(employee.first_name || 'there')}, your check-in on ${escapeHtml(dateLabel)} was recorded ${escapeHtml(String(minutesLate))} minutes past your shift&rsquo;s start time (plus grace period).`)}
        ${etP('If there was a valid reason, submit a regularization request.')}
        ${etCta(`${getAppUrl()}/attendance/regularize`, 'Submit Regularization Request', COLOR.amber)}
      `,
    }),
  });

const attendanceShortHoursAlertEmail = (employee, dateLabel, workedHours, expectedHours) =>
  sendEmail({
    to: employee.email,
    subject: `Attendance: short hours on ${dateLabel}`,
    html: etDocument({
      preheader: `You worked ${workedHours}h on ${dateLabel}, short of your expected ${expectedHours}h.`,
      gradient: GRADIENT.amberDeep,
      eyebrow: 'Attendance alert',
      titleHtml: `Short hours<br><em style="font-style:italic;">${escapeHtml(dateLabel)}</em>`,
      icon: '⏱️',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(employee.first_name || 'there')}, you worked ${escapeHtml(String(workedHours))}h on ${escapeHtml(dateLabel)}, short of your expected ${escapeHtml(String(expectedHours))}h shift.`)}
        ${etP('If there was a valid reason, submit a regularization request.')}
        ${etCta(`${getAppUrl()}/attendance/regularize`, 'Submit Regularization Request', '#8F6B12')}
      `,
    }),
  });

/** Wired: helpdesk.controller.js updateStatus() — regularization requests are helpdesk tickets (category 'hr', subject-prefixed), 'resolved' status fires this. */
const regularizationApprovedEmail = (employee, { dateLabel, checkIn, checkOut, approverName } = {}) =>
  sendEmail({
    to: employee.email,
    subject: `Attendance regularization approved — ${dateLabel}`,
    html: etDocument({
      preheader: 'Your regularization request was approved.',
      gradient: GRADIENT.emeraldSolid,
      eyebrow: 'Request approved',
      titleHtml: `Attendance<br><em style="font-style:italic;">regularized.</em>`,
      icon: '✅',
      bodyHtml: `
        ${etP(`Your regularization request has been reviewed and approved. Your attendance for ${escapeHtml(dateLabel)} has been updated.`)}
        ${etInfo([
          { label: 'Date', value: dateLabel },
          { label: 'Updated check-in', value: checkIn || '—' },
          { label: 'Updated check-out', value: checkOut || '—' },
          { label: 'Approved by', value: approverName || '—' },
          { label: 'New status', valueHtml: etBadge('Present', { bg: COLOR.emeraldBg, color: COLOR.emerald }) },
        ])}
        ${etCta(`${getAppUrl()}/attendance/me`, 'View Attendance', COLOR.emerald)}
      `,
    }),
  });

const regularizationRejectedEmail = (employee, { dateLabel, approverName, reason } = {}) =>
  sendEmail({
    to: employee.email,
    subject: `Attendance regularization not approved — ${dateLabel}`,
    html: etDocument({
      preheader: 'Your regularization request was not approved.',
      gradient: GRADIENT.rose,
      eyebrow: 'Request not approved',
      titleHtml: `Regularization<br><em style="font-style:italic;">for ${escapeHtml(dateLabel)}</em>`,
      icon: '✗',
      bodyHtml: `
        ${etP(`Your attendance regularization request for ${escapeHtml(dateLabel)} has not been approved.`)}
        ${etInfo([{ label: 'Reviewed by', value: approverName || '—' }, { label: 'Decision', valueHtml: etBadge('Rejected', { bg: COLOR.roseBg, color: COLOR.rose }) }])}
        ${reason ? etQuote(reason, { border: COLOR.rose, bg: COLOR.roseBg, color: COLOR.roseDeep }) : ''}
        ${etCta(`${getAppUrl()}/leave/apply`, 'Apply Leave Instead', COLOR.rose)}
      `,
    }),
  });

// ============================================================================
// LEAVE
// ============================================================================

/** Wired: leave.controller.js apply() — was previously never called despite existing. */
const leaveAppliedEmail = (employee, leave, { balanceAfterApproval } = {}) =>
  sendEmail({
    to: employee.email,
    subject: `Leave request submitted — ${formatDate(leave.from_date, 'D MMM')}–${formatDate(leave.to_date, 'D MMM YYYY')}`,
    html: etDocument({
      preheader: 'Your leave request has been submitted.',
      gradient: GRADIENT.sky,
      eyebrow: 'Leave request',
      titleHtml: `Submitted.<br><em style="font-style:italic;">Pending approval.</em>`,
      icon: '📨',
      bodyHtml: `
        ${etP(`Your leave request has been submitted. Your manager will be notified and you&rsquo;ll receive a decision by email.`)}
        ${etInfo([
          { label: 'Leave type', value: leave.leave_type },
          { label: 'From', value: formatDate(leave.from_date) },
          { label: 'To', value: formatDate(leave.to_date) },
          { label: 'Duration', value: `${leave.total_days} day${Number(leave.total_days) === 1 ? '' : 's'}` },
          ...(balanceAfterApproval != null ? [{ label: 'Balance after approval', value: `${balanceAfterApproval} days` }] : []),
          { label: 'Status', valueHtml: etBadge('Pending', { bg: COLOR.skyBg, color: COLOR.sky }) },
        ])}
        ${etCta(`${getAppUrl()}/leave/me`, 'View My Leave', COLOR.sky)}
      `,
    }),
  });

/** Wired: leave.controller.js apply(), sent to the manager (employee.manager_id). */
const leaveApprovalRequestEmail = (manager, employee, leave, { othersOnLeave = 0 } = {}) =>
  sendEmail({
    to: manager.email,
    subject: `Action needed: ${fullName(employee)} — leave ${formatDate(leave.from_date, 'D MMM')}–${formatDate(leave.to_date, 'D MMM')}`,
    html: etDocument({
      preheader: `${fullName(employee)} has requested leave.`,
      gradient: GRADIENT.blueDeep,
      eyebrow: 'Leave approval needed',
      titleHtml: `${escapeHtml(fullName(employee))}<br><em style="font-style:italic;">${escapeHtml(formatDate(leave.from_date, 'D MMM'))}–${escapeHtml(formatDate(leave.to_date, 'D MMM YYYY'))}</em>`,
      icon: '👤',
      bodyHtml: `
        ${etP('A direct report has submitted a leave request that needs your decision.')}
        ${etInfo([
          { label: 'Employee', value: `${fullName(employee)}${employee.department ? ' · ' + employee.department : ''}` },
          { label: 'Leave type', value: leave.leave_type },
          { label: 'Dates', value: `${formatDate(leave.from_date, 'D MMM')}–${formatDate(leave.to_date, 'D MMM YYYY')} (${leave.total_days} day${Number(leave.total_days) === 1 ? '' : 's'})` },
          { label: 'Reason', value: leave.reason || '—' },
          { label: 'Others on leave same day', value: `${othersOnLeave} teammate${othersOnLeave === 1 ? '' : 's'}` },
        ])}
        ${etDualCta({ label: 'Approve', url: `${getAppUrl()}/leave/approvals`, bg: COLOR.emerald }, { label: 'Reject', url: `${getAppUrl()}/leave/approvals`, bg: COLOR.rose })}
        ${etSublink('Open in HRMS to add a note before deciding.')}
      `,
    }),
  });

/** Wired: leave.controller.js approve(). */
const leaveApprovedEmail = (employee, leave, { approverName, remainingBalance } = {}) =>
  sendEmail({
    to: employee.email,
    subject: `Your leave has been approved — ${formatDate(leave.from_date, 'D MMM')}–${formatDate(leave.to_date, 'D MMM YYYY')}`,
    html: etDocument({
      preheader: 'Your leave has been approved.',
      gradient: GRADIENT.emeraldSolid,
      eyebrow: 'Leave approved',
      titleHtml: `Enjoy your time off,<br><em style="font-style:italic;">${escapeHtml(employee.first_name)}.</em>`,
      icon: '🌿',
      bodyHtml: `
        ${etP('Your leave has been approved. Your attendance will be marked and your leave balance updated accordingly.')}
        ${etInfo([
          { label: 'Leave type', value: leave.leave_type },
          { label: 'Dates', value: `${formatDate(leave.from_date, 'D MMM')}–${formatDate(leave.to_date, 'D MMM YYYY')}` },
          { label: 'Approved by', value: approverName || '—' },
          ...(remainingBalance != null ? [{ label: `Remaining ${leave.leave_type} balance`, value: `${remainingBalance} days` }] : []),
          { label: 'Status', valueHtml: etBadge('Approved', { bg: COLOR.emeraldBg, color: COLOR.emerald }) },
        ])}
        ${etCta(`${getAppUrl()}/leave/me`, 'View Leave Calendar', COLOR.emerald)}
      `,
    }),
  });

/** Wired: leave.controller.js reject(). */
const leaveRejectedEmail = (employee, leave, { approverName, reason, unchangedBalance } = {}) =>
  sendEmail({
    to: employee.email,
    subject: `Your leave request was not approved — ${formatDate(leave.from_date, 'D MMM')}–${formatDate(leave.to_date, 'D MMM')}`,
    html: etDocument({
      preheader: 'Your leave request was not approved.',
      gradient: GRADIENT.rose,
      eyebrow: 'Leave not approved',
      titleHtml: `${escapeHtml(formatDate(leave.from_date, 'D MMM'))}–${escapeHtml(formatDate(leave.to_date, 'D MMM YYYY'))}`,
      icon: '✗',
      bodyHtml: `
        ${etP(`Your leave request for ${escapeHtml(formatDate(leave.from_date, 'D MMM'))}–${escapeHtml(formatDate(leave.to_date, 'D MMM YYYY'))} has not been approved. Your balance is unchanged.`)}
        ${etInfo([
          { label: 'Reviewed by', value: approverName || '—' },
          ...(unchangedBalance != null ? [{ label: `${leave.leave_type} balance`, value: `${unchangedBalance} days (unchanged)` }] : []),
        ])}
        ${reason ? etQuote(reason, { border: COLOR.rose, bg: COLOR.roseBg, color: COLOR.roseDeep }) : ''}
        ${etCta(`${getAppUrl()}/leave/apply`, 'Apply for Alternate Dates', COLOR.rose)}
      `,
    }),
  });

/** Wired: leave.controller.js approve(), fired when the real post-approval balance (leave.service.js balance() formula: total_allocated − used − encashed) crosses below the threshold. */
const leaveBalanceLowEmail = (employee, { leaveType, remaining, threshold = 3, otherBalances = [] } = {}) =>
  sendEmail({
    to: employee.email,
    subject: `Your ${leaveType} balance is running low`,
    html: etDocument({
      preheader: `Your ${leaveType} balance has dropped below ${threshold} days.`,
      gradient: GRADIENT.amber,
      eyebrow: 'Leave balance',
      titleHtml: `Running low on<br><em style="font-style:italic;">${escapeHtml(leaveType)}.</em>`,
      icon: '📉',
      bodyHtml: `
        ${etP(`Your ${escapeHtml(leaveType)} balance has dropped below the ${threshold}-day threshold. Plan your remaining leaves carefully.`)}
        ${etStats([
          { num: remaining, label: `${leaveType} remaining`, color: COLOR.amber },
          ...otherBalances.map((b) => ({ num: b.remaining, label: `${b.type} remaining`, color: COLOR.emerald })),
        ])}
        ${etCta(`${getAppUrl()}/leave/me`, 'View Leave Balance', COLOR.amber)}
      `,
    }),
  });

// ============================================================================
// PAYROLL
// ============================================================================

/** Wired: payroll.controller.js publishPayslip() — was previously never called despite existing. Uses real fields (payroll.gross_salary, .net_salary, .total_deductions, .working_days). */
const payslipEmail = (employee, payroll) =>
  sendEmail({
    to: employee.email,
    subject: `Your payslip for ${monthName(payroll.month)} ${payroll.year} is ready`,
    html: etDocument({
      preheader: `Your payslip for ${monthName(payroll.month)} ${payroll.year} is ready.`,
      gradient: GRADIENT.blueRoll,
      eyebrow: 'Payslip ready',
      titleHtml: `${monthName(payroll.month)} ${payroll.year}<br><em style="font-style:italic;">Salary credited.</em>`,
      icon: '💰',
      bodyHtml: `
        ${etP(`Your salary for ${monthName(payroll.month)} ${payroll.year} has been processed and your payslip is available on the portal.`)}
        ${etInfo([
          { label: 'Month', value: `${monthName(payroll.month)} ${payroll.year}` },
          ...(payroll.working_days != null ? [{ label: 'Working days', value: `${(payroll.working_days - (payroll.unpaid_leave_days || 0))} / ${payroll.working_days}` }] : []),
          { label: 'Gross salary', value: undefined, valueHtml: formatCurrency(payroll.gross_salary) },
          { label: 'Total deductions', valueHtml: formatCurrency(payroll.total_deductions) },
          { label: 'Net pay', valueHtml: `<span style="color:${COLOR.emerald};font-size:16px;font-weight:800;">${formatCurrency(payroll.net_salary)}</span>` },
        ])}
        ${etCta(`${getAppUrl()}/payroll/me`, 'Download Payslip', COLOR.blue)}
      `,
    }),
  });

/** No real trigger exists yet — needs wiring into the per-employee error path of the payroll run (payroll.service.js / autoPayroll.cron.js). Sent to HR/Admin only. */
const payslipFailedEmail = (recipient, companyMonthLabel, failures) =>
  sendEmail({
    to: recipient.email,
    subject: `⚠ Payslip generation failed — ${failures.length} employee${failures.length === 1 ? '' : 's'} affected`,
    html: etDocument({
      preheader: `${failures.length} payslips failed for ${companyMonthLabel}.`,
      gradient: GRADIENT.redAlert,
      eyebrow: 'Payroll error',
      titleHtml: `${failures.length} payslip${failures.length === 1 ? '' : 's'} failed<br><em style="font-style:italic;">${escapeHtml(companyMonthLabel)}</em>`,
      icon: '🚨',
      bodyHtml: `
        ${etP('The payroll run completed with errors. These employees did not receive their payslips and need manual review.')}
        ${etTable(
          [{ label: 'Employee', width: '55%' }, { label: 'Error', width: '45%' }],
          failures.map((f) => [escapeHtml(f.employeeName), `<span style="color:${COLOR.red};">${escapeHtml(f.reason)}</span>`]),
        )}
        ${etCta(`${getAppUrl()}/payroll/run`, 'Open Payroll Dashboard', COLOR.red)}
      `,
    }),
  });

/** No salary-revision feature exists in this codebase (SalaryRevisions.jsx is a frontend-only mock, no backend table). Template ready; needs that feature built before it can be wired to anything real. */
const salaryRevisedEmail = (employee, { previousCtc, revisedCtc, effectiveDate, revisedBy } = {}) => {
  const pctChange = previousCtc ? Math.round(((revisedCtc - previousCtc) / previousCtc) * 100) : null;
  return sendEmail({
    to: employee.email,
    subject: `Your salary has been revised — effective ${formatDate(effectiveDate)}`,
    html: etDocument({
      preheader: 'Your compensation has been revised.',
      gradient: GRADIENT.emeraldSolid,
      eyebrow: 'Salary revision',
      titleHtml: `Effective<br><em style="font-style:italic;">${escapeHtml(formatDate(effectiveDate))}</em>`,
      icon: '📈',
      bodyHtml: `
        ${etP(`Your compensation has been revised. The updated structure takes effect from ${escapeHtml(formatDate(effectiveDate))}.`)}
        ${etInfo([
          { label: 'Previous CTC', valueHtml: `<span style="color:${COLOR.slateSoft};text-decoration:line-through;">${formatCurrency(previousCtc)} / year</span>` },
          { label: 'Revised CTC', valueHtml: `<span style="color:${COLOR.emerald};font-size:15px;font-weight:800;">${formatCurrency(revisedCtc)} / year</span>` },
          ...(pctChange != null ? [{ label: 'Change', valueHtml: `<span style="color:${pctChange >= 0 ? COLOR.emerald : COLOR.rose};">${pctChange >= 0 ? '+' : ''}${pctChange}%</span>` }] : []),
          { label: 'Effective date', value: formatDate(effectiveDate) },
          { label: 'Revised by', value: revisedBy || '—' },
        ])}
        ${etCta(`${getAppUrl()}/payroll/me`, 'View New Salary Breakup', COLOR.emerald)}
      `,
    }),
  });
};

// ============================================================================
// DIGESTS — HR/Admin only
// ============================================================================

/** Wired: attendanceAnomaly.service.js — one per company per cron run, after each employee's own alert. */
const attendanceAnomalyDigestEmail = (recipient, dateLabel, anomalies) => {
  const counts = { absent: 0, late: 0, short_hours: 0 };
  anomalies.forEach((a) => { counts[a.type] = (counts[a.type] || 0) + 1; });
  return sendEmail({
    to: recipient.email,
    subject: `Attendance anomalies for ${dateLabel} (${anomalies.length})`,
    html: etDocument({
      preheader: `${anomalies.length} attendance anomal${anomalies.length === 1 ? 'y' : 'ies'} flagged for ${dateLabel}.`,
      gradient: GRADIENT.amberDigest,
      eyebrow: 'HR daily digest',
      titleHtml: `Attendance anomalies<br><em style="font-style:italic;">${escapeHtml(dateLabel)}</em>`,
      icon: '📊',
      bodyHtml: `
        ${etStats([
          { num: counts.absent, label: 'Absent', color: COLOR.rose },
          { num: counts.late, label: 'Late', color: COLOR.amber },
          { num: counts.short_hours, label: 'Short hours', color: '#8F6B12' },
        ])}
        ${etAlert('Individual alerts have already been sent to each of these employees in this same run. No further action needed unless regularization requests come in.', { bg: COLOR.emeraldBg, color: '#065F46', icon: '✓' })}
        ${etTable(
          [{ label: 'Employee', width: '55%' }, { label: 'Status', width: '45%' }],
          anomalies.map((a) => [escapeHtml(a.employeeName), humanizeAnomalyBadge(a.type)]),
        )}
        ${etCta(`${getAppUrl()}/attendance/team`, 'Open Attendance Dashboard', COLOR.amber)}
      `,
    }),
  });
};

function humanizeAnomalyBadge(type) {
  if (type === 'absent') return etBadge('Absent', { bg: COLOR.roseBg, color: COLOR.rose });
  if (type === 'late') return etBadge('Late', { bg: COLOR.amberBg, color: COLOR.amber });
  if (type === 'short_hours') return etBadge('Short hrs', { bg: '#FEFCE8', color: '#8F6B12' });
  return etBadge(type, {});
}

/** No real trigger exists — needs a new cron aggregating pending leaves/regularizations/asset requests per company, company_id-scoped. */
const pendingApprovalsDigestEmail = (recipient, dateLabel, groups) =>
  sendEmail({
    to: recipient.email,
    subject: `You have ${groups.reduce((s, g) => s + g.items.length, 0)} pending approvals — ${dateLabel}`,
    html: etDocument({
      preheader: `${groups.reduce((s, g) => s + g.items.length, 0)} items need your attention.`,
      gradient: GRADIENT.skyDeep,
      eyebrow: `Morning digest · ${dateLabel}`,
      titleHtml: `${groups.reduce((s, g) => s + g.items.length, 0)} items need<br><em style="font-style:italic;">your attention.</em>`,
      icon: '☑️',
      bodyHtml: `
        ${etP(`Good morning, ${escapeHtml(recipient.first_name || 'there')}. Here&rsquo;s a summary of what&rsquo;s waiting for your review today.`)}
        ${etList(groups.map((g) => ({
          icon: String(g.items.length), iconBg: g.iconBg || COLOR.skyBg, iconColor: g.iconColor || COLOR.sky,
          html: `<strong>${escapeHtml(g.label)}</strong> — ${escapeHtml(g.items.map((i) => i.name).join(', '))}`,
        })))}
        ${etCta(`${getAppUrl()}/dashboard`, 'Review All Pending', '#106787')}
      `,
    }),
  });

/** No real trigger exists — needs a new weekly cron computing joiners/exits per company, company_id-scoped. */
const joinerDigestEmail = (recipient, weekLabel, { joiners = [], exits = [], headcount } = {}) =>
  sendEmail({
    to: recipient.email,
    subject: `Team movement this week — ${weekLabel}`,
    html: etDocument({
      preheader: `${joiners.length} joiners, ${exits.length} exits this week.`,
      gradient: GRADIENT.emeraldSolid,
      eyebrow: 'Weekly team digest',
      titleHtml: `${escapeHtml(weekLabel)}<br><em style="font-style:italic;">Team movement.</em>`,
      icon: '👥',
      bodyHtml: `
        ${etStats([
          { num: joiners.length, label: 'New joiners', color: COLOR.emerald },
          { num: exits.length, label: 'Exits', color: COLOR.rose },
          { num: headcount ?? '—', label: 'Headcount', color: COLOR.sky },
        ])}
        ${joiners.length ? etDividerLabel('New joiners') + etList(joiners.map((j) => ({ icon: '+', iconBg: COLOR.emeraldBg, iconColor: COLOR.emerald, html: `${escapeHtml(j.name)} — ${escapeHtml(j.department || '')} · ${escapeHtml(formatDate(j.date, 'D MMM'))}` }))) : ''}
        ${exits.length ? etDividerLabel('Exits') + etList(exits.map((e) => ({ icon: '−', iconBg: COLOR.roseBg, iconColor: COLOR.rose, html: `${escapeHtml(e.name)} — ${escapeHtml(e.department || '')} · Last day ${escapeHtml(formatDate(e.date, 'D MMM'))}` }))) : ''}
        ${etCta(`${getAppUrl()}/employees`, 'View All in HRMS', COLOR.emerald)}
      `,
    }),
  });

// ============================================================================
// SECURITY
// ============================================================================

/** Wired: auth.service.js requestPasswordReset(). */
const passwordResetEmail = (employee, otp) =>
  sendEmail({
    to: employee.email,
    subject: 'Reset your HRMS password',
    html: etDocument({
      preheader: `Your password reset code is ${otp}.`,
      gradient: GRADIENT.violet,
      eyebrow: 'Security',
      titleHtml: `Password reset<br><em style="font-style:italic;">requested.</em>`,
      icon: '🔑',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(employee.first_name || 'there')}, use the code below to reset your password. It&rsquo;s valid for 10 minutes.`)}
        ${etOtp(otp, 'Valid for 10 minutes', { bg: COLOR.violetBg, color: COLOR.violet })}
        ${etAlert("If you didn't request this, your account is safe — ignore this email. No changes have been made.", { bg: COLOR.violetBg, color: '#4C1D95', icon: '🛡' })}
      `,
    }),
  });

/** Wired: auth.service.js onboarding email-verification step. */
const onboardingOtpEmail = (email, name, otp) =>
  sendEmail({
    to: email,
    subject: 'Verify your email — HRMS workspace setup',
    html: etDocument({
      preheader: `Your verification code is ${otp}.`,
      gradient: GRADIENT.violetDeep,
      eyebrow: 'Verification',
      titleHtml: `One-time<br><em style="font-style:italic;">passcode.</em>`,
      icon: '🛡️',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(name) || 'there'}, use the code below to complete your verification. Do not share it with anyone.`)}
        ${etOtp(otp, 'Valid for 10 minutes', { bg: COLOR.violetBg, color: '#3B3486' })}
        ${etAlert("If you didn't request this code, you can safely ignore this email.", { bg: COLOR.violetBg, color: COLOR.violetDeep })}
      `,
    }),
  });

/** Wired: apiKey.controller.js create(). */
const apiKeyCreatedEmail = (recipient, { keyName, keyPrefix, scopeLabel, createdByName }) =>
  sendEmail({
    to: recipient.email,
    subject: `New API key created — ${keyName}`,
    html: etDocument({
      preheader: 'A new API key has been generated on your account.',
      gradient: GRADIENT.navySolid,
      eyebrow: 'Security alert',
      titleHtml: `New API key<br><em style="font-style:italic;">created.</em>`,
      icon: '🔗',
      bodyHtml: `
        ${etP('A new API key has been generated on your account. If you did not initiate this, revoke it immediately from the portal.')}
        ${etInfo([
          { label: 'Key name', value: keyName },
          { label: 'Key prefix', valueHtml: `<span style="font-family:${FONT_MONO};font-size:11px;">${escapeHtml(keyPrefix)}&hellip;</span>` },
          { label: 'Scope', value: scopeLabel },
          { label: 'Created by', value: createdByName },
          { label: 'Created at', value: formatDate(new Date(), 'DD MMM YYYY, h:mm A') },
        ])}
        ${etCta(`${getAppUrl()}/settings/api-keys`, 'Manage API Keys', '#1E293B')}
      `,
    }),
  });

/** Wired: apiKey.controller.js revoke(). */
const apiKeyRevokedEmail = (recipient, { keyName, keyPrefix, revokedByName }) =>
  sendEmail({
    to: recipient.email,
    subject: 'API key revoked — review if unexpected',
    html: etDocument({
      preheader: 'An API key on your account was revoked.',
      gradient: GRADIENT.redAlert,
      eyebrow: 'Security alert',
      titleHtml: `An API key has<br><em style="font-style:italic;">been revoked.</em>`,
      icon: '🚫',
      bodyHtml: `
        ${etP('An API key on your account was permanently revoked. Any integrations using this key stopped working immediately.')}
        ${etInfo([
          { label: 'Key name', value: keyName },
          { label: 'Key prefix', valueHtml: `<span style="font-family:${FONT_MONO};font-size:11px;">${escapeHtml(keyPrefix)}&hellip;</span>` },
          { label: 'Revoked by', value: revokedByName },
          { label: 'Revoked at', value: formatDate(new Date(), 'DD MMM YYYY, h:mm A') },
        ])}
        ${etAlert('If you did not do this, contact your system administrator immediately and audit your account access.', { bg: COLOR.roseBg, color: COLOR.roseDeep })}
        ${etCta(`${getAppUrl()}/settings/api-keys`, 'Review Account Security', COLOR.red)}
      `,
    }),
  });

// ============================================================================
// RECRUITMENT
// ============================================================================

/** No real trigger exists yet — needs wiring into recruitment.controller.js createOffer(). */
const offerLetterEmail = (candidate, { role, department, location, ctc, currency = 'INR', joiningDate, validUntil }) =>
  sendEmail({
    to: candidate.email,
    subject: `Your offer from HRMS`,
    html: etDocument({
      preheader: 'An offer of employment.',
      gradient: GRADIENT.violetRoll,
      eyebrow: 'HRMS',
      titleHtml: `An offer<br><em style="font-style:italic;">for ${escapeHtml(candidate.name)}.</em>`,
      icon: '📜',
      bodyHtml: `
        ${etP(`We&rsquo;re pleased to extend an offer of employment. After a thorough process, we believe you&rsquo;ll be a great addition to the team.`)}
        ${etInfo([
          { label: 'Role', value: role },
          { label: 'Department', value: department || '—' },
          { label: 'Location', value: location || '—' },
          { label: 'CTC', value: `${currency === 'INR' ? formatCurrency(ctc).replace('&#8377;', '₹') : ctc + ' ' + currency} / year`, valueHtml: `${formatCurrency(ctc)} / year` },
          { label: 'Joining date', value: formatDate(joiningDate) },
          { label: 'Offer valid until', valueHtml: `<span style="color:${COLOR.rose};">${formatDate(validUntil)}</span>` },
        ])}
        ${etDualCta({ label: 'Accept Offer', url: `${getAppUrl()}/portal/offers`, bg: '#3B3486' }, { label: 'Decline', url: `${getAppUrl()}/portal/offers`, bg: COLOR.slateSoft })}
      `,
    }),
  });

/** No real trigger exists yet — needs wiring into recruitment.controller.js updateOfferStatus(). Sent to HR/Admin. */
const offerAcceptedEmail = (recipient, candidate, { role, joiningDate }) =>
  sendEmail({
    to: recipient.email,
    subject: `${candidate.name} accepted the offer — joining ${formatDate(joiningDate)}`,
    html: etDocument({
      preheader: `${candidate.name} accepted the offer.`,
      gradient: GRADIENT.emeraldSolid,
      eyebrow: 'Offer accepted',
      titleHtml: `${escapeHtml(candidate.name)}<br><em style="font-style:italic;">is joining.</em>`,
      icon: '🎊',
      bodyHtml: `
        ${etP(`Good news — ${escapeHtml(candidate.name)} has formally accepted the offer and confirmed the joining date.`)}
        ${etInfo([
          { label: 'Candidate', value: candidate.name },
          { label: 'Role', value: role },
          { label: 'Joining date', value: formatDate(joiningDate) },
        ])}
        ${etDividerLabel('Before joining day')}
        ${etList([
          { icon: '!', iconBg: COLOR.amberBg, iconColor: COLOR.amber, html: 'Create HRMS account and send welcome email' },
          { icon: '!', iconBg: COLOR.amberBg, iconColor: COLOR.amber, html: 'Assign laptop and IT assets' },
          { icon: '!', iconBg: COLOR.amberBg, iconColor: COLOR.amber, html: 'Schedule Day 1 induction' },
        ])}
        ${etCta(`${getAppUrl()}/recruitment/candidates`, 'Start Onboarding', COLOR.emerald)}
      `,
    }),
  });

/** No real trigger exists yet — needs wiring into recruitment.controller.js updateOfferStatus(). Sent to HR/Admin. */
const offerRejectedEmail = (recipient, candidate, { role, reason }) =>
  sendEmail({
    to: recipient.email,
    subject: `${candidate.name} declined the offer`,
    html: etDocument({
      preheader: `${candidate.name} declined the offer.`,
      gradient: GRADIENT.slateDark,
      eyebrow: 'Offer declined',
      titleHtml: `${escapeHtml(candidate.name)}<br><em style="font-style:italic;">declined.</em>`,
      icon: '↩️',
      bodyHtml: `
        ${etP('The candidate has declined the offer. The profile has been moved to the declined archive in your recruitment pipeline.')}
        ${etInfo([
          { label: 'Candidate', value: candidate.name },
          { label: 'Role', value: role },
          ...(reason ? [{ label: 'Reason given', valueHtml: `<span style="font-style:italic;color:${COLOR.slate};">${escapeHtml(reason)}</span>` }] : []),
        ])}
        ${etCta(`${getAppUrl()}/recruitment/candidates`, 'Reopen Recruitment', COLOR.navySoft)}
      `,
    }),
  });

// ============================================================================
// PRE-EXISTING TEMPLATES (not in the 31, kept and restyled to match)
// ============================================================================

const autoCheckoutEmail = (employee, attendance) =>
  sendEmail({
    to: employee.email,
    subject: 'Auto Check-out Notification',
    html: etDocument({
      preheader: 'An automatic check-out was applied to your attendance.',
      gradient: GRADIENT.amber,
      eyebrow: 'Auto check-out',
      titleHtml: 'Your check-out<br><em style="font-style:italic;">was automatic.</em>',
      icon: '🚪',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(employee.first_name)}, you forgot to check out on ${escapeHtml(attendance.check_in_time)}, so an automatic check-out was applied.`)}
        ${etInfo([{ label: 'Total hours', value: attendance.total_hours }])}
        ${etP('If this looks incorrect, please reach out to your manager or HR to have it corrected.')}
      `,
    }),
  });

const announcementEmail = (employee, announcement, options = {}) => {
  const priority = String(announcement.priority || 'medium').toUpperCase();
  const priorityColorMap = { URGENT: COLOR.rose, HIGH: COLOR.amber, LOW: COLOR.slate };
  const contentHtml = escapeHtml(announcement.content).replace(/\n/g, '<br/>');
  return sendEmail({
    to: employee.email,
    subject: options.subject || `[${priority}] ${announcement.title}`,
    html: etDocument({
      preheader: announcement.title,
      gradient: GRADIENT.blueRoll,
      eyebrow: `${priority} priority`,
      titleHtml: escapeHtml(announcement.title),
      icon: '📣',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(employee.first_name || 'there')},`)}
        ${etP(contentHtml)}
        ${etCta(`${getAppUrl()}/announcements`, 'View in HRMS', priorityColorMap[priority] || COLOR.blue)}
      `,
    }),
  });
};

const trainingAssignmentEmail = (employee, training) =>
  sendEmail({
    to: employee.email,
    subject: `Training Assigned: ${training.title}`,
    html: etDocument({
      preheader: `You've been assigned to ${training.title}.`,
      gradient: GRADIENT.sky,
      eyebrow: 'Training assigned',
      titleHtml: escapeHtml(training.title),
      icon: '🎓',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(employee.first_name || 'there')}, you&rsquo;ve been assigned to a new training.`)}
        ${etInfo([
          { label: 'Start date', value: formatDate(training.start_date) },
          { label: 'End date', value: formatDate(training.end_date) },
          { label: 'Mode', value: training.training_mode },
        ])}
        ${etCta(`${getAppUrl()}/training/catalog`, 'View Training Details', COLOR.sky)}
      `,
    }),
  });

/** Generic email for in-app notifications (WFH, tickets, etc.). */
const notificationEmail = (employee, { title, message, link, type }) => {
  const appUrl = getAppUrl();
  const actionUrl = link ? `${appUrl}${link.startsWith('/') ? link : `/${link}`}` : appUrl;
  return sendEmail({
    to: employee.email,
    subject: title || 'HRMS notification',
    html: etDocument({
      preheader: message || title,
      gradient: GRADIENT.navySolid,
      eyebrow: type ? String(type).replace(/_/g, ' ') : 'Notification',
      titleHtml: escapeHtml(title || 'Notification'),
      icon: '🔔',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(employee.first_name || 'there')},`)}
        ${etP(escapeHtml(message || '').replace(/\n/g, '<br/>'))}
        ${etCta(actionUrl, 'Open in HRMS', COLOR.navySoft)}
      `,
    }),
  });
};

// ── Subscription/billing notifications (unchanged scope — not part of the 31) ──

const subscriptionWelcomeEmail = ({ to, name }, subscription, plan) =>
  sendEmail({
    to,
    subject: `Welcome to the ${plan.name} plan`,
    html: etDocument({
      preheader: `Your ${plan.name} subscription is active.`,
      gradient: GRADIENT.emeraldSolid,
      eyebrow: 'Subscription active',
      titleHtml: `Welcome to<br><em style="font-style:italic;">${escapeHtml(plan.name)}.</em>`,
      icon: '✨',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(name || 'there')}, your company&rsquo;s subscription is now active.`)}
        ${etInfo([
          { label: 'Plan', value: plan.name },
          { label: 'Billing cycle', value: subscription.billing_cycle },
          { label: 'Seats', value: String(subscription.seat_count) },
          { label: 'Current period ends', value: formatDate(subscription.current_period_end) },
        ])}
        ${etCta(`${getAppUrl()}/settings/billing`, 'View Billing Details', COLOR.emerald)}
      `,
    }),
  });

const subscriptionRenewedEmail = ({ to, name }, subscription, invoice) =>
  sendEmail({
    to,
    subject: `Subscription renewed — ${invoice.invoice_number}`,
    html: etDocument({
      preheader: `Your subscription has been renewed through ${formatDate(subscription.current_period_end)}.`,
      gradient: GRADIENT.emeraldSolid,
      eyebrow: 'Renewed',
      titleHtml: 'Your subscription<br><em style="font-style:italic;">has been renewed.</em>',
      icon: '🔁',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(name || 'there')}, this confirms your subscription renewal.`)}
        ${etInfo([
          { label: 'Amount charged', valueHtml: formatCurrency(invoice.amount) },
          { label: 'Invoice', value: invoice.invoice_number },
          { label: 'New period ends', value: formatDate(subscription.current_period_end) },
          { label: 'Seats', value: String(subscription.seat_count) },
        ])}
        ${etCta(`${getAppUrl()}/settings/billing`, 'View Invoice', COLOR.emerald)}
      `,
    }),
  });

const subscriptionPlanChangedEmail = ({ to, name }, subscription, oldPlan, newPlan) =>
  sendEmail({
    to,
    subject: `Your plan changed: ${oldPlan.name} → ${newPlan.name}`,
    html: etDocument({
      preheader: `Your subscription is now on the ${newPlan.name} plan.`,
      gradient: GRADIENT.blueDeep,
      eyebrow: 'Plan changed',
      titleHtml: `${escapeHtml(oldPlan.name)} &rarr;<br><em style="font-style:italic;">${escapeHtml(newPlan.name)}</em>`,
      icon: '🔄',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(name || 'there')}, your company&rsquo;s plan has been updated. Any price difference will appear as a prorated line item on your next invoice.`)}
        ${etCta(`${getAppUrl()}/settings/billing`, 'View Billing Details', COLOR.blue)}
      `,
    }),
  });

const REMINDER_COPY = {
  renewal_90d: { days: 90 }, renewal_30d: { days: 30 }, renewal_7d: { days: 7 }, renewal_1d: { days: 1 },
};

const subscriptionRenewalReminderEmail = ({ to, name }, subscription, plan, price, notificationType) => {
  const { days } = REMINDER_COPY[notificationType] || { days: '' };
  const dateStr = formatDate(subscription.current_period_end);
  const isAutoRenew = subscription.auto_renew;
  return sendEmail({
    to,
    subject: isAutoRenew ? `Your plan renews in ${days} day${days === 1 ? '' : 's'}` : `Action required: renew within ${days} day${days === 1 ? '' : 's'}`,
    html: etDocument({
      preheader: isAutoRenew ? `Auto-renewal on ${dateStr}.` : `Your subscription needs manual renewal by ${dateStr}.`,
      gradient: isAutoRenew ? GRADIENT.sky : GRADIENT.amber,
      eyebrow: isAutoRenew ? 'Upcoming renewal' : 'Action required',
      titleHtml: isAutoRenew ? `Renewing in<br><em style="font-style:italic;">${days} day${days === 1 ? '' : 's'}</em>` : `Renew within<br><em style="font-style:italic;">${days} day${days === 1 ? '' : 's'}</em>`,
      icon: '⏳',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(name || 'there')}, ${isAutoRenew ? `your subscription will renew automatically on <strong>${dateStr}</strong>. No action is needed.` : `your subscription expires on <strong>${dateStr}</strong> and auto-renew is off.`}`)}
        ${etInfo([
          { label: 'Renewal amount', valueHtml: formatCurrency(price) },
          { label: 'Plan', value: plan.name },
          { label: 'Seats', value: String(subscription.seat_count) },
        ])}
        ${etCta(`${getAppUrl()}/settings/billing`, isAutoRenew ? 'View Billing Details' : 'Renew Now', isAutoRenew ? COLOR.sky : COLOR.amber)}
      `,
    }),
  });
};

const subscriptionPaymentFailedEmail = ({ to, name }, subscription, reason, graceDays) =>
  sendEmail({
    to,
    subject: 'Payment failed for your subscription',
    html: etDocument({
      preheader: 'We could not process your subscription payment.',
      gradient: GRADIENT.redAlert,
      eyebrow: 'Payment failed',
      titleHtml: 'We couldn&rsquo;t process<br><em style="font-style:italic;">your payment.</em>',
      icon: '❌',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(name || 'there')}, your subscription payment failed.`)}
        ${etQuote(reason || 'Unknown error', { border: COLOR.red, bg: COLOR.roseBg, color: COLOR.roseDeep })}
        ${etP(`Your account remains active for a ${graceDays}-day grace period while you update your payment details.`)}
        ${etCta(`${getAppUrl()}/settings/billing`, 'Update Payment Details', COLOR.red)}
      `,
    }),
  });

const subscriptionGracePeriodEndingEmail = ({ to, name }, subscription, daysLeft) =>
  sendEmail({
    to,
    subject: `Grace period ending in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    html: etDocument({
      preheader: 'Your account will be suspended soon unless payment is resolved.',
      gradient: GRADIENT.amber,
      eyebrow: 'Grace period ending',
      titleHtml: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left<br><em style="font-style:italic;">to fix billing.</em>`,
      icon: '⏰',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(name || 'there')}, your subscription is still past due. Access will be suspended in ${daysLeft} day${daysLeft === 1 ? '' : 's'} if payment isn&rsquo;t resolved.`)}
        ${etCta(`${getAppUrl()}/settings/billing`, 'Resolve Billing Now', COLOR.amber)}
      `,
    }),
  });

const subscriptionSuspendedEmail = ({ to, name }, subscription) =>
  sendEmail({
    to,
    subject: 'Your subscription has been suspended',
    html: etDocument({
      preheader: 'Access has been suspended — contact billing to restore it.',
      gradient: GRADIENT.redAlert,
      eyebrow: 'Suspended',
      titleHtml: 'Access<br><em style="font-style:italic;">suspended.</em>',
      icon: '⛔',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(name || 'there')}, your company&rsquo;s HRMS access has been suspended due to your subscription status. Your data is safe and untouched.`)}
        ${etCta(`${getAppUrl()}/settings/billing`, 'Contact Billing', COLOR.red)}
      `,
    }),
  });

// ── Section D: IP beacon system ─────────────────────────────────────────
const beaconFirstPingEmail = ({ to, name }, beacon, ip) =>
  sendEmail({
    to,
    subject: `Beacon "${beacon.label}" is now live`,
    html: etDocument({
      preheader: `First ping received — office IP ${ip} is now whitelisted.`,
      gradient: GRADIENT.emerald,
      eyebrow: 'IP Beacon',
      titleHtml: `Beacon connected<br><em style="font-style:italic;">and whitelisted.</em>`,
      icon: '📡',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(name || 'there')}, your beacon &ldquo;${escapeHtml(beacon.label)}&rdquo; just pinged for the first time.`)}
        ${etInfo([
          { label: 'Beacon', value: beacon.label },
          { label: 'IP whitelisted', value: ip },
          { label: 'Expected region', value: beacon.expected_region || 'Not set' },
        ])}
        ${etP('Employees checking in via IP-based Web check-in from this network are now allowed.')}
        ${etCta(`${getAppUrl()}/settings?tab=attendance`, 'View Beacons', COLOR.emerald)}
      `,
    }),
  });

const beaconCompromiseAlertEmail = ({ to, name }, beacon, recentChanges) =>
  sendEmail({
    to,
    subject: `⚠ Beacon "${beacon.label}" may be compromised`,
    html: etDocument({
      preheader: `IP changed ${recentChanges.length}+ times in the last 5 hours.`,
      gradient: GRADIENT.redAlert,
      eyebrow: 'Security alert',
      titleHtml: `Beacon may be<br><em style="font-style:italic;">compromised.</em>`,
      icon: '🚨',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(name || 'there')}, beacon &ldquo;${escapeHtml(beacon.label)}&rdquo; may be compromised — its IP changed ${recentChanges.length} times in the last 5 hours.`)}
        ${etAlert('Please verify this beacon\'s physical device and network immediately.', { bg: COLOR.roseBg, color: COLOR.roseDeep })}
        ${etTable(
          [{ label: 'Time', width: '55%' }, { label: 'IP', width: '45%' }],
          recentChanges.map((c) => [formatDate(c.pinged_at, 'DD MMM, HH:mm'), escapeHtml(c.observed_ip)]),
        )}
        ${etCta(`${getAppUrl()}/settings?tab=attendance`, 'Review Beacon', COLOR.red)}
      `,
    }),
  });

const beaconGeoMismatchEmail = ({ to, name }, beacon, { proposedIp, detectedRegion }) =>
  sendEmail({
    to,
    subject: `Review needed: unexpected region for beacon "${beacon.label}"`,
    html: etDocument({
      preheader: 'A new IP was pushed from an unexpected region — the current IP has not changed.',
      gradient: GRADIENT.amber,
      eyebrow: 'IP Beacon',
      titleHtml: `Unexpected region<br><em style="font-style:italic;">detected.</em>`,
      icon: '🌍',
      bodyHtml: `
        ${etP(`Hi ${escapeHtml(name || 'there')}, a new IP was pushed for beacon &ldquo;${escapeHtml(beacon.label)}&rdquo; from a region that doesn't match your office's expected location.`)}
        ${etInfo([
          { label: 'Expected', value: beacon.expected_region || 'Not set' },
          { label: 'Detected', value: detectedRegion || 'Unknown' },
          { label: 'Proposed IP', value: proposedIp },
        ])}
        ${etP('The current whitelisted IP has NOT been changed — check-in continues working as before.')}
        ${etCta(`${getAppUrl()}/settings?tab=attendance`, 'Review & Approve/Reject', COLOR.amber)}
      `,
    }),
  });

module.exports = {
  sendEmail,
  beaconFirstPingEmail,
  beaconCompromiseAlertEmail,
  beaconGeoMismatchEmail,
  // Onboarding
  welcomeEmail,
  prejoiningEmail,
  dayOneEmail,
  checklistReminderEmail,
  onboardingCompleteEmail,
  // Bulk import
  bulkImportEmail,
  // Offboarding
  offboardingInitiatedEmail,
  exitChecklistEmail,
  finalSettlementEmail,
  accountDeactivatedEmail,
  // Attendance
  attendanceAbsentAlertEmail,
  attendanceLateAlertEmail,
  attendanceShortHoursAlertEmail,
  regularizationApprovedEmail,
  regularizationRejectedEmail,
  // Leave
  leaveAppliedEmail,
  leaveApprovalRequestEmail,
  leaveApprovedEmail,
  leaveRejectedEmail,
  leaveBalanceLowEmail,
  // Payroll
  payslipEmail,
  payslipFailedEmail,
  salaryRevisedEmail,
  // Digests
  attendanceAnomalyDigestEmail,
  pendingApprovalsDigestEmail,
  joinerDigestEmail,
  // Security
  passwordResetEmail,
  onboardingOtpEmail,
  apiKeyCreatedEmail,
  apiKeyRevokedEmail,
  // Recruitment
  offerLetterEmail,
  offerAcceptedEmail,
  offerRejectedEmail,
  // Pre-existing, not part of the 31
  autoCheckoutEmail,
  announcementEmail,
  trainingAssignmentEmail,
  notificationEmail,
  subscriptionWelcomeEmail,
  subscriptionRenewedEmail,
  subscriptionPlanChangedEmail,
  subscriptionRenewalReminderEmail,
  subscriptionPaymentFailedEmail,
  subscriptionGracePeriodEndingEmail,
  subscriptionSuspendedEmail,
};
