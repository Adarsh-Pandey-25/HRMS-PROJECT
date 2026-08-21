const { sendWithFallback } = require('../config/email');
const logger = require('../utils/logger');

const BRAND = {
  name: 'HRMS',
  paper: '#F6F4EF',
  surface: '#FFFFFF',
  border: '#E7E3DA',
  ink: '#17161C',
  inkSoft: '#726F68',
  accent: '#3B2F7A',
  success: '#1F7A4D',
  danger: '#B23A2E',
  warning: '#9C6B14',
};

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,Cambria,'Times New Roman',serif";

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

/** Shared letterhead shell: hairline top accent, tracked wordmark, serif/sans body, quiet footer. */
const emailLayout = ({ preheader = '', bodyHtml }) => `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:${BRAND.paper};">
    <span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:${BRAND.paper};">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.paper};font-family:${SANS};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:10px;overflow:hidden;">
            <tr>
              <td style="height:3px;line-height:3px;font-size:0;background-color:${BRAND.accent};">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:26px 40px;border-bottom:1px solid ${BRAND.border};">
                <span style="font-size:13px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${BRAND.ink};font-family:${SANS};">${BRAND.name}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:44px 40px 16px;color:${BRAND.ink};font-size:15px;line-height:1.6;font-family:${SANS};">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px 32px;border-top:1px solid ${BRAND.border};">
                <p style="margin:0;color:${BRAND.inkSoft};font-size:12px;line-height:1.6;font-family:${SANS};">
                  Automated message from ${BRAND.name} &mdash; please don&rsquo;t reply to this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const eyebrow = (label, color = BRAND.accent) =>
  `<p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:${color};font-family:${SANS};">${label}</p>`;

const eyebrowStatus = (label, color) =>
  `<p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:${color};font-family:${SANS};">&#9679;&nbsp; ${escapeHtml(label)}</p>`;

const heading = (text) =>
  `<h1 style="margin:0 0 18px;font-size:26px;font-weight:400;line-height:1.35;letter-spacing:-0.2px;color:${BRAND.ink};font-family:${SERIF};">${text}</h1>`;

const paragraph = (text) =>
  `<p style="margin:0 0 16px;color:${BRAND.inkSoft};font-size:15px;line-height:1.7;font-family:${SANS};">${text}</p>`;

const quoteNote = (text) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;">
    <tr>
      <td style="border-left:2px solid ${BRAND.border};padding:2px 0 2px 16px;color:${BRAND.inkSoft};font-size:14px;font-style:italic;font-family:${SERIF};">&ldquo;${escapeHtml(text)}&rdquo;</td>
    </tr>
  </table>`;

const ctaButton = (url, label) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:32px 0 4px;">
    <tr>
      <td style="background-color:${BRAND.ink};border-radius:4px;">
        <a href="${url}" style="display:inline-block;padding:13px 30px;font-size:13px;font-weight:600;letter-spacing:0.3px;color:#ffffff;text-decoration:none;border-radius:4px;font-family:${SANS};">${label}</a>
      </td>
    </tr>
  </table>`;

/** Hero numeral, framed by hairlines — used for OTP codes. */
const otpBlock = (otp) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 8px;">
    <tr>
      <td align="center" style="border-top:1px solid ${BRAND.border};border-bottom:1px solid ${BRAND.border};padding:28px 0;">
        <span style="font-family:${SERIF};font-size:38px;font-weight:400;letter-spacing:11px;color:${BRAND.ink};font-variant-numeric:tabular-nums;">${otp}</span>
      </td>
    </tr>
  </table>`;

/** Hero label + value, framed by hairlines — used for the payslip net-salary figure. */
const statBlock = (label, valueHtml) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 8px;">
    <tr>
      <td align="center" style="border-top:1px solid ${BRAND.border};border-bottom:1px solid ${BRAND.border};padding:26px 0;">
        <div style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${BRAND.inkSoft};font-family:${SANS};">${label}</div>
        <span style="font-family:${SERIF};font-size:34px;font-weight:400;color:${BRAND.ink};font-variant-numeric:tabular-nums;">${valueHtml}</span>
      </td>
    </tr>
  </table>`;

const detailRow = (label, value) => `
  <tr>
    <td style="padding:12px 0;color:${BRAND.inkSoft};font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;font-family:${SANS};width:170px;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:12px 0;color:${BRAND.ink};font-size:15px;font-family:${SERIF};">${value}</td>
  </tr>`;

