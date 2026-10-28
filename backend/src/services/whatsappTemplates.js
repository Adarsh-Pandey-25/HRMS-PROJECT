/**
 * Every WhatsApp template SpaxSync sends, exactly as submitted to Meta for
 * approval (Super Admin → WhatsApp → Templates submits the missing ones).
 *
 * Meta's rules these follow (template guidelines, checked 28 Oct 2026):
 *  - a business-started message must be an approved template;
 *  - UTILITY = non-promotional and about something the person did or must
 *    know; anything promotional or mixed is MARKETING. Misfiling marketing
 *    as utility gets every utility template restricted for 7–30 days, so
 *    company news and celebrations are honestly MARKETING;
 *  - the body may not start or end with a {{n}} blank, and every blank needs
 *    a sample value.
 *
 * No template carries a salary, an amount, a leave reason, a password, a
 * code or a sign-in link — the message says what happened and points to
 * SpaxSync for the rest.
 */

const LANGUAGE = 'en';
const FOOTER = 'Reply STOP to turn off WhatsApp updates';
// Marketing templates carry a quick-reply button; tapping it sends this
// payload back to the webhook, which switches news and celebrations off.
const STOP_BUTTON_TEXT = 'Stop these updates';
const STOP_MARKETING_PAYLOAD = 'WA_STOP_MARKETING';

const COMPANY = 'Spaxads Digital Media';

const utility = (name, body, example) => ({ name, category: 'UTILITY', body, example });
const marketing = (name, body, example) => ({ name, category: 'MARKETING', body, example });

