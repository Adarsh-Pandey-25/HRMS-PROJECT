const { sendWithFallback } = require('../config/email');
const logger = require('../utils/logger');

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

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const welcomeEmail = (employee, tempPassword) => {
  const firstName = escapeHtml(employee.first_name || 'there');
  const code = escapeHtml(employee.employee_code || '');
  const email = escapeHtml(employee.email || '');
  const tempPass = tempPassword ? escapeHtml(tempPassword) : '';

  return sendEmail({
    to: employee.email,
    subject: 'Welcome to HRMS',
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; color: #222; line-height: 1.6; max-width: 560px;">
        <h2 style="margin: 0 0 12px;">Welcome ${firstName} 🎉</h2>
        <p>We’re happy to have you on board.</p>
        <p>
          Your HRMS account has been successfully created. You can now use the platform to access and manage your
          employee information, attendance, leave requests, and other HR-related services.
        </p>
        <p style="margin: 20px 0 8px;">
          <strong>Employee code-</strong> ${code}<br/>
          <strong>Email -</strong> ${email}<br/>
          ${tempPass ? `<strong>Temp pass -</strong> ${tempPass}` : ''}
        </p>
        <p>Please login and change your password</p>
        <p>If you need any assistance while using HRMS, please reach out to the HR team.</p>
        <p>Welcome once again, and we hope you have a great experience with HRMS!</p>
        <p style="margin-top: 24px;">
          Best regards,<br/>
          HR Team
        </p>
      </div>
    `,
  });
};

const leaveStatusEmail = (employee, leave, status, reason) =>
  sendEmail({
    to: employee.email,
    subject: `Leave ${status}: ${leave.leave_type}`,
    html: `
      <h2>Leave Application ${status}</h2>
      <p>Your leave request (${leave.leave_type}) from ${leave.from_date} to ${leave.to_date} has been <strong>${status}</strong>.</p>
      ${reason ? `<p>Reason: ${reason}</p>` : ''}
    `,
  });

const payslipEmail = (employee, payroll) =>
  sendEmail({
    to: employee.email,
    subject: `Payslip - ${payroll.month}/${payroll.year}`,
    html: `
      <h2>Your Payslip is Ready</h2>
      <p>Dear ${employee.first_name},</p>
      <p>Your payslip for ${payroll.month}/${payroll.year} has been generated.</p>
      <p><strong>Net Salary:</strong> ₹${payroll.net_salary}</p>
      <p>Login to HRMS to download your payslip.</p>
    `,
  });

const passwordResetEmail = (employee, otp) =>
  sendEmail({
    to: employee.email,
    subject: 'Password Reset OTP',
    html: `
      <h2>Password Reset</h2>
      <p>Hi ${employee.first_name},</p>
      <p>Use this OTP to reset your password (valid for 10 minutes):</p>
      <p style="font-size: 20px; letter-spacing: 2px;"><strong>${otp}</strong></p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });

const onboardingOtpEmail = (email, name, otp) =>
  sendEmail({
    to: email,
    subject: 'Verify your email — HRMS workspace setup',
    html: `
      <h2>Verify your admin email</h2>
      <p>Hi ${name || 'there'},</p>
      <p>Use this OTP to verify your email and launch your HRMS workspace (valid for 10 minutes):</p>
      <p style="font-size: 24px; letter-spacing: 4px;"><strong>${otp}</strong></p>
      <p>If you did not start company setup, you can ignore this email.</p>
    `,
  });

const autoCheckoutEmail = (employee, attendance) =>
  sendEmail({
    to: employee.email,
    subject: 'Auto Check-out Notification',
    html: `
      <h2>Auto Check-out Applied</h2>
      <p>Hi ${employee.first_name},</p>
      <p>You forgot to check out on ${attendance.check_in_time}. An automatic check-out was applied at 4:00 AM.</p>
      <p>Total hours: ${attendance.total_hours}</p>
    `,
  });

const announcementEmail = (employee, announcement, options = {}) => {
  const priority = String(announcement.priority || 'medium').toUpperCase();
  const appUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const contentHtml = escapeHtml(announcement.content).replace(/\n/g, '<br/>');
  const subject = options.subject
    || `[${priority}] ${announcement.title}`;

  return sendEmail({
    to: employee.email,
    subject,
    html: `
      <h2>${escapeHtml(announcement.title)}</h2>
      <p>Hi ${escapeHtml(employee.first_name || 'there')},</p>
      <p><strong>Priority:</strong> ${priority}</p>
      <div>${contentHtml}</div>
      <p style="margin-top: 24px;">
        <a href="${appUrl}/announcements">View announcement in HRMS</a>
      </p>
    `,
  });
};

const trainingAssignmentEmail = (employee, training) =>
  sendEmail({
    to: employee.email,
    subject: `Training Assigned: ${training.title}`,
    html: `
      <h2>New Training Assignment</h2>
      <p>You have been assigned to: <strong>${training.title}</strong></p>
      <p>Start: ${training.start_date} | End: ${training.end_date}</p>
      <p>Mode: ${training.training_mode}</p>
    `,
  });

const getAppUrl = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

/** Generic email for in-app notifications (leave pending, WFH, tickets, etc.). */
const notificationEmail = (employee, { title, message, link, type }) => {
  const appUrl = getAppUrl();
  const actionUrl = link ? `${appUrl}${link.startsWith('/') ? link : `/${link}`}` : appUrl;
  const typeLabel = type ? String(type).replace(/_/g, ' ') : 'Notification';

  return sendEmail({
    to: employee.email,
    subject: title || 'HRMS notification',
    html: `
      <h2>${escapeHtml(title || 'Notification')}</h2>
      <p>Hi ${escapeHtml(employee.first_name || 'there')},</p>
      <p>${escapeHtml(message || '').replace(/\n/g, '<br/>')}</p>
      ${type ? `<p style="color:#666;font-size:12px;">Type: ${escapeHtml(typeLabel)}</p>` : ''}
      <p style="margin-top: 24px;">
        <a href="${actionUrl}">Open in HRMS</a>
      </p>
    `,
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
