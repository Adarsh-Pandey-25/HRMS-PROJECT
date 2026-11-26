# SpaxSync HRMS

A multi-tenant HR platform for Indian companies. Each customer gets an isolated
workspace at `{slug}.spaxsync.com` with its own branding, covering attendance
(office-IP, biometric/ADMS and GPS-geofence check-in), leave, payroll with
loss-of-pay and professional tax, documents, training, helpdesk, assets,
performance, recruitment, and subscription billing with GST. A public marketing
site and a platform super-admin console live in the same frontend build.

## Stack

| Layer | What |
|---|---|
| Backend | Node ≥20, Express, Supabase (Postgres + private Storage buckets) |
| Frontend | React + Vite, Tailwind, TanStack Query, Zustand |
| Auth | JWT in HttpOnly cookies; optional per-employee TOTP 2FA |
| Jobs | `node-cron` with a DB-backed lock (`backend/src/cron/`) |
| Hosting | AWS EC2 behind nginx; Cloudflare in front (Full SSL) |

Tenancy is resolved from the `Host` header: the apex serves the marketing site
plus `/super-admin` and `/onboarding`; `{slug}.spaxsync.com` serves the app for
that one company. `BASE_DOMAIN` drives this — unset, subdomain routing goes
inert and everything falls back to `FRONTEND_URL`.

## Running locally

Both halves need their own env file. Copy the templates and fill them in —
every variable is documented inline:

```bash
cp backend/.env.example backend/.env
cp HRMS/.env.example HRMS/.env
```

**The backend will not start** without `JWT_SECRET`, `JWT_REFRESH_SECRET` (both
≥32 chars) and `SUPER_ADMIN_2FA_ENC_KEY` (exactly 32 bytes). Generate the keys:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`SUPER_ADMIN_2FA_ENC_KEY` encrypts TOTP secrets for both super-admin and
employee 2FA. **Never rotate it once anyone has enrolled** — rotating locks
every 2FA user out of login, and they only see "invalid code".

In production the server additionally requires `BASE_DOMAIN`,
`AUDIT_LOG_HMAC_KEY` and `FRONTEND_URL`, and exits at boot if any is missing.

```bash
cd backend && npm install && npm run dev     # http://localhost:5000
cd HRMS    && npm install && npm run dev     # http://localhost:5173
```

The Vite dev server proxies `/api` to the backend, so leave `VITE_API_URL`
unset unless the backend is somewhere else.

### Scripts

```
backend  npm run dev · npm start · npm run seed:demo · npm test
HRMS     npm run dev · npm run build · npm run build:app · npm run lint · npm run preview
```

`npm test` runs the backend's payroll and security tests (no database: Supabase is
an in-memory stand-in and `.env` is never read); GitHub runs them on every push.

The test and demo seed scripts (`seed-admin`, `seed-assets`, `seed-demo-data`,
`seed-notifications`, `seed-test-data`) write made-up data, and `seed-test-data`
deletes employees in every company. They refuse to run unless you name the
database on purpose: `SEED_TARGET_PROJECT=<project ref> npm run seed:demo`, where
the ref is the part of `SUPABASE_URL` before `.supabase.co`. Never point them at
production.

`npm run build` also server-renders the marketing pages and pre-renders them to
static HTML. `npm run build:app` skips that and builds the SPA only.

## Database migrations

Run in this order in the Supabase SQL editor. `COMPLETE_DATABASE_SETUP.sql` is
the base schema (extensions, tables, the shared `update_updated_at()` trigger
function) and must go first on a fresh project; everything in
`backend/supabase/migrations/` is incremental and ordered by filename.