const TEMPLATES = [
  // ── Leave ────────────────────────────────────────────────────────────────
  utility('leave_request_sent',
    'Hi {{1}}, your {{2}} request for {{3}} at {{4}} has been sent for approval. We will let you know when it is decided.',
    ['Priya', 'Casual Leave', '3–4 Nov 2026', COMPANY]),
  utility('approval_waiting',
    'Hi {{1}}, {{2}} at {{3}} is waiting for your approval: {{4}}. Please review it in SpaxSync.',
    ['Rahul', 'Priya Verma', COMPANY, 'Casual Leave for 3–4 Nov 2026']),
  utility('leave_approved',
    'Hi {{1}}, your {{2}} for {{3}} has been approved by {{4}} at {{5}}. You can see the details in SpaxSync.',
    ['Priya', 'Casual Leave', '3–4 Nov 2026', 'Rahul Sharma', COMPANY]),
  utility('leave_not_approved',
    'Hi {{1}}, your {{2}} for {{3}} was not approved by {{4}} at {{5}}. Please open SpaxSync to see the details.',
    ['Priya', 'Casual Leave', '3–4 Nov 2026', 'Rahul Sharma', COMPANY]),
  utility('leave_balance_updated',
    'Hi {{1}}, HR has updated your {{2}} balance at {{3}}. You now have {{4}} days. You can see the details in SpaxSync.',
    ['Priya', 'Casual Leave', COMPANY, '8']),
  utility('leave_balance_changed_admin',
    'Hi {{1}}, the {{2}} balance of {{3}} at {{4}} was changed from {{5}} to {{6}} days. You can see the details in SpaxSync.',
    ['Anil', 'Casual Leave', 'Priya Verma', COMPANY, '6', '8']),
  utility('leave_balance_low',
    'Hi {{1}}, you have {{2}} days of {{3}} left at {{4}}. Please plan your leave in SpaxSync.',
    ['Priya', '2', 'Casual Leave', COMPANY]),

  // ── Attendance ───────────────────────────────────────────────────────────
  utility('attendance_absent',
    'Hi {{1}}, no check-in was found for you on {{2}} at {{3}}. If this is wrong, please request a correction in SpaxSync.',
    ['Priya', '27 Oct 2026', COMPANY]),
  utility('attendance_late',
    'Hi {{1}}, you were marked late by {{2}} on {{3}} at {{4}}. If this is wrong, please request a correction in SpaxSync.',
    ['Priya', '42 minutes', '27 Oct 2026', COMPANY]),
  utility('attendance_short_hours',
    'Hi {{1}}, you worked {{2}} on {{3}} at {{4}}, less than the expected {{5}}. If this is wrong, please request a correction in SpaxSync.',
    ['Priya', '6h 10m', '27 Oct 2026', COMPANY, '8h']),
  utility('attendance_summary',
    'Hi {{1}}, attendance summary for {{2}} on {{3}}: {{4}} absent, {{5}} late and {{6}} with short hours. See the full list in SpaxSync.',
    ['Neha', COMPANY, '27 Oct 2026', '3', '5', '2']),
  utility('auto_checkout',
    'Hi {{1}}, you did not check out on {{2}} at {{3}}, so SpaxSync closed your day automatically. If that is wrong, please request a correction in SpaxSync.',
    ['Priya', '27 Oct 2026', COMPANY]),
  utility('attendance_correction_update',
    'Hi {{1}}, your attendance correction for {{2}} at {{3}} was {{4}}. Please open SpaxSync for the details.',
    ['Priya', '27 Oct 2026', COMPANY, 'approved']),

  // ── Payroll ──────────────────────────────────────────────────────────────
  utility('payslip_ready',
    'Hi {{1}}, your payslip for {{2}} from {{3}} is now available. Please open SpaxSync to view or download it.',
    ['Priya', 'October 2026', COMPANY]),
  utility('salary_revised',
    'Hi {{1}}, your salary at {{2}} has been revised with effect from {{3}}. Please open SpaxSync to see the details.',
    ['Priya', COMPANY, '1 Nov 2026']),
  utility('payroll_setup_changed',
    'Hi {{1}}, the payroll setup for {{2}} at {{3}} was changed: {{4}}. Please open SpaxSync for the details.',
    ['Anil', 'Priya Verma', COMPANY, 'PF switched on']),

  // ── HR summaries, recruitment, account ───────────────────────────────────
  utility('approvals_summary',
    'Hi {{1}}, {{2}} approvals are waiting for you at {{3}}. Please review them in SpaxSync.',
    ['Neha', '6', COMPANY]),
  utility('people_summary',
    'Hi {{1}}, this week at {{2}}: {{3}} joined, {{4}} left, and the headcount is {{5}}. See the details in SpaxSync.',
    ['Neha', COMPANY, '2', '1', '48']),
  utility('offer_response',
    'Hi {{1}}, {{2}} has {{3}} the offer for {{4}} at {{5}}. Please open SpaxSync for the details.',
    ['Neha', 'Amit Kumar', 'accepted', 'Graphic Designer', COMPANY]),
  utility('account_deactivated',
    'Hi {{1}}, your SpaxSync account at {{2}} has been deactivated. Please contact your HR team if you think this is a mistake.',
    ['Priya', COMPANY]),

  // ── Security, billing, platform ──────────────────────────────────────────
  utility('security_alert',
    'Hi {{1}}, security notice for {{2}}: {{3}}. Please check it in SpaxSync.',
    ['Anil', COMPANY, 'a new API key "Payroll export" was created by Anil Gupta']),
  utility('billing_update',
    'Hi {{1}}, an update on the SpaxSync subscription of {{2}}: {{3}}. Please open Billing in SpaxSync for the details.',
    ['Anil', COMPANY, 'your payment did not go through']),
  utility('platform_alert',
    'SpaxSync platform alert: {{1}}. Please check the super admin console.',
    ['the background job autoPayroll failed']),

  // ── Requests and helpdesk ────────────────────────────────────────────────
  utility('wfh_update',
    'Hi {{1}}, your work-from-home request for {{2}} at {{3}} was {{4}}. Please open SpaxSync for the details.',
    ['Priya', '5 Nov 2026', COMPANY, 'approved']),
  utility('expense_update',
    'Hi {{1}}, your expense claim {{2}} at {{3}} was {{4}}. Please open SpaxSync for the details.',
    ['Priya', '"Client visit travel"', COMPANY, 'approved']),
  utility('ticket_new',
    'Hi {{1}}, {{2}} raised a new helpdesk ticket at {{3}}: {{4}}. Please open SpaxSync to respond.',
    ['Neha', 'Priya Verma', COMPANY, '"Laptop not charging"']),
  utility('ticket_update',
    'Hi {{1}}, your helpdesk ticket {{2}} at {{3}} is now {{4}}. Please open SpaxSync to see the update.',
    ['Priya', '"Laptop not charging"', COMPANY, 'resolved']),
  utility('ticket_reply',
    'Hi {{1}}, there is a new reply on the helpdesk ticket {{2}} at {{3}}. Please open SpaxSync to read it.',
    ['Priya', '"Laptop not charging"', COMPANY]),
  utility('document_uploaded',
    'Hi {{1}}, {{2}} uploaded the document {{3}} at {{4}} for review. Please check it in SpaxSync.',
    ['Neha', 'Priya Verma', '"PAN card"', COMPANY]),
  utility('document_verified',
    'Hi {{1}}, your document {{2}} at {{3}} was {{4}}. Please open SpaxSync for the details.',
    ['Priya', '"PAN card"', COMPANY, 'verified']),
  utility('training_overdue',
    'Hi {{1}}, your course {{2}} at {{3}} is overdue. Please complete it in SpaxSync.',
    ['Priya', '"POSH awareness"', COMPANY]),
  utility('general_update',
    'Hi {{1}}, you have a new update at {{2}}: {{3}}. Please open SpaxSync for the details.',
    ['Priya', COMPANY, 'Onboarding checklist reminder']),

  // ── Company news and celebrations (Meta prices these as marketing) ───────
  marketing('company_announcement',
    'Hi {{1}}, {{2}} has a new announcement: {{3}}. Open SpaxSync to read it.',
    ['Priya', COMPANY, '"Office closed on 1 Nov"']),
  marketing('holiday_list',
    'Hi {{1}}, {{2}} has published its holiday list for {{3}}. Open SpaxSync to see all the dates.',
    ['Priya', COMPANY, '2027']),
  marketing('birthday_wish',
    'Happy birthday, {{1}}! 🎂 Everyone at {{2}} wishes you a wonderful year ahead.',
    ['Priya', COMPANY]),
  marketing('work_anniversary',
    'Happy work anniversary, {{1}}! 🎉 Thank you for {{2}} with {{3}}. We are glad to have you.',
    ['Priya', '3 years', COMPANY]),
  marketing('team_birthday',
    'Hi {{1}}, today is the birthday of {{2}} at {{3}}. 🎂 Send your wishes in SpaxSync!',
    ['Rahul', 'Priya Verma', COMPANY]),
  marketing('team_anniversary',
    'Hi {{1}}, {{2}} completes {{3}} at {{4}} today. 🎉 Send your congratulations in SpaxSync!',
    ['Rahul', 'Priya Verma', '3 years', COMPANY]),
];

