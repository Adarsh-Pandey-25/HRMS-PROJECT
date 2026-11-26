# WhatsApp notifications: progress

*Branch `whatsapp-integration` · updated 2 Nov 2026*

## Status
| Part | State |
|---|---|
| Server: sending, queue, retries, pause, safety locks | ✅ Built and tested |
| Server: webhook (Meta signature), JOIN / STOP / START / HELP, delivery ticks | ✅ Built and tested |
| Every email and in-app notification → WhatsApp (except the 10 in the guide) | ✅ Built and tested |
| Company switch and groups, each person's groups, paid add-on | ✅ Built |
| Website: profile card, Settings → Integrations card, Super Admin → WhatsApp | ✅ Built (lint and build pass) |
| Database update (new tables) | ✅ Run by you and verified (28 Oct) |
| First real message ("hello world" from Meta's test number to +91•••••59029) | ✅ Sent 28 Oct |
| Templates on Meta's test account | ✅ All 38 approved; Meta filed 4 as marketing (offer response, security alert, platform alert, general update) |
| Add-on switched on for Spaxads | ✅ For testing (the live server still has WhatsApp off) |
| Real SpaxSync number | ✅ +91 88266 92158 in its own WhatsApp account **SpaxSync** (ID 1679366050470693), separate from 1MissionVault. Your PC uses it since 29 Oct, still only for your 3 numbers |
| Payment method | ✅ Added in Meta |
| Permanent token | ✅ On the live server (29 Oct); never expires |
| Meta app: Live mode, webhooks on for SpaxSync only | ✅ Meta's messages reach spaxsync.com since 29 Oct |
| Templates on the SpaxSync account | ✅ All 39 approved by 2 Nov, including `approval_request` |
| Go-live on the real server | ✅ WhatsApp on since 29 Oct; only people who connect get messages |
| Connect your WhatsApp from your profile | ✅ Tested in Spaxads and DEMO; first real approval message delivered 30 Oct |
| Approve / Reject on WhatsApp, with the reason (leave, work from home, expenses, attendance corrections) | ✅ Live since 30 Oct; first leave and work-from-home requests approved from WhatsApp that day |
| "Submit to Meta" page error (502) when sending many templates | ✅ Fixed and live: sends 10 at a time |
| Automatic connection: the mobile number is compulsory in Add employee and Bulk import, and WhatsApp connects to it on save, with your welcome message | ✅ Built and tested (2 Nov), wording chosen by you, pushed 2 Nov. ⏳ To go live: deploy (server and website); `welcome_new_employee` and `hr_updates_on_whatsapp` then go to Meta by themselves |
| Existing employees: connected by themselves after the deploy (4 Nov, your decision): new templates go to Meta by themselves, and once the announcement is approved every company with WhatsApp on is connected (200 a day at most). "Connect everyone" still does it at once | ✅ Built and tested (4 Nov). ⏳ To go live: your OK to push, then deploy |
| First message for existing employees (18 Nov): Meta filed `hr_updates_on_whatsapp` as marketing, so its limits held it back from 4 of 31 people (131049, 130472). The new `whatsapp_number_linked` is a plain account update (utility), and the 4 get it once by themselves when Meta approves it. One number can't receive WhatsApp (131026): HR checks it with the employee | ✅ Built, tested and pushed (18 Nov, `395504b`). ⏳ To go live: deploy |
| Numbers from other countries (18 Nov): every employee phone field has a country code picker (India +91 first), and Bulk import takes +971 … style numbers. A number from abroad is kept with its code and WhatsApp sends to it; Indian numbers are kept and sent exactly as before. Fixing the 131026 number to the employee's UAE number moves their connection and sends their first message. Meta charges more per message outside India | ✅ Built, tested and pushed (18 Nov). ⏳ To go live: deploy, including the website build; then HR fixes that number on the live site |
| Biometric machine on a new internet address (20 Nov): its punches are kept, not refused (on 20 Nov the Spaxads machine never re-sent the morning's refused punches), and count once someone approves the new IP. Approve / Reject on WhatsApp (the `approval_request` template, already approved) to the people chosen in Settings → Attendance → Biometric Devices → Who approves a new IP: every HR and Admin by default, plus any tech team member ticked. Allow new IP and Reject on the website too | ✅ Built and tested, SQL `20261120_adms_kept_punches.sql` run, pushed (20 Nov). ⏳ To go live: deploy with the website build |
| Settings → Integrations → WhatsApp (HR/admin): switching WhatsApp off now also stops messages already waiting to be sent | ✅ Built and tested (4 Nov). ⏳ Same push and deploy |
| An On / Off switch for each message in Super Admin → WhatsApp → Templates (26 Nov). Off: nobody in any company gets that WhatsApp message, including ones already waiting; emails and in-app notifications still go. Everything stays on until you switch something off. With `approval_request` off, approvers get the plain `approval_waiting` instead. The first messages and the verification code are always on | ✅ Built, tested and pushed (26 Nov). ⏳ To go live: run SQL `20261126_whatsapp_template_switches.sql`, deploy with the website build |
| Careers API (26 Nov): someone applies on the company's own website (spaxads.com) → HR gets one WhatsApp, new template `new_application` ("Hi Neha, Amit Kumar applied for Ad Sales - CPI at Spaxads on your careers website…"). Utility; waits in the queue until Meta approves it; the live server submits it by itself. The candidate gets an email only (not a SpaxSync user). CAREERS_API.md | ✅ Built, tested and pushed (26 Nov). ⏳ To go live: run SQL `20261126_careers_api.sql`, deploy with the website build |
| Settings → Approval Flows: leave, work from home and expenses, 4 choices each (corrections stay HR only); WhatsApp follows them | ✅ Built and tested (2 Nov), pushed 2 Nov; SQL `20261102_wfh_approval_flow.sql` run 3 Nov. ⏳ To go live: deploy (server and website) |
| Business verification | ⏳ You (WHATSAPP_GO_LIVE.md, section 2) |

**Nothing changes for anyone yet.** WhatsApp stays off until `WHATSAPP_ENABLED=true`, and then only for companies where a super admin switches the add-on on. Emails and in-app notifications work exactly as before.

## Your next steps
Follow **WHATSAPP_GO_LIVE.md**: section 3A for the test on your PC, then 3B–3C for the server.

On your PC, `WHATSAPP_ALLOWED_RECIPIENTS` in `backend/.env` is the safety lock: your PC can only ever message the numbers listed there. You type the secrets (token, App Secret) into `.env` yourself; never paste them in chat.

## Where things are
- **Plan and beginner guide:** `WHATSAPP_INTEGRATION_GUIDE.md`
- **Who gets what, and going live:** `WHATSAPP_GO_LIVE.md`
- **Builder's master prompt:** `WHATSAPP_MASTER_PROMPT.md`
- **Server:**
  - `backend/src/services/whatsapp*.js`
  - `backend/src/config/whatsapp.js`
  - `backend/src/routes/*whatsapp*`
  - `backend/src/controllers/*whatsapp*`
  - database updates: `backend/supabase/migrations/20261028_whatsapp_channel.sql`, `20261030_whatsapp_approval_buttons.sql`, `20261102_wfh_approval_flow.sql`
  - approval buttons: `backend/src/services/whatsappApprovals.service.js` (runs the website's own approve / reject handlers; doesn't change them)
- **Website:**
  - `HRMS/src/components/whatsapp/WhatsAppUpdatesCard.jsx`
  - `HRMS/src/pages/settings/WhatsAppIntegrationCard.jsx`
  - `HRMS/src/pages/super-admin/WhatsApp.jsx`
  - `HRMS/src/api/whatsapp.api.js`

## Small additions inside existing files (all inert while WhatsApp is off)
- **Server:**
  - `app.js`: the webhook and the new addresses
  - `server.js`: starts the sender only when switched on
  - `email.service.js` and `notification.service.js`: hand a copy to WhatsApp
  - `featureRegistry.js`: the add-on
  - `.env.example` and `README.md`: notes
- **Website:**
  - `GenericSections.jsx`: the WhatsApp card
  - `EmployeeProfile.jsx`: the card on your own profile
  - `App.jsx` and `SuperAdminLayout.jsx`: the super admin page and menu item
- **Automatic connection (2 Nov):**
  - `employee.controller.js`: connects WhatsApp after Add employee, and moves it when the number changes (does nothing while WhatsApp is off)
  - **Always on, with or without WhatsApp:** the mobile number is compulsory when adding someone (`validators.js`, `EmployeeForm.jsx`, `BulkImportPanel.jsx`)
- **Approval Flows (2 Nov, always on, with or without WhatsApp):**
  - Server: `approvalFlow.service.js` (the 4th choice, work-from-home flow), `wfhRequest.service.js` (who is asked, the manager step, each queue), `leave.service.js` and `reimbursement.controller.js` (who is asked first), `dashboard.service.js` (HR's queue)
  - Website: `ApprovalFlowsSection.jsx` (new page), `Settings.jsx`, `lib/approvalFlow.js`, `LeaveApprovals.jsx`, `ExpenseApprovals.jsx`, `WfhApprovals.jsx`, `settingsStore.js`, `useSettings.js`; `LeavePolicySection.jsx` and `GenericSections.jsx` now point to the new page
  - WhatsApp: `whatsappCatalog.js` (HR's step on work from home), `whatsappApprovals.service.js` (the reply after a manager's first step)
