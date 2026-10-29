# Master prompt: build WhatsApp notifications for SpaxSync HRMS

> **Owner: how to use this.**
> 1. Close any older Claude session that is still running the website, server or Expo for this project.
> 2. Open a new Claude Code session (Opus) in `C:\Users\DELL\Desktop\HRMS-PROJECT`.
> 3. Type: **"Read WHATSAPP_MASTER_PROMPT.md and follow it. Start with Phase 0."**
>
> The builder will ask you the open questions in section 5 before changing anything.

*Written 28 October 2026. Everything below about this codebase was checked against the code on that date. File and line references can drift, so re-check them before editing.*

---

## 1. Your role and the standard

You are a senior full-stack engineer with 10+ years of experience in Node.js/Express, PostgreSQL/Supabase, React and the **WhatsApp Business Platform (Cloud API)**, and you are security-first. The owner is a **beginner** and this is a **live, multi-company production product**. Work like it.

**Done** means all of these:
- It works end to end on a real phone.
- It's covered by automated tests.
- Nothing that worked before behaves differently.
- No secret is ever exposed.
- The owner was told, in plain words, how to test it.

Prefer the codebase's existing patterns over inventing new ones. Match its style: CommonJS, `services` / `controllers` / `routes`, `logger`, `utils/errors`, `supabaseAdmin`, and its comment density.

---

## 2. Hard rules (never break these)

1. **Additive only.** Emails, in-app notifications, the website, the mobile app and every existing API must behave **exactly** as today. WhatsApp is an extra copy and starts **switched off**. Don't fix existing quirks unless the owner asks; they're listed in `WHATSAPP_INTEGRATION_GUIDE.md` Appendix D.
2. **`backend/.env` on the owner's PC points at the LIVE production database**, with real SMTP.
   - Never start the backend with plain `npm start` or `npm run dev`. Use `DISABLE_CRONS=true` always (section 10).
   - Never run SQL, migrations or any script that writes to a database without the owner's explicit OK for **that** action.
   - Never edit `backend/.env`. The owner edits it.
3. **No message may reach a real employee during development.** Outside production, WhatsApp may only send to numbers in `WHATSAPP_ALLOWED_RECIPIENTS`. If that list is empty, send nothing. The owner tests with **their own accounts in their own company** (decided 28 Oct 2026: no separate test company); during testing only the owner connects WhatsApp.
4. **Secrets:**
   - Access tokens, the App Secret and the verify token live **only** in env settings.
   - Never put them in code, git, logs, chat output, company settings (`GET /api/settings` returns every setting to HR/Admin browsers), or the frontend.
   - The owner pasted a **temporary** Meta access token into an earlier chat on 28 Oct 2026. **Never use it, never copy it anywhere.** It expires by itself. The build uses a **permanent system-user token** the owner types into `backend/.env`.
5. **Git:**
   - Work on a new branch `whatsapp-integration` created **from `main`**. Never commit to `main`.
   - Never push, merge or open a PR without the owner's OK.
   - Small commits per phase.
   - Switching from the `mobile-app` branch removes `mobile/` source files from the working tree (they exist only on that branch). Make sure no Expo server is running first, and tell the owner.
6. **Scope:**
   - Don't touch `mobile/` (the phone app lives on branch `mobile-app`; WhatsApp in the app is a later, separate task).
   - Don't change the outgoing-webhooks feature (`/api/webhooks`).
7. **Ask the owner first** before any of these:
   - adding a dependency;
   - running anything that writes to a database;
   - submitting or changing templates or settings at Meta;
   - sending the first real WhatsApp message;
   - changing an existing behaviour;
   - anything on the live server or Cloudflare.
8. **Facts change.** Before relying on a WhatsApp fact in section 4, re-check Meta's official docs (developers.facebook.com, WhatsApp Business Platform), especially the current Graph API version, error codes and template rules.

---

## 3. Project facts (verified 28 Oct 2026)

### Repo and hosting
- `backend/`: Express 4, CommonJS, Supabase (`@supabase/supabase-js` with the service role), node-cron, nodemailer, winston. Node ≥ 20.
- `HRMS/`: the React/Vite website, multi-tenant at `{slug}.spaxsync.com`. `npm run dev` serves on **5173** and proxies `/api` to **127.0.0.1:5000**.
- `mobile/`: Expo app, on branch `mobile-app` only.
- **Production:** AWS EC2 + nginx (`deploy/nginx/hrms.conf`: `location ^~ /api/` goes to `127.0.0.1:5050`) + pm2 (`hrms-backend`), with **Cloudflare in front**. Deploy steps are in `README.md` (around line 113). Other production apps share the box, so **never restart nginx**; only `nginx -t` then reload.
- **Migrations:**
  - Location: `backend/supabase/migrations/YYYYMMDD_snake_case.sql`, run **by hand** in the Supabase SQL editor.
  - Make them re-runnable (`IF NOT EXISTS`).
  - List each one in `README.md` (migration order, around lines 67–103), and end it by inserting itself into `schema_migrations` (see `20260915_schema_migrations_tracking.sql`).
  - Enable RLS with no policies, like `20260930_email_log_and_preferences.sql` (`ALTER TABLE … ENABLE ROW LEVEL SECURITY;`).
