const { createTransporter } = require('../config/email');
const logger = require('../utils/logger');

const sendEmail = async ({ to, subject, html, text }) => {
  const transporter = createTransporter();

  if (!transporter) {
    logger.info('Email (mock)', { to, subject });
    return { success: true, mock: true };
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    });
    logger.info('Email sent', { to, messageId: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error('Email send failed', { to, error: err.message });
    throw err;
  }
};

const welcomeEmail = (employee, tempPassword) =>
  sendEmail({
    to: employee.email,
    subject: 'Welcome to HRMS',
    html: `
      <h2>Welcome ${employee.first_name}!</h2>
      <p>Your HRMS account has been created.</p>
      <p><strong>Employee Code:</strong> ${employee.employee_code}</p>
      <p><strong>Email:</strong> ${employee.email}</p>
      ${tempPassword ? `<p><strong>Temporary Password:</strong> ${tempPassword}</p>` : ''}
      <p>Please login and change your password immediately.</p>
    `,
  });

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

const announcementEmail = (employee, announcement) =>
  sendEmail({
    to: employee.email,
    subject: `[${announcement.priority.toUpperCase()}] ${announcement.title}`,
    html: `
      <h2>${announcement.title}</h2>
      <p>${announcement.content}</p>
    `,
  });

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

module.exports = {
  sendEmail,
  welcomeEmail,
  leaveStatusEmail,
  payslipEmail,
  passwordResetEmail,
  autoCheckoutEmail,
  announcementEmail,
  trainingAssignmentEmail,
};