const detailsTable = (rows) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;border-top:1px solid ${BRAND.border};border-bottom:1px solid ${BRAND.border};">
    ${rows.join('')}
  </table>`;

const statusColor = (status) => {
  const s = String(status || '').toLowerCase();
  if (s.includes('approve')) return BRAND.success;
  if (s.includes('reject') || s.includes('decline')) return BRAND.danger;
  return BRAND.warning;
};

const priorityColor = (priority) => {
  const p = String(priority || '').toLowerCase();
  if (p === 'urgent' || p === 'critical') return BRAND.danger;
  if (p === 'high') return BRAND.warning;
  if (p === 'low') return BRAND.inkSoft;
  return BRAND.accent;
};

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

const welcomeEmail = (employee, tempPassword) => {
  const rows = [
    detailRow('Employee code', escapeHtml(employee.employee_code)),
    detailRow('Email', escapeHtml(employee.email)),
  ];
  if (tempPassword) {
    rows.push(detailRow('Temporary password', `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;">${escapeHtml(tempPassword)}</span>`));
  }

  return sendEmail({
    to: employee.email,
    subject: 'Welcome to HRMS',
    html: emailLayout({
      preheader: `Your HRMS account is ready, ${employee.first_name || ''}.`,
      bodyHtml: `
        ${eyebrow('Account created')}
        ${heading(`Welcome, ${escapeHtml(employee.first_name)}.`)}
        ${paragraph('We&rsquo;re happy to have you on board. Your HRMS account has been created, and you can now access your employee information, attendance, leave requests, and other HR services.')}
        ${detailsTable(rows)}
        ${paragraph('For security, please sign in and set a permanent password as soon as possible.')}
        ${ctaButton(`${getAppUrl()}/login`, 'Log in to HRMS')}
        ${paragraph('If you need any assistance getting started, please reach out to the HR team.')}
      `,
    }),
  });
};

const leaveStatusEmail = (employee, leave, status, reason) =>
  sendEmail({
    to: employee.email,
    subject: `Leave ${status}: ${leave.leave_type}`,
    html: emailLayout({
      preheader: `Your ${leave.leave_type} leave request has been ${status}.`,
      bodyHtml: `
        ${eyebrowStatus(status, statusColor(status))}
        ${heading(`${escapeHtml(leave.leave_type)} leave request`)}
        ${paragraph(`Hi ${escapeHtml(employee.first_name)}, your leave from <strong style="color:${BRAND.ink};">${escapeHtml(leave.from_date)}</strong> to <strong style="color:${BRAND.ink};">${escapeHtml(leave.to_date)}</strong> has been <strong style="color:${BRAND.ink};">${escapeHtml(String(status).toLowerCase())}</strong>.`)}
        ${reason ? quoteNote(reason) : ''}
        ${ctaButton(`${getAppUrl()}/leaves`, 'View leave details')}
      `,
    }),
  });

const payslipEmail = (employee, payroll) =>
  sendEmail({
    to: employee.email,
    subject: `Payslip - ${payroll.month}/${payroll.year}`,
    html: emailLayout({
      preheader: `Your payslip for ${payroll.month}/${payroll.year} is ready.`,
      bodyHtml: `
        ${eyebrow(`Payslip &middot; ${monthName(payroll.month)} ${escapeHtml(payroll.year)}`)}
        ${heading('Your payslip is ready')}
        ${paragraph(`Dear ${escapeHtml(employee.first_name)}, your net salary for ${monthName(payroll.month)} has been credited.`)}
        ${statBlock('Net salary', formatCurrency(payroll.net_salary))}
        ${paragraph('Log in to HRMS to view and download the full payslip.')}
        ${ctaButton(`${getAppUrl()}/payroll`, 'View payslip')}
      `,
    }),
  });

const passwordResetEmail = (employee, otp) =>
  sendEmail({
    to: employee.email,
    subject: 'Password Reset OTP',
    html: emailLayout({
      preheader: `Your password reset code is ${otp}.`,
      bodyHtml: `
        ${eyebrow('Password reset')}
        ${heading('Reset your password')}
        ${paragraph(`Hi ${escapeHtml(employee.first_name)}, use the code below to reset your password. It&rsquo;s valid for 10 minutes.`)}
        ${otpBlock(otp)}
        ${paragraph("Didn&rsquo;t request this? Your password will remain unchanged &mdash; you can safely ignore this email.")}
      `,
    }),
  });