- **Tests:** the owner doesn't want a tests folder in the repo; `backend/tests/whatsapp/` was removed on 29 Oct 2026. Don't commit test files without the owner's OK.
  - Any throwaway tests you run to check your work stay out of git and **never touch a real database:** mock `src/config/supabase` and set env in the test; don't load `.env`.

### Request pipeline: `backend/src/app.js`
- `/iclock` is mounted at :98 **before** `express.json` (:100), with its own limiter. After the parsers come `generalLimiter` (:103), `resolveTenantSubdomain` (:104) and `hostScope` (:105).
- There is a 25 s request timeout (:109). `requireCsrfHeader` applies to everything under `/api` (:154).
- `/api/webhooks` (:195) is **already used** for companies' outgoing webhooks, so don't put WhatsApp there.
- **CSRF** (`middleware/csrf.middleware.js:50-51`): every `/api` POST needs `X-Requested-With: XMLHttpRequest`, except requests with `x-beacon-secret`. Meta won't send that header.
- **Host scope** (`middleware/hostScope.middleware.js:20-22`): on the apex host only `/api/public/`, `/api/super-admin/` and `/api/auth/onboarding/` are allowed.
- `express.json` keeps no raw body, which is needed for signature checks.
- So **mount the WhatsApp webhook like `/iclock`, before the parsers**, with `express.raw({ type: 'application/json', limit: '1mb' })` and its own rate limiter. Suggested path: **`/api/whatsapp/webhook`**. nginx already proxies `/api/`.
- `server.js`:
  - **An unhandled promise rejection exits the process** (:109). Every fire-and-forget call needs `.catch`.
  - `DISABLE_CRONS=true` skips all scheduled jobs (:78).
  - Background helpers: `utils/background.js` (`runInBackground`), `utils/concurrency.js` (`forEachWithLimit`), `utils/cronLock.js` (`withCronLock`, DB lock).

### Notifications today (the two places to hook)
- **Every email** comes from a template exported by `backend/src/services/email.service.js`. Each export is wrapped at :1997-1999:
  - company templates by `withRecipientLinks(name, fn)` (:1986);
  - platform templates by `withEmailType` (:1993).
  - The wrapper knows the **email type** (`templateTypeKey(name)`, :1981) and the **structured arguments**: the recipient is `args[0]` (an employee row), plus rows like the leave. `resolveLinkContext` (:1942) resolves `companyId`.
  - `sendEmail` (:316) applies per-company email switches and logs to `email_log`.
  - Some call sites wrap sends in `guardedSend` (`services/emailSuppression.service.js`), which suppresses emails for hidden features. A suppressed template is never called, so no WhatsApp follows. That's correct.
- **The email catalogue** `backend/src/services/emailCatalog.js`:
  - `EMAIL_TYPES` (:84-171) has **63 types: 56 live, 7 with `live:false`**, and `PREFERENCES` (:42-75).
  - Each type has an `audience` and a `lock` (`credentials`, `security`, `billing` or `platform`).
- **In-app notifications:** `backend/src/services/notification.service.js`.
  - `createNotification` (:104) and `createNotifications` (:137) insert into `notifications` (columns: `user_id, type, title, message, link, meta, is_read, created_at`).
  - They call `dispatchNotificationEmails` (:85), which sends the generic `notification` email copy. That copy is filtered by the company's `notification_config` (:35-68), which **guesses the event from the title** (:13-32).
  - Find every call site with a search for `createNotification(`.
- **Company settings** live in `system_settings` with key `t:{companyId}:{key}` (`services/settings.service.js`). The generic `PUT /api/settings/:key` has **no validation**. Put WhatsApp settings in **dedicated tables and endpoints** instead.
- **Plans and features:**
  - `backend/src/config/featureRegistry.js` (`FEATURE_REGISTRY`).
  - `services/featureOverride.service.js` (`hasFeature`).
  - `middleware/featureGate.middleware.js` (`requireFeature`).
  - The `comingSoon` + `requiresPlatformFlag` pattern forces a feature off everywhere until an env flag is `'true'`.
- **Phone numbers:** `employees.phone VARCHAR(20)` comes in mixed formats (10 digits, or `+91 98765-43210`). **Don't rely on it.** The `JOIN` flow (section 6.2) gets the exact WhatsApp identity from Meta.
- **Website:**
  - `HRMS/src/pages/settings/GenericSections.jsx:701` has a disabled **"WhatsApp Business — Coming soon"** card in Integrations.
  - `HRMS/src/pages/settings/NotificationsSection.jsx` (notification settings).
  - `HRMS/src/pages/employees/EmployeeProfile.jsx` (profile).
  - `HRMS/src/pages/super-admin/EmailLog.jsx` (a model for a WhatsApp log page).
  - Routes are in `HRMS/src/App.jsx`. Follow the existing `src/api/*.api.js` + react-query patterns and UI components. Lint with `npm run lint` (oxlint).