const BY_NAME = new Map(TEMPLATES.map((t) => [t.name, t]));

const getTemplate = (name) => BY_NAME.get(name) || null;

/** Number of {{n}} blanks in the body. */
const paramCount = (template) => new Set(template.body.match(/\{\{\d+\}\}/g) || []).size;

const isMarketing = (template) => template?.category === 'MARKETING';

/** The request body for POST /{WABA_ID}/message_templates. */
const toCreatePayload = (template) => {
  const components = [
    {
      type: 'BODY',
      text: template.body,
      ...(paramCount(template) ? { example: { body_text: [template.example] } } : {}),
    },
    { type: 'FOOTER', text: FOOTER },
  ];
  if (isMarketing(template)) {
    components.push({ type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: STOP_BUTTON_TEXT }] });
  }
  return {
    name: template.name,
    language: LANGUAGE,
    category: template.category,
    components,
  };
};

/** Why Meta would reject this template, or [] — used by the tests and before submitting. */
const templateProblems = (template) => {
  const problems = [];
  const body = template.body.trim();
  const numbers = (body.match(/\{\{(\d+)\}\}/g) || []).map((m) => Number(m.slice(2, -2)));
  const distinct = [...new Set(numbers)].sort((a, b) => a - b);
  if (!/^[a-z][a-z0-9_]{0,511}$/.test(template.name)) problems.push('name must be lowercase letters, digits and _');
  if (!['UTILITY', 'MARKETING'].includes(template.category)) problems.push('category must be UTILITY or MARKETING');
  if (/^\{\{\d+\}\}/.test(body)) problems.push('body starts with a blank');
  if (/\{\{\d+\}\}[\s.!?…]*$/.test(body)) problems.push('body ends with a blank');
  if (distinct.some((n, i) => n !== i + 1)) problems.push('blanks must be numbered 1..n');
  if (/\}\}\s*\{\{/.test(body)) problems.push('two blanks next to each other');
  if ((template.example || []).length !== distinct.length) problems.push('one sample value per blank');
  if (body.length > 1024) problems.push('body over 1024 characters');
  if (FOOTER.length > 60) problems.push('footer over 60 characters');
  if (STOP_BUTTON_TEXT.length > 25) problems.push('button text over 25 characters');
  return problems;
};

module.exports = {
  LANGUAGE,
  FOOTER,
  STOP_BUTTON_TEXT,
  STOP_MARKETING_PAYLOAD,
  TEMPLATES,
  getTemplate,
  paramCount,
  isMarketing,
  toCreatePayload,
  templateProblems,
};