1. `supabase/COMPLETE_DATABASE_SETUP.sql` — fresh projects only
2. `20260829_biometric_checkout_lifecycle.sql`
3. `20260907_device_heartbeats_claimed_at.sql`
4. `20260910_temp_password_expiry.sql`
5. `20260911_super_admin_console.sql`
6. `20260912_super_admin_console_fixes.sql`
7. `20260913_beacons_geofence_billing_gating.sql`
8. `20260914_manual_payment_recording.sql`
9. `20260915_schema_migrations_tracking.sql`
10. `20260916_webhooks.sql`
11. `20260917_employee_2fa.sql` — employee 2FA columns
12. `20260917_employee_onboarding.sql` — one-time-use onboarding token
13. `20260917_audit_log_integrity.sql` — audit-log HMAC column
14. `20260917_invoice_number_sequence.sql` — **creates `subscription_invoice_seq`**; without it every invoice falls back to a non-sequential number
15. `20260925_trial_notifications.sql` — allows the trial-reminder notification types
16. `20260925_marketing_leads.sql` — public trial/contact form leads
17. `20260926_attendance_selfie.sql` — selfie check-in column
18. `20260926_salary_revisions.sql` — salary revisions table
19. `20260928_company_email_preferences.sql` — **creates `company_email_preferences`**; without it the super-admin Email Preferences screen returns 500 and category opt-outs never persist
20. `20260929_course_chapters_and_category.sql` — links lessons to chapters (`addChapter` wrote nothing before this) and adds the course `category` the catalog card already rendered
21. `20260930_email_log_and_preferences.sql` — **creates `email_log`** for the super-admin Email Log, and widens the per-company email switches from 10 to all 23. Until it runs, emails still send but nothing is logged, and switching off any of the 13 new ones fails
22. `20261001_fix_company_email_preferences_shape.sql` — repairs a `company_email_preferences` table created before 20260928 in another shape (production's had no `id`); recreates it only if empty, refuses otherwise
23. `20261002_one_biometric_id_per_employee.sql` — one biometric ID per employee, enforced in the database (the same ID on several devices is still allowed); refuses, changing nothing, if an employee already has two IDs
24. `20261003_employee_profile_completion.sql` — `employees.profile_completed`: people HR adds without personal details fill them in on first sign-in; existing employees default to complete and are never asked
25. `20261004_leave_balance_individual_allocation.sql` — `leave_balances.allocation_override`: an allocation HR/Admin set for one person is kept when the company policy is applied
26. `20261007_wfh_date_range_requests.sql` — **adds `wfh_day_requests.batch_id`**, which groups the per-day rows of one multi-day WFH request. Until it runs, submitting any WFH request fails — the table still stays one row per day, so approved-WFH check-in is unaffected either way
27. `20261008_assets_ownership.sql` — **adds `assets.ownership`** (`purchased` / `rented`), which bulk import and the Add Asset form now send. Until it runs, creating an asset fails; existing assets are backfilled to `purchased`
28. `20261028_whatsapp_channel.sql` — WhatsApp notifications: new tables only (`whatsapp_links`, `whatsapp_link_codes`, `whatsapp_messages`, `whatsapp_inbound`, `company_whatsapp_settings`, `platform_whatsapp_state`) and the `whatsapp_claim_outbox()` function; changes nothing existing. Until it runs, WhatsApp stays unavailable even with `WHATSAPP_ENABLED=true`
29. `20261030_whatsapp_approval_buttons.sql` — new table `whatsapp_actions` for the Approve / Reject buttons on WhatsApp approval requests; nothing existing changes
30. `20261102_clear_done_review_notifications.sql` — optional one-off tidy-up: marks "please review" notifications read for requests already decided; only `is_read` changes
31. `20261102_payroll_last_working_day.sql` — `employees.last_working_day`, so a leaver is paid up to their last day; until it runs payroll uses the offboarding date
32. `20261102_wfh_approval_flow.sql` — **adds the WFH manager-step columns.** Until it runs, the WFH manager step fails on the website and on WhatsApp
33. `20261103_employee_loans.sql` — loans and salary advances recovered through payroll; until it runs, payroll deducts no loans
34. `20261103_payroll_payment_reference.sql` — payment date and bank reference (UTR) on "Mark paid"
35. `20261103_tax_declarations.sql` — employee tax declarations (Form 124, formerly 12BB) used by TDS
36. `20261104_payroll_approval.sql` — "Approval before publishing" (maker-checker); until it runs, switching it on blocks publishing with a message
37. `20261104_payroll_one_time_items.sql` — one-time pay and recoveries (arrears, bonus, encashment, gratuity, notice pay) on a month's payslip
38. `20261117_adms_device_ip_pinning.sql` — **run before deploying the November security fixes.** Pins each biometric device to its office's IP. Until it runs, every biometric push is refused with `NOK` (devices keep the punches and resend them, so nothing is lost)
39. `20261117_fnf_exemption_used.sql` — `payroll_one_time_items.exempt_amount`: the tax-free part of gratuity and leave encashment on leaving. Until it runs, full and final saves each as two items (exempt and taxable), so tax is still right
40. `20261117_last_admin_guard.sql` — a database rule that a company always keeps one active Admin, so two Admins demoting each other at the same moment can't leave it with none. Deleting a whole company isn't blocked
41. `20261117_two_step_login.sql` — **run before deploying the November security fixes.** Single-use two-step login challenges. Until it runs, people with two-step login on can't sign in; everyone else is unaffected
42. `20261120_adms_kept_punches.sql` — a biometric machine on a new internet address: its punches are kept until someone approves (they count) or rejects (deleted) the new IP, by email, the website and WhatsApp. Until it runs, a push from a new IP is refused as before. Safe to run again after the first version of the file (20 Nov): it adds the `window_start` column then
43. `20261126_whatsapp_template_switches.sql` — an On / Off switch for each WhatsApp message in Super Admin → WhatsApp → Templates. Until it runs, every message stays on and the switches can't be used
44. `20261126_careers_api.sql` — the Careers API (CAREERS_API.md): a company's own website shows its jobs and sends applications into Recruitment. Adds job details (work mode, salary, questions, "show on website"), the candidate's filled-in details and consent, and the `careers_sites` table. Until it runs, Recruitment works as before and the Careers API answers that it is not set up

Migrations are idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`), so
re-running one is safe.

> Before first deploying the billing cron, check for trials whose end date has
> already passed — the cron marks them `expired`, which blocks login for that
> whole company:
> ```sql
> select c.name, s.status, s.current_period_end from company_billing_subscriptions s
> join companies c on c.id = s.company_id where s.status = 'trialing' order by 3;
> ```

## Deploying (EC2 + nginx)

The box runs other production apps behind an nginx `stream` SNI router on port
443. Every site listens on `127.0.0.1:8443 ssl proxy_protocol`. **Never stop,
kill or restart nginx** — only `nginx -t` then `reload`.

```bash
git pull

# 1. Migrations — run any new ones in Supabase (see the order above).

# 2. Backend (pm2, port 5050)
cd backend && npm install
#    add any new vars from .env.example to .env
pm2 restart hrms-backend --update-env

# 3. Frontend — both env vars are required; a plain `npm run build` fails
#    because the marketing pre-render step fetches live plan pricing.
cd ../HRMS && npm install
VITE_BASE_DOMAIN=spaxsync.com PRERENDER_API_URL=http://127.0.0.1:5050 npm run build

# 4. nginx — the config needs its security-headers snippet installed first,
#    or `nginx -t` fails on the missing include.
sudo cp /etc/nginx/sites-available/hrms ~/hrms.nginx.bak
sudo cp deploy/nginx/security-headers.conf /etc/nginx/snippets/spaxsync-security-headers.conf
sudo cp deploy/nginx/hrms.conf /etc/nginx/sites-available/hrms
sudo nginx -t && sudo systemctl reload nginx
```

To roll back nginx: restore `~/hrms.nginx.bak`, then `nginx -t && reload` again.

`deploy/nginx/security-headers.conf` is a separate snippet rather than inline
because nginx's `add_header` is not additive — a `location` that sets any
`add_header` stops inheriting the server block's, so each such location
`include`s the snippet explicitly.

### Set on the server

Beyond the local requirements: `BASE_DOMAIN`, `AUDIT_LOG_HMAC_KEY`,
`FRONTEND_URL`, and `PLATFORM_GSTIN` (the supplier GSTIN printed on tax
invoices — omitted from the PDF while unset).

## Layout

```
backend/src/{routes,controllers,services,middleware,cron,utils,config}
backend/supabase/migrations      SQL migrations, ordered by filename
HRMS/src/{pages,components,api,hooks,store,lib}
HRMS/src/marketing               public site (own palette, pre-rendered)
deploy/nginx                     production nginx config + headers snippet
```

## Known gaps

- No automated tests for the website (the backend has `npm test`).
- No payment gateway — subscription payments are recorded manually by a
  super-admin, and plan/seat changes submit a request rather than charging.
- `siteConfig.js` still needs a real GSTIN, phone and registered address before
  launch; each is hidden while empty.