### The owner's Meta assets (not secret)
- **Test** business number: **+1 555-640-4486** (Meta's free test number; it can only message up to 5 verified recipient numbers).
- Phone Number ID (test): **1190725527466222**.
- WhatsApp Business Account ID (test): **2576101372811240**.
- Still to come from the owner:
  - **App ID** (not secret);
  - the **permanent system-user token** and **App Secret** (secrets; the owner types them into `.env`);
  - later, the real SpaxSync number and its IDs.

---

## 4. WhatsApp platform facts (re-verify before relying on them)

- **Pricing (since 1 Jul 2025): per delivered message.** India list rates (rate card effective 1 Jul 2026):
  - Utility ~₹0.115
  - Marketing ~₹0.8631
  - Authentication ~₹0.115
- **Since 1 Oct 2026:**
  - Service (free-form) messages cost money after **1,000 free per business number per month**.
  - Utility templates sent inside an open service window are **charged** too.
  - A payment method is required.
- **India billing is in INR.** Eligible accounts must move to INR by 31 Dec 2026.
- **Messaging limits:**
  - They count **unique users per moving 24 h**, outside service windows, at **business-portfolio** level.
  - A new portfolio starts at **250**. It reaches **2,000** through business verification (or the quality/volume path), then 10K, 100K and unlimited automatically.
  - Throughput defaults to about 80 messages per second per number.
- **Opt-in is required.** It must state the person opts in, and name the business. It can be collected on a website or app. Opt-out must be clear and must be honoured.
- **Templates:**
  - Every business-initiated message outside a 24 h service window must be an **approved template**.
  - **Utility** must be non-promotional and specific to or requested by the user, or essential. Mixed or unclear content becomes Marketing.
  - **Misusing Utility is enforced** with warnings, rate limits, a utility restriction (all utility templates turned into marketing, and no new utility templates for 7–30 days), and portfolio restrictions. **Categorise honestly.**
  - A body can't start or end with a variable, and needs sample values.
  - Parameters can't contain newlines or tabs, or more than 4 consecutive spaces.
  - Marketing templates should offer an opt-out ("Stop promotions" quick reply).
- **BSUID (usernames):**
  - Since April 2026, inbound webhooks carry a business-scoped user ID (`user_id` / `from_user_id`).
  - The phone number (`from`, `wa_id`) **may be omitted** for users with usernames.
  - Sending to a BSUID works since **July 2026**, except one-tap, zero-tap and copy-code authentication templates.
  - Handle the `system` message types `user_changed_number` and `user_changed_user_id`.
  - Store both phone and BSUID, and send to the phone when known.
- **Webhooks:**
  - GET verification: `hub.mode=subscribe`, `hub.verify_token`, echo `hub.challenge`.
  - POST payloads are signed with `X-Hub-Signature-256: sha256=HMAC_SHA256(app_secret, raw_body)`. Verify with `crypto.timingSafeEqual`, and reply 200 quickly.
  - Status webhooks (`sent`, `delivered`, `read`, `failed`) include a `pricing` object (`billable`, `category`).
  - Ignore payloads for any `phone_number_id` other than ours.
  - Callback URLs can be overridden per WABA or per phone number. Check the docs; this is useful for test versus production.
- **Sending:** `POST https://graph.facebook.com/{version}/{PHONE_NUMBER_ID}/messages`.
  - Payload: `messaging_product:'whatsapp'`, `to`, `type:'template'`, `template:{ name, language:{ code:'en' }, components:[{ type:'body', parameters:[{ type:'text', text }] }] }`.
  - Make `{version}` a config value, set to the latest stable version at build time. Docs examples showed v23.0; v24.0+ adds `whatsapp_business_manager_messaging_limit`.
- **Templates through the API:**
  - Create with `POST /{WABA_ID}/message_templates` (`name`, `language`, `category`, `components` with examples).
  - Check status with `GET /{WABA_ID}/message_templates?fields=name,status,category,language`.
- **Error handling** (verify the codes on Meta's error-code page):
  - **Retry with backoff:** 130429 (throughput), 131056 (same-user pair rate limit), 131000 (generic), HTTP 5xx and timeouts.
  - **Don't retry; mark failed:** 131026 (undeliverable), 131049 (marketing limit for that user), 131050 (user stopped marketing; switch their marketing groups off), 132000/132012 (parameter mismatch), 132001 (template missing), 132015/132016 (template paused/disabled).
  - **190 / OAuthException** (bad token), 131031 (account locked) and 131042 (payment issue): pause sending platform-wide and alert the super admin.

---

## 5. Owner decisions

**Decided:**
- **Every notification goes to WhatsApp:** every email (except the 10 in §6.1 C) **and** every in-app notification. That includes **company news (announcements, holiday list) and celebrations (own birthday and anniversary wishes, and team birthday and anniversary announcements)**, all **on by default**.
- One **SpaxSync** business number for all companies. Each message names the company.
- **Direct Meta Cloud API**, no reseller. SpaxSync pays Meta.
- Employees connect with a one-tap **`JOIN` code**. Replying **STOP** turns it off.

**Recommended defaults** (confirm with the owner in Phase 0):
- English only.
- WhatsApp is a **plan feature** that the super admin switches on per company (there's no payment gateway yet).
- Approving or rejecting **from WhatsApp** comes later (Phase E).

**Ask the owner in Phase 0:**
1. The **legal company name** for Meta business verification.
2. Included in plans, or a paid add-on? Which plans?
3. **Where to test:** (a) a **separate Supabase test database** (safest; the live DB is untouched until go-live), or (b) run the new migration (it **only adds** tables) on the **live** DB after review, and test with the owner's own accounts. *(Decided 28 Oct 2026: (b), with no separate test company.)*
4. The **App ID**. Has the owner added their own WhatsApp number as a test recipient and received "hello world"? Has the permanent system-user token been created (guide Part D)?

---

## 6. What to build: product spec

### 6.1 Coverage: every notification

**A. Every live email type gets a WhatsApp decision.**
- In `emailCatalog.js`, add a `whatsapp` field to **every** entry: `{ template, category: 'utility' or 'marketing', group }`, or `{ never: '<reason>' }`.
- Write a **test that fails if any `EMAIL_TYPES` entry (including `live:false`) lacks it.**

Draft wording below. Keep messages short and factual, include the company name, and end with "open SpaxSync". No sensitive data (§6.4).

| Email type(s) | Group | Recipient | Template | Cat. | Draft wording |
|---|---|---|---|---|---|
| leave_applied | leave | employee | `leave_request_sent` | U | Hi {{1}}, your {{2}} request for {{3}} at {{4}} has been sent for approval. We'll let you know when it's decided. |
| leave_approval_request | leave | manager | `approval_waiting` | U | Hi {{1}}, {{2}} has asked for {{3}} for {{4}} at {{5}} and is waiting for your approval. Please review it in SpaxSync. |
| leave_approved | leave | employee | `leave_approved` | U | Hi {{1}}, your {{2}} for {{3}} has been approved by {{4}} at {{5}}. You can see the details in SpaxSync. |
| leave_rejected | leave | employee | `leave_not_approved` | U | Hi {{1}}, your {{2}} for {{3}} was not approved by {{4}} at {{5}}. Please open SpaxSync to see the details. |
| leave_balance_changed | leave | employee | `leave_balance_updated` | U | Hi {{1}}, HR has updated your {{2}} balance at {{3}}. You now have {{4}} days. |
| leave_balance_changed_admin | leave | admin | `leave_balance_changed_admin` | U | Hi {{1}}, {{2}}'s {{3}} balance at {{4}} was changed from {{5}} to {{6}} days. |
| leave_balance_low | leave | employee | `leave_balance_low` | U | Hi {{1}}, you have {{2}} days of {{3}} left at {{4}}. Please plan your leave in SpaxSync. |
| attendance_absent_alert | attendance | employee | `attendance_absent` | U | Hi {{1}}, no check-in was found for you on {{2}} at {{3}}. If this is wrong, please request a correction in SpaxSync. |
| attendance_late_alert | attendance | employee | `attendance_late` | U | Hi {{1}}, you were marked late on {{2}} at {{3}} (check-in at {{4}}). If this is wrong, please request a correction in SpaxSync. |
| attendance_short_hours_alert | attendance | employee | `attendance_short_hours` | U | Hi {{1}}, you worked {{2}} on {{3}} at {{4}}, less than the expected {{5}}. If this is wrong, please request a correction in SpaxSync. |
| attendance_anomaly_digest | summaries | HR | `attendance_summary` | U | Hi {{1}}, attendance summary for {{2}} on {{3}}: {{4}} absent, {{5}} late and {{6}} short hours. See the full list in SpaxSync. |
| auto_checkout | attendance | employee | `auto_checkout` | U | Hi {{1}}, you did not check out on {{2}} at {{3}}, so your day was closed at {{4}}. If that is wrong, please request a correction in SpaxSync. |
| regularization_approved / _rejected | attendance | employee | `attendance_correction_update` | U | Hi {{1}}, your attendance correction for {{2}} at {{3}} was {{4}}. Please open SpaxSync for the details. |
| payslip | payroll | employee | `payslip_ready` | U | Hi {{1}}, your payslip for {{2}} from {{3}} is now available. Please open SpaxSync to view or download it. |
| salary_revised | payroll | employee | `salary_revised` | U | Hi {{1}}, your salary at {{2}} has been revised with effect from {{3}}. Please open SpaxSync to see the details. |
| payroll_setup_changed_admin | payroll | admin | `payroll_setup_changed` | U | Hi {{1}}, the payroll setup for {{2}} at {{3}} was changed: {{4}}. Please open SpaxSync for the details. |
| pending_approvals_digest | summaries | HR | `approvals_summary` | U | Hi {{1}}, {{2}} approvals are waiting for you at {{3}}. Please review them in SpaxSync. |
| joiner_digest | summaries | HR | `people_summary` | U | Hi {{1}}, this week at {{2}}: {{3}} joined, {{4}} left, and the headcount is {{5}}. See the details in SpaxSync. |
| offer_accepted / offer_rejected | recruitment | HR | `offer_response` | U | Hi {{1}}, {{2}} has {{3}} the offer for {{4}} at {{5}}. Please open SpaxSync for the details. |
| account_deactivated | account | employee | `account_deactivated` | U | Hi {{1}}, your SpaxSync account at {{2}} has been deactivated. Please contact your HR team if you think this is a mistake. *(Afterwards, close their WhatsApp link.)* |
| api_key_created / _revoked, beacon_first_ping, beacon_compromise_alert, beacon_geo_mismatch | security | HR + admin | `security_alert` | U | Hi {{1}}, security notice for {{2}}: {{3}}. Please check it in SpaxSync. |
| 9 × subscription_* | billing | company admin | `billing_update` | U | Hi {{1}}, an update on {{2}}'s SpaxSync subscription: {{3}}. Please open Billing in SpaxSync for the details. |
| announcement | company_news | employees | `company_announcement` | **M** | Hi {{1}}, {{2}} has a new announcement: "{{3}}". Open SpaxSync to read it. |
| holiday_list | company_news | employees | `holiday_list` | **M** | Hi {{1}}, {{2}} has published its holiday list for {{3}}. Open SpaxSync to see all the dates. |
| birthday_wish | celebrations | employee | `birthday_wish` | **M** | Happy birthday, {{1}}! 🎂 Everyone at {{2}} wishes you a wonderful year ahead. |
| work_anniversary | celebrations | employee | `work_anniversary` | **M** | Happy work anniversary, {{1}}! 🎉 Thank you for {{2}} at {{3}}. |
| lead_notification, cron_failure_alert, adms_unauthorized_alert, adms_save_failure_alert, billing_alert | platform | **super admin** | `platform_alert` | U | SpaxSync platform alert: {{1}}. Please check the super admin console. |
| notification (generic in-app copy) | (see B) | | | | Handled by B, deduplicated. |

**B. Every in-app notification gets a WhatsApp decision.**
- Map each `createNotification` / `createNotifications` call site to a template. Prefer passing an explicit event key at the call site over guessing from the title.
- Where a dedicated email already covers the event (leave approved/rejected, the manager's approval request, payslip, announcement, holiday list, own birthday/anniversary, regularization decisions), **deduplicate** (§6.6).

| In-app event (file) | Recipient | Template | Cat. | Group |
|---|---|---|---|---|
| Leave applied, HR-only flow or no manager; manager approved and HR approval needed (`leave.service.js`) | HR / admin | `approval_waiting` | U | leave |
| WFH requested (`wfhRequest.service.js`) | manager or HR | `approval_waiting` | U | requests |
| WFH approved / rejected | employee | `wfh_update` ("Hi {{1}}, your work-from-home request for {{2}} at {{3}} was {{4}}. …") | U | requests |
| Expense submitted / needs HR approval (`reimbursement.controller.js`) | manager / HR | `approval_waiting` | U | requests |
| Expense approved / rejected | employee | `expense_update` ("Hi {{1}}, your expense claim "{{2}}" at {{3}} was {{4}}. …") | U | requests |
| Ticket raised (`helpdesk.service.js`) | HR / admin | `ticket_new` ("Hi {{1}}, {{2}} raised a new helpdesk ticket at {{3}}: "{{4}}". Please open SpaxSync to respond.") | U | requests |
| Ticket status changed | raiser | `ticket_update` (for regularization tickets, deduplicate with `attendance_correction_update`) | U | requests |
| Ticket comment | raiser or HR | `ticket_reply` ("Hi {{1}}, there is a new reply on the helpdesk ticket "{{2}}" at {{3}}. …") | U | requests |
| Document uploaded / verified (`document.controller.js`) | HR / employee | `document_uploaded` / `document_verified` | U | requests |
| Overdue training reminder (`course.service.js`) | employee | `training_overdue` ("Hi {{1}}, your course "{{2}}" at {{3}} is overdue. Please complete it in SpaxSync.") | U | requests |
| Team birthday / anniversary broadcast (`birthdayAnniversary.cron.js`, the company-wide part) | every other employee | `team_birthday` ("Hi {{1}}, today is {{2}}'s birthday at {{3}}. 🎂 Send your wishes in SpaxSync!") / `team_anniversary` | **M** | team_celebrations |
| Announcement, holiday list, own birthday/anniversary, leave decided, payslip | | covered by A | | |
| Any future notification type without a mapping | | `general_update` ("Hi {{1}}, you have a new update at {{2}}: {{3}}. Please open SpaxSync for the details.") | U | requests |

Write a test that fails if a known notification `type` has no mapping.

**C. Never on WhatsApp** (record each reason in the catalogue):

| Email | Reason |
|---|---|
| welcome, onboarding_invite, bulk_import, day_one | Contains a password |
| password_reset, onboarding_otp | Contains a secret code |
| prejoining | The person can't have connected yet (no sign-in) |
| offer_letter, company_invite, lead_confirmation | The recipient isn't a SpaxSync user and hasn't opted in |

**D. Not live yet** (give each a decision now):
- checklist_reminder → `general_update`, requests
- onboarding_complete → `general_update`, requests
- offboarding_initiated, exit_checklist, final_settlement → account group (**no amounts**)
- payslip_failed → payroll group, HR
- training_assignment → requests

All Utility.

**Groups (the switches people see):**
- Employee groups: leave · attendance · payroll · requests & helpdesk · company news · my celebrations · team celebrations.
- Admin / HR only: summaries · recruitment · security · billing.
- Super admin only: platform.
- account always goes while connected.
- **Team celebrations** is the costliest group, since each birthday messages everyone. Default it on, per the owner, but make it easy to turn off.

### 6.2 Connecting, consent and stopping
1. **Profile → WhatsApp updates → "Connect WhatsApp"** calls `POST /api/whatsapp/link` (authenticated; for the employee themself only). It:
   - creates a **one-time code**: random, at least 8 characters from an unambiguous alphabet, stored **hashed**, expiring in 15 minutes, rate-limited;
   - returns `https://wa.me/<SpaxSync number>?text=JOIN%20<code>` plus a QR code.
   - The UI shows the **consent text** (versioned; the owner approves the wording), for example: *"I agree to receive HR updates from {Company} on WhatsApp, sent by SpaxSync through Meta. I can stop at any time by replying STOP or switching it off here."*
2. When the inbound webhook receives `JOIN <code>`:
   - match the hash, check expiry and single use;
   - link the WhatsApp identity (phone if present, BSUID always) to that employee;
   - store `consented_at`, the consent version and the source (`whatsapp_join`);
   - reply inside the service window: "✅ Connected. You'll get HR updates from {Company} here. Reply STOP to stop, HELP for help."
3. One WhatsApp number may link to several accounts (for example, the owner testing employee, manager and admin), but each link needs its own `JOIN`.
4. **Keywords** (case-insensitive, trimmed):
   - **STOP**, **UNSUBSCRIBE**: opt out of everything, confirm, and stop immediately.
   - **START**: opt back in.
   - **HELP**: short help text.
   - A marketing **"Stop promotions"** button reply: switch off company news and both celebration groups.
   - Anything else: at most one polite auto-reply per 24 h ("This number only sends SpaxSync updates. Open SpaxSync to reply.").
5. Profile shows the status, masked number (`+91•••••43210`), connected date, group switches and **Disconnect**. **Only the employee can connect.** HR can't connect on their behalf, but can see how many employees are connected.
6. The **super admin** gets the same connect flow in the super admin console, for the `platform` group.
7. Deactivated employees and inactive companies get no messages, except that billing still goes to company admins. After `account_deactivated`, close the link.
8. Handle `user_changed_number` and `user_changed_user_id`.

### 6.3 Company and platform controls
- **Feature key** `whatsapp_notifications` in `FEATURE_REGISTRY`: `{ label: 'WhatsApp notifications', selfServeUnlockable: false, comingSoon: true, requiresPlatformFlag: 'WHATSAPP_ENABLED' }`. It stays off everywhere until the env flag is `'true'`, then the super admin enables it per company or plan.
- **Company settings** (HR/Admin), in a dedicated table and endpoints, validated server-side:
  - WhatsApp on/off and the default on/off per group.
  - The **Integrations** "Coming soon" card becomes real: status, on/off, connected-employee count, link to the group settings.
  - **Settings → Notifications** gets a WhatsApp switch per group.
- **Platform pause**: a super admin toggle stored in the DB, instant, no redeploy. It sits in addition to the env flag.

### 6.4 Message content rules
- **Never include:**
  - salary or any amount from payroll;
  - bank or account numbers, PAN or Aadhaar;
  - leave reasons (can be medical);
  - passwords, codes, sign-in or reset links;
  - anyone's phone or email;
  - document contents.
- Billing amounts aren't needed: say what happened ("your payment failed").
- **Sanitise parameters:** no newlines or tabs, collapse spaces, trim, truncate long titles (about 60 characters plus "…"), never send empty values.
- **Formats:**
  - Dates "3 Nov 2026" and ranges "3–4 Nov 2026", in the company timezone (default `Asia/Kolkata`).
  - Names: the first name for the recipient, the full name for others.
- **Every template** is in English (`en`) with the footer "Reply STOP to turn off WhatsApp updates". Marketing ones also get the "Stop promotions" quick-reply button.
- **Optional, only if the owner agrees:** an "Open SpaxSync" URL button with a fixed base and an opaque, signed, expiring token resolved by a backend redirect to `https://{slug}.spaxsync.com/<allow-listed path>`. It needs **no open redirect** and no personal data in the URL.

### 6.5 Super admin console: WhatsApp page
- **Account health:** number, display name and status; quality rating; messaging limit; template statuses; last webhook received; pause switch.
- **Message log:** like `EmailLog.jsx`, filterable by company, template, status and date. Numbers are masked, and **no message text beyond the template name and parameters**.
- **Per-company counts and estimated cost:**
  - Use `pricing.category` and `billable` from status webhooks.
  - Keep INR rates in one config with their "as of" date.
- The super admin's own connect/disconnect.

### 6.6 Reliability
- **Outbox table:** a WhatsApp send is a row (`queued`). A worker claims rows, sends, and records the result. Requests never wait on Meta.
- **Environment isolation (critical).** Development and production **share the live database**.
  - Every row stores `environment` (`production`, or `dev:<hostname>`).
  - Workers **claim only their own environment's rows**, atomically: a Postgres function with `FOR UPDATE SKIP LOCKED`, created in the migration.
  - A dev worker must never send, fail or touch a production row.
- **Retries** with exponential backoff and a maximum number of attempts, per §4. Mark permanent failures `failed` with the code and title.
- **Concurrency** limited to about 5 in flight.
- **One WhatsApp per event:**
  - Use a `dedupe_key` (event, record ID, recipient) with a **unique** constraint.
  - Duplicates become `skipped` with reason `duplicate`.
  - This covers the cases where SpaxSync sends two emails for one event.
- **Never break the request:** every hook is fire-and-forget with `.catch`. If WhatsApp is misconfigured, log one warning and stay disabled; never crash on boot.
- **Logs:** never log tokens or full numbers (mask them). No parameter values at info level.

---

## 7. Technical design (follow it, or explain a better way before building)

**Env** (add to `backend/.env.example` with comments and **no values**):
- `WHATSAPP_ENABLED` (default false)
- `WHATSAPP_API_VERSION`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_WABA_ID`
- `WHATSAPP_BUSINESS_NUMBER` (E.164, for wa.me links)
- `WHATSAPP_ACCESS_TOKEN` (secret)
- `WHATSAPP_APP_SECRET` (secret)
- `WHATSAPP_VERIFY_TOKEN` (secret)
- `WHATSAPP_ALLOWED_RECIPIENTS`: comma-separated E.164. **Required outside production; if empty, send nothing.**

**Migration** `backend/supabase/migrations/2026MMDD_whatsapp_channel.sql` (re-runnable, RLS on, **additive only**):

| Table | Columns / purpose |
|---|---|
| `whatsapp_links` | `subject_type` (employee or super_admin), `subject_id`, `company_id`, `phone_e164`, `bsuid`, `status`, `groups` JSONB, `consent_version`, `consented_at`, `opted_out_at`, timestamps; unique (`subject_type`, `subject_id`) |
| `whatsapp_link_codes` | `code_hash`, `subject`, `company_id`, `expires_at`, `used_at`, `attempts` |
| `whatsapp_messages` | The outbox and log: `environment`, `company_id`, subject, `recipient`, `event_key`, **`dedupe_key UNIQUE`**, `template`, `category`, `params` JSONB, `status`, `skip_reason`, `attempts`, `next_attempt_at`, `wa_message_id UNIQUE`, `error_code`, `error_title`, `pricing_category`, `billable`, timestamps; indexes for the worker and the log |
| `whatsapp_inbound` | Idempotency for inbound messages: `wa_message_id` as primary key, minimal fields |
| `company_whatsapp_settings` | `company_id` primary key, `enabled`, `groups` JSONB, `updated_by`, timestamps |
| `platform_whatsapp_state` | One row: pause flag, last health check |

Also: the claim function, `schema_migrations` insert, and the README entry. **The owner runs it.**

**Modules** (backend):

| File | Contents |
|---|---|
| `config/whatsapp.js` | Config and validation |
| `services/whatsappCatalog.js` | Events → template, category, group, parameter builder |
| `services/whatsappTemplates.js` | Template definitions with examples |
| `services/whatsapp.service.js` | `enqueue`, `send`, error classification |
| `services/whatsappWorker.js` | Started from `server.js` when enabled. A light poll every few seconds, with the claim function. Respects the pause switch. |
| `services/whatsappLink.service.js` | The connect flow |
| `controllers` / `routes` | Link, preferences, company settings, super admin |
| `routes/whatsappWebhook.routes.js` | The webhook, mounted in `app.js` **before the parsers**, with its own limiter |
| `scripts/whatsapp-templates.js` | Lists and submits templates through the API. Run **only** with the owner's OK; prints statuses. |

**Hooks:**
1. In `email.service.js`'s wrapper, after calling the template, call `whatsappMirror.fromEmail(typeKey, args, ctx)`.
2. In `notification.service.js`, call `whatsappMirror.fromNotification(items)`.
- Both are fire-and-forget. Parameters come from structured arguments, or a lookup by the IDs in `meta`.
- Check in this order: platform enabled and not paused → company feature and setting on → recipient linked and active → group on → not a `never` type → allowed recipient (outside production) → enqueue with `dedupe_key`.

**Website** (`HRMS/`):
- Profile "WhatsApp updates" card.
- Settings → Integrations card (made real).
- Settings → Notifications WhatsApp switches per group.
- Super admin WhatsApp page and connect.
- All behind the feature flag, so nothing changes for companies without it.

**Tests:**
- Catalogue coverage (every email type and notification type).
- The never-list is exact; the marketing list is exact.
- Parameter builders: no forbidden fields, sanitised, no empties.
- Signature verify: valid, invalid, missing. GET handshake.
- Inbound: JOIN, STOP, START, HELP, unknown text, BSUID-only payloads, changed number, duplicate deliveries.
- Allow-list enforcement, including an empty list outside production.
- Environment isolation, dedupe, error classification, retries, the pause switch, feature gating.
- Everything mocks Supabase and `fetch`.

---

## 8. Phases and acceptance criteria

Show the owner the result of each phase before starting the next.

| Phase | Build | Accepted when |
|---|---|---|
| **0. Plan** | Read this file, `WHATSAPP_INTEGRATION_GUIDE.md` and the files in §3. Re-verify §4 facts in Meta's docs. Ask the §5 questions. Write a short plan. Create the branch. | Owner says "go" |
| **A. Sending core** | Config, migration file (**not run**), outbox, worker, allow-list, pause switch, `whatsapp.service`, tests. | Tests green. With the owner's OK and token, one template (`hello_world` or our first approved one) reaches the owner's phone from the test number; a non-allow-listed number is refused. |
| **B. Webhook and connect** | Webhook (GET and POST, signature), connect flow, consent, STOP/START/HELP, statuses, changed number, profile card, super admin connect. Local test through a temporary HTTPS tunnel (`cloudflared tunnel --url http://127.0.0.1:5000`). The owner sets that URL as the app's callback, or you set it with the API after asking. | Owner connects, gets "Connected", sends STOP and START, sees delivered/read statuses. |
| **C. Every notification** | Templates (submitted with the owner's OK), catalogue for all types, both hooks, dedupe, company settings, Notifications and Integrations UI, feature key. | With the owner's own employee and admin accounts: leave apply/approve/reject, WFH, expense, ticket, payslip, announcement, holiday list, birthday. Each arrives **once**, with the right wording and no sensitive data. Emails and in-app notifications unchanged. |
| **D. Super admin console** | Health, log, cost estimate, pause, templates status. | Owner sees the Phase C messages and the cost estimate. |
| **E. Two-way (only when the owner says)** | Approve/reject buttons: signed, single-use, expiring payload; sender must be the approver's linked WhatsApp; goes through the existing approval services and permission checks; audit-logged. | Owner approves one of their own test leave requests from WhatsApp; forged, expired or replayed taps are refused. |
| **F. Go-live runbook** | Step-by-step for the owner (§9). | Owner completes it. |

---

## 9. Go-live runbook (write it for the owner, then guide them through it)

1. **Meta:**
   - business verified;
   - real number added, with display name **SpaxSync** approved, 2-step PIN set, payment method added;
   - templates submitted for the **real** WABA;
   - app switched to **Live**, with privacy policy URL `https://spaxsync.com/privacy`.
2. **Privacy policy:** add one line, approved by the owner, saying WhatsApp updates are sent through Meta.
3. **Database:** the owner runs the migration in the Supabase SQL editor.
4. **Server** (EC2):
   - pull the merged code;
   - add the env values (the owner types the secrets);
   - `pm2 restart hrms-backend --update-env`;
   - **don't restart nginx**.
5. **Cloudflare:** add a WAF/bot **skip rule** for `/api/whatsapp/webhook`, so Meta's calls aren't challenged. Check with a test POST.
6. **Meta webhook:** callback `https://spaxsync.com/api/whatsapp/webhook`, plus the verify token; subscribe to `messages`.
7. **Turn on in order:**
   - `WHATSAPP_ENABLED=true`;
   - feature on for the owner's own company (Spaxads) first; test with the owner's accounts;
   - then other companies.

---

## 10. Running locally (safe)

- **Backend:** from `backend/`, in Git Bash:
  ```
  DISABLE_CRONS=true FRONTEND_URL=http://localhost:5173 node src/server.js
  ```
  Never run without `DISABLE_CRONS=true`. In PowerShell, `$env:X=''` *deletes* a variable, so use Bash or a small Node launcher if you need empty values.
- **Email:** emails are **on** locally by the owner's choice. The owner tests with their own accounts in their own company, so test actions there are real: real records and real emails. Never act in other companies.
- **Website:** from `HRMS/`, run `npm run dev` (5173). The owner signs in at `http://localhost:5173` (their company: `?tenant=spaxads`).
- **Port 8081** belongs to another project of the owner. Don't touch it.

---

## 11. How to report to the owner (a beginner)

After each phase:
1. **What I built**, in plain words, 3–6 lines.
2. **How to test it**: numbered clicks with exact URLs and accounts.
3. **What you need to do**: Meta steps, values to type into `.env` (names only), approvals I need.
4. **Results**: tests run and output, screenshots or messages received.
5. **Risks or anything I noticed**: short.

Never claim something works unless you saw it work. If something failed, show it.