const onboardingOtpEmail = (email, name, otp) =>
  sendEmail({
    to: email,
    subject: 'Verify your email — HRMS workspace setup',
    html: emailLayout({
      preheader: `Your verification code is ${otp}.`,
      bodyHtml: `
        ${eyebrow('Verification')}
        ${heading('Verify your email')}
        ${paragraph(`Hi ${escapeHtml(name) || 'there'}, enter the code below to verify your email and launch your HRMS workspace. It&rsquo;s valid for 10 minutes.`)}
        ${otpBlock(otp)}
        ${paragraph("Didn&rsquo;t start a company setup? You can safely ignore this email.")}
      `,
    }),
  });

const autoCheckoutEmail = (employee, attendance) =>
  sendEmail({
    to: employee.email,
    subject: 'Auto Check-out Notification',
    html: emailLayout({
      preheader: 'An automatic check-out was applied to your attendance.',
      bodyHtml: `
        ${eyebrowStatus('Auto check-out', BRAND.warning)}
        ${heading('Your check-out was automatic')}
        ${paragraph(`Hi ${escapeHtml(employee.first_name)}, you forgot to check out on <strong style="color:${BRAND.ink};">${escapeHtml(attendance.check_in_time)}</strong>, so an automatic check-out was applied at 4:00 AM.`)}
        ${detailsTable([detailRow('Total hours', escapeHtml(attendance.total_hours))])}
        ${paragraph('If this looks incorrect, please reach out to your manager or HR to have it corrected.')}
      `,
    }),
  });

const announcementEmail = (employee, announcement, options = {}) => {
  const priority = String(announcement.priority || 'medium').toUpperCase();
  const appUrl = getAppUrl();
  const contentHtml = escapeHtml(announcement.content).replace(/\n/g, '<br/>');
  const subject = options.subject || `[${priority}] ${announcement.title}`;

  return sendEmail({
    to: employee.email,
    subject,
    html: emailLayout({
      preheader: announcement.title,
      bodyHtml: `
        ${eyebrowStatus(`${priority} priority`, priorityColor(priority))}
        ${heading(escapeHtml(announcement.title))}
        ${paragraph(`Hi ${escapeHtml(employee.first_name || 'there')},`)}
        <div style="margin:0 0 8px;color:${BRAND.ink};font-size:15px;line-height:1.75;font-family:${SANS};">${contentHtml}</div>
        ${ctaButton(`${appUrl}/announcements`, 'View announcement in HRMS')}
      `,
    }),
  });
};

const trainingAssignmentEmail = (employee, training) =>
  sendEmail({
    to: employee.email,
    subject: `Training Assigned: ${training.title}`,
    html: emailLayout({
      preheader: `You've been assigned to ${training.title}.`,
      bodyHtml: `
        ${eyebrow('Training assigned')}
        ${heading(escapeHtml(training.title))}
        ${paragraph(`Hi ${escapeHtml(employee.first_name || 'there')}, you&rsquo;ve been assigned to a new training.`)}
        ${detailsTable([
          detailRow('Start date', escapeHtml(training.start_date)),
          detailRow('End date', escapeHtml(training.end_date)),
          detailRow('Mode', escapeHtml(training.training_mode)),
        ])}
        ${ctaButton(`${getAppUrl()}/training`, 'View training details')}
      `,
    }),
  });

/** Generic email for in-app notifications (leave pending, WFH, tickets, etc.). */
const notificationEmail = (employee, { title, message, link, type }) => {
  const appUrl = getAppUrl();
  const actionUrl = link ? `${appUrl}${link.startsWith('/') ? link : `/${link}`}` : appUrl;
  const typeLabel = type ? String(type).replace(/_/g, ' ') : 'Notification';

  return sendEmail({
    to: employee.email,
    subject: title || 'HRMS notification',
    html: emailLayout({
      preheader: message || title,
      bodyHtml: `
        ${eyebrow(escapeHtml(typeLabel))}
        ${heading(escapeHtml(title || 'Notification'))}
        ${paragraph(`Hi ${escapeHtml(employee.first_name || 'there')},`)}
        ${paragraph(escapeHtml(message || '').replace(/\n/g, '<br/>'))}
        ${ctaButton(actionUrl, 'Open in HRMS')}
      `,
    }),
  });
};

module.exports = {
  sendEmail,
  welcomeEmail,
  leaveStatusEmail,
  payslipEmail,
  passwordResetEmail,
  onboardingOtpEmail,
  autoCheckoutEmail,
  announcementEmail,
  trainingAssignmentEmail,
  notificationEmail,
};
