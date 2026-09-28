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
backend  npm run dev · npm start · npm run seed:demo · npm test (no tests yet)
HRMS     npm run dev · npm run build · npm run build:app · npm run lint · npm run preview
```

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

- No automated tests on either side; `npm test` is a no-op placeholder.
- No payment gateway — subscription payments are recorded manually by a
  super-admin, and plan/seat changes submit a request rather than charging.
- `siteConfig.js` still needs a real GSTIN, phone and registered address before
  launch; each is hidden while empty.
