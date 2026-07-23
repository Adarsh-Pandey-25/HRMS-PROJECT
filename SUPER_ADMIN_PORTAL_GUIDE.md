# Super Admin Portal — SaaS Platform Guide

How to add a **platform Super Admin portal** that manages the entire SaaS product: all companies, usage, billing, invoices, and operations — separate from a normal company Admin or Parent (group) Admin.

**Related:** [COMPANY_HIERARCHY_GUIDE.md](./COMPANY_HIERARCHY_GUIDE.md) · [MULTI_TENANT_ROLLOUT.md](./backend/supabase/MULTI_TENANT_ROLLOUT.md) · [SECURITY.md](./SECURITY.md)

---

## 1. Three levels of “admin” (do not mix them)

| Level | Who | Scope | Example |
|-------|-----|-------|---------|
| **Employee / HR / Admin** | Works inside one company | One `company_id` only | Raju Co HR runs payroll |
| **Parent Admin** | Group / holding company | Own company + child companies | Spaxads Group creates subsidiaries |
| **Super Admin** | **You (SaaS owner)** | **Entire platform** — all tenants | Spaxads product team sees every customer |

```
┌──────────────────────────────────────────────────────────┐
│  SUPER ADMIN PORTAL  (platform / SaaS owner)             │
│  All companies · billing · invoices · system health      │
└────────────────────────────┬─────────────────────────────┘
                             │ sees / controls
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   Company A            Company B            Company C
   (Admin/HR)           (Parent + kids)      (standalone)
```

**Rule:** Super Admin is **not** a normal `admin` role inside a customer company.  
It is a **platform role** with its own login and UI (or a tightly gated section).

---

## 2. Goal of the Super Admin portal

As a SaaS product, Super Admin should answer and control:

| Question | Portal feature |
|----------|----------------|
| How many companies signed up? | Companies dashboard |
| How many employees across all tenants? | Platform KPIs |
| Who pays us? How much? | Plans, subscriptions, invoices, bills |
| Which company is over limits? | Usage & quotas |
| Can I suspend a bad tenant? | Activate / suspend / delete |
| Is the system healthy? | Health, errors, jobs |
| Did something critical change? | Audit log |
| How do we support customers? | Impersonation (careful) / support notes |

---

## 3. Recommended architecture

### 3.1 Separate portal (best)

```
https://admin.yourhrms.com     → Super Admin portal (new React app or /platform routes)
https://app.yourhrms.com       → Customer HRMS (current HRMS/)
```

| Approach | Pros | Cons |
|----------|------|------|
| **A. Separate app** (`PlatformAdmin/`) | Clearest security boundary | Extra deploy |
| **B. Route prefix** `/platform/*` in same app | Faster to ship | Must hard-block non–super-admins |
| **C. Same login, role gate** | Simple | Highest risk of UI leaks |

**Recommendation:** Start with **B** (`/platform/*` + `role = super_admin`), move to **A** when product grows.

### 3.2 New role: `super_admin`

Today roles: `admin | hr | manager | employee`.

Add:

```text
super_admin
```

| Property | Recommendation |
|----------|----------------|
| Belongs to a company? | Optional **platform company** row, or `company_id = NULL` / special system UUID |
| Count in customer headcount? | **No** |
| Can access customer HR screens? | Only via explicit **impersonation** (optional, audited) |
| How many? | 1–3 people only (founders / ops) |

**Never** give `super_admin` to a customer.

---

## 4. Core modules for Super Admin portal

### 4.1 Platform Dashboard (home)

KPI cards (live or daily snapshot):

| KPI | Source idea |
|-----|-------------|
| Total companies | `COUNT(*) FROM companies` |
| Active companies | `is_active = true` (+ subscription active) |
| Total employees | `COUNT(*) FROM employees WHERE role != 'super_admin'` |
| New companies (7 / 30 days) | `companies.created_at` |
| MRR / ARR | Sum of active subscriptions |
| Overdue invoices | Billing tables |
| Open support tickets | Support module |
| System alerts | Failed crons, email errors, storage |

Charts: signups over time, revenue, employee growth, churn.

---

### 4.2 Companies (tenants)

**List all companies** with filters: active / suspended / trial / paid / parent / child.

| Column | Why |
|--------|-----|
| Name, slug, type | Identity |
| Created at | Onboarding date |
| Admin email | Who owns it |
| Employee count | Usage |
| Plan | Free / Trial / Starter / Pro |
| Subscription status | trial / active / past_due / cancelled |
| Last login (any user) | Engagement |
| Actions | View, suspend, extend trial, change plan |

**Company detail page:**

- Profile (name, logo, industry from `company_profile` settings)
- Hierarchy (parent / children) if enabled
- Usage: employees, storage, API calls (if tracked)
- Billing: current plan, invoices, payment method status
- Feature flags overrides
- Audit: who suspended / plan changes
- Danger zone: suspend, hard-delete (with confirm + grace period)

**Actions Super Admin can take:**

| Action | Effect |
|--------|--------|
| Suspend | `companies.is_active = false` → block all logins for that tenant |
| Reactivate | Restore access |
| Extend trial | Push `trial_ends_at` |
| Change plan | Upgrade/downgrade + adjust limits |
| Reset company admin password | Send reset email |
| Impersonate (optional) | Login as company admin with banner + audit |
| Delete (soft → hard) | Soft first (30 days), then purge |

---

### 4.3 Employees (global, read-mostly)

Not for editing every employee’s leave — for **platform oversight**:

| Feature | Purpose |
|---------|---------|
| Global search by email / employee_code | Find which company a user belongs to |
| Count per company | Usage metering |
| Flag duplicate / abuse | Same person gaming trials |
| Force logout / disable user | Security incident |

**Do not** let Super Admin casually edit attendance/payroll of customers — that breaks trust. Prefer “support impersonation” with consent.

---

### 4.4 Plans & pricing (product catalog)

Define what customers buy:

| Plan | Example limits |
|------|----------------|
| **Free / Trial** | 14 days, max 10 employees |
| **Starter** | 50 employees, basic modules |
| **Professional** | 200 employees, biometric, multi-child |
| **Enterprise** | Unlimited / custom, SSO, SLA |

Plan fields:

```text
id, name, code, price_monthly, price_yearly, currency,
max_employees, max_companies_children, modules_enabled[],
trial_days, is_public, sort_order
```

Module toggles examples:

- Attendance / Leave / Payroll / LMS / Recruitment / Assets / Helpdesk  
- Biometric webhook  
- Parent–child companies  
- Custom branding  
- API access  

---

### 4.5 Subscriptions

Each **billing customer** (usually a standalone or parent company) has one subscription:

| Field | Meaning |
|-------|---------|
| `company_id` | Who pays |
| `plan_id` | Current plan |
| `status` | `trialing` / `active` / `past_due` / `cancelled` / `paused` |
| `current_period_start` / `end` | Billing cycle |
| `trial_ends_at` | Trial end |
| `cancel_at_period_end` | Soft cancel |
| `provider` | `manual` / `razorpay` / `stripe` |
| `provider_subscription_id` | External ID |

**Enforcement in HRMS app:**

- On login / bootstrap: check subscription status  
- If suspended / expired → show “Contact billing” page  
- If over `max_employees` → block new hires (soft warning first)

---

### 4.6 Invoices & bills

| Document | Meaning |
|----------|---------|
| **Invoice** | What you charge the customer (subscription period) |
| **Bill / Payment** | Money received (or failed) against an invoice |
| **Credit note** | Refunds / adjustments |

Invoice fields (minimum):

```text
invoice_number, company_id, subscription_id,
period_start, period_end, subtotal, tax, total, currency,
status (draft|issued|paid|overdue|void),
due_date, paid_at, pdf_url, line_items[]
```

Super Admin screens:

1. **All invoices** — filter by status, company, month  
2. **Create manual invoice** — for enterprise / offline deals  
3. **Mark paid** — when bank transfer received  
4. **Send reminder** — email overdue customers  
5. **Download PDF**  

**Payment gateway (later):** Razorpay / Stripe webhooks → auto mark paid + extend period.

---

### 4.7 Usage & quotas (metering)

Track what each tenant consumes:

| Meter | Why |
|-------|-----|
| Active employees | Main pricing driver |
| Child companies | Parent plan limit |
| Storage (documents / logos) | Cost control |
| Emails sent / month | SMTP cost |
| Biometric punches / month | Optional |
| API calls | If you expose API |

Show **usage vs limit** bars on company detail. Soft limit → warning; hard limit → block feature.

---

### 4.8 Platform settings

Global knobs (not per-company):

| Setting | Example |
|---------|---------|
| Allow public self-signup (`/welcome`) | On / Off |
| Default trial days | 14 |
| Default plan on signup | Trial |
| Maintenance mode | Banner + block logins except super_admin |
| Global SMTP from-name | Platform emails |
| Support email / phone | Shown on billing pages |
| Feature flags (global defaults) | Enable LMS for all new tenants |

---

### 4.9 Feature flags

Toggle modules per company without redeploying:

| Flag | Example |
|------|---------|
| `module.payroll` | Hide payroll for Free plan |
| `module.biometric` | Paid add-on |
| `module.parent_child` | Enterprise |
| `module.api` | API access |

Resolved as: **plan defaults → company overrides → Super Admin force on/off**.

---

### 4.10 Support & impersonation (optional but valuable)

| Feature | Notes |
|---------|-------|
| Support tickets from tenants | “Billing help”, “Cannot login” |
| Internal notes on company | “Spoke to CFO on 22 Jul” |
| **Impersonate company admin** | Yellow banner: “Viewing as …”; every action audited; auto-expire 30–60 min |
| Force password reset | Security |

**Security:** Impersonation requires 2nd factor for Super Admin; never show customer passwords.

---

### 4.11 Audit log (platform)

Log every Super Admin action:

```text
who, action, target_company_id, metadata, ip, created_at
```

Examples: `company.suspend`, `plan.change`, `invoice.mark_paid`, `impersonation.start`.

Customers should **not** see this log; only Super Admins.

---

### 4.12 System health & ops

| Monitor | Why |
|---------|-----|
| Backend `/health` | Uptime |
| Cron jobs (auto-checkout, etc.) | Last success time |
| Email send failures | SMTP issues |
| Supabase / DB size | Capacity |
| Error rate (5xx) | From logs |
| Ngrok / domain status | Dev only |

Useful for your team — not for customers.

---

### 4.13 Platform announcements / emails

Broadcast to **company admins** (not every employee unless needed):

- “Scheduled maintenance Sunday 2 AM”  
- “New feature: biometric first/last punch”  
- “Invoice #INV-102 overdue”  

Separate from in-app company **Announcements** module (that is tenant-scoped).

---

### 4.14 More modules (recommended by maturity)

| Module | When |
|--------|------|
| **Coupons / discounts** | Marketing campaigns |
| **Affiliates / partners** | Referral revenue |
| **Data export / GDPR delete** | Compliance — wipe one tenant |
| **Backup / restore tenant** | Enterprise support |
| **Webhook debugger** | Biometric / payment webhook logs |
| **Email template preview** | Platform transactional emails |
| **Staff accounts** | Multiple super admins with limited roles (`billing_only`, `support_only`) |
| **Revenue analytics** | MRR, churn, LTV |
| **Abuse detection** | Many trials from same IP / email domain |

---

## 5. How Super Admin relates to Parent / Child companies

| Actor | Companies they see |
|-------|-------------------|
| Company Admin | Own company only |
| Parent Admin | Own + children (group) |
| **Super Admin** | **All** parents, children, standalones |

Billing tip:

- Prefer charging the **parent** (one invoice for the group), with employee limits summed across children.  
- Or charge each child separately (simpler metering, more invoices).

Document the choice in plan rules.

---

## 6. Suggested database tables (new)

```text
platform_users          -- or employees.role = 'super_admin'
plans
subscriptions
invoices
invoice_line_items
payments
usage_snapshots         -- daily employee counts etc.
feature_flags
company_feature_overrides
platform_audit_logs
platform_settings       -- key/value global
support_tickets         -- optional
coupons                 -- optional
```

Extend `companies`:

```text
plan_id / via subscription
trial_ends_at
suspended_at
suspended_reason
billing_email
```

---

## 7. API surface (planned)

Prefix everything under `/api/platform/*` and guard with `requireSuperAdmin`.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/platform/auth/login` | Super Admin login (separate rate limit) |
| GET | `/api/platform/dashboard` | KPIs |
| GET | `/api/platform/companies` | List tenants |
| GET | `/api/platform/companies/:id` | Detail + usage |
| PATCH | `/api/platform/companies/:id` | Suspend / notes / billing email |
| GET | `/api/platform/plans` | Catalog |
| POST | `/api/platform/plans` | Create/update plan |
| GET | `/api/platform/subscriptions` | All subs |
| PATCH | `/api/platform/subscriptions/:id` | Change plan / status |
| GET | `/api/platform/invoices` | List |
| POST | `/api/platform/invoices` | Manual invoice |
| POST | `/api/platform/invoices/:id/mark-paid` | Record payment |
| GET | `/api/platform/usage` | Metering |
| GET | `/api/platform/audit-logs` | Audit |
| POST | `/api/platform/impersonate/:companyId` | Start support session |
| GET/PUT | `/api/platform/settings` | Global settings |

Customer HRMS APIs stay under `/api/...` and **reject** `super_admin` for normal tenant routes (or ignore them).

---

## 8. Frontend portal map

```
/platform/login
/platform/dashboard
/platform/companies
/platform/companies/:id
/platform/plans
/platform/subscriptions
/platform/invoices
/platform/payments
/platform/usage
/platform/feature-flags
/platform/support
/platform/audit-logs
/platform/system-health
/platform/settings
```

Sidebar only for `super_admin`. Customer users hitting `/platform/*` → 403 / redirect.

---

## 9. Authority matrix (who can do what)

| Action | Company Admin | Parent Admin | Super Admin |
|--------|---------------|--------------|-------------|
| Manage own employees | ✅ | ✅ (own) | ❌ (unless impersonate) |
| Create child company | ❌ | ✅ | ✅ (optional) |
| See all SaaS companies | ❌ | ❌ | ✅ |
| Suspend any company | ❌ | ❌ | ✅ |
| Create / edit plans | ❌ | ❌ | ✅ |
| Issue invoices | ❌ | ❌ | ✅ |
| Mark invoice paid | ❌ | ❌ | ✅ |
| Toggle feature flags | ❌ | ❌ | ✅ |
| Maintenance mode | ❌ | ❌ | ✅ |
| View platform audit | ❌ | ❌ | ✅ |
| Change another tenant’s payroll | ❌ | ❌ | ❌ (prefer no) |

---

## 10. Security (critical for SaaS)

1. **Separate login** for Super Admin (or same login + role, but stricter rate limits + MFA).  
2. **MFA required** for Super Admin (TOTP / email OTP).  
3. All platform routes: `authenticate` + `requireSuperAdmin`.  
4. **No** `company_id` filter accident — Super Admin queries are intentional cross-tenant; log them.  
5. Impersonation: short TTL, banner, audit, cannot change billing while impersonating (optional rule).  
6. Store Super Admin passwords like everyone else (bcrypt); never share.  
7. IP allowlist for `/platform` in production (office VPN) — optional but strong.  
8. Never expose platform APIs to the public customer JWT without role check.

---

## 11. Signup → billing lifecycle (end-to-end)

```
1. Customer hits /welcome → onboarding → bootstrap-admin
2. System creates company + subscription(status=trialing, plan=Trial)
3. Trial clock starts (e.g. 14 days)
4. Super Admin sees new company on dashboard
5. Customer adds employees (enforced max_employees)
6. Trial ending → emails to billing_email / admin
7. Customer upgrades (or Super Admin assigns paid plan)
8. Invoice generated (auto or manual)
9. Payment received → subscription active → period renews
10. Non-payment → past_due → grace → suspend company
```

**Public signup switch:** Super Admin can turn off `/welcome` and only create tenants manually (private SaaS).

---

## 12. Phased delivery (practical)

### Phase 1 — Control plane (MVP)

- Role `super_admin` + `/platform` login  
- Dashboard KPIs: companies, employees, active/suspended  
- Companies list + detail + suspend/reactivate  
- Manual notes on company  
- Platform audit log for those actions  

### Phase 2 — Monetization

- Plans table + UI  
- Subscriptions per company  
- Manual invoices + mark paid  
- Enforce `max_employees` + trial expiry on login  

### Phase 3 — Product ops

- Feature flags  
- Usage snapshots  
- Platform announcements to admins  
- System health page  

### Phase 4 — Scale

- Payment gateway (Razorpay/Stripe)  
- Impersonation  
- Support tickets  
- Coupons, MRR analytics, staff roles  

---

## 13. How you manage day-to-day (ops playbook)

| Situation | Super Admin action |
|-----------|-------------------|
| New signup spam | Disable public bootstrap; suspend fakes |
| Customer over employee limit | Warn → upsell plan or block add employee |
| Trial ending, good lead | Extend trial 7 days from company detail |
| Invoice paid by NEFT | Create/find invoice → Mark paid |
| Abusive tenant | Suspend + note reason |
| Bug only in one company | (Later) Impersonate with consent |
| Release new module | Enable flag on Pro+ plans |
| Maintenance window | Turn on maintenance mode |

---

## 14. What exists today vs gap

| Area | Today | Need for Super Admin |
|------|-------|----------------------|
| Roles | `admin/hr/manager/employee` | Add `super_admin` |
| Companies | Flat list in DB | Platform list UI + suspend UX |
| Billing | **None** | Plans, subscriptions, invoices, payments |
| Cross-tenant view | Blocked by design | Explicit platform APIs |
| Feature flags | Plan-less settings per company | Global + per-tenant flags |
| Audit | App logs | `platform_audit_logs` table |
| Portal UI | Customer HRMS only | `/platform/*` or separate app |

---

## 15. UI wireframe (modules checklist)

Use this as your sidebar backlog:

- [ ] Dashboard  
- [ ] Companies  
- [ ] Company detail  
- [ ] Employees (global search)  
- [ ] Plans  
- [ ] Subscriptions  
- [ ] Invoices & bills  
- [ ] Payments  
- [ ] Usage & quotas  
- [ ] Feature flags  
- [ ] Support / tickets  
- [ ] Audit logs  
- [ ] System health  
- [ ] Platform settings  
- [ ] Platform announcements  

---

## 16. Decisions before coding

1. **Separate subdomain** (`admin.`) or `/platform` inside same app?  
2. **Payment gateway now** or manual invoices first?  
3. **Public self-signup** stays on, or Super Admin creates all tenants?  
4. Bill **parent only** or each company?  
5. Is **impersonation** allowed in v1?  
6. Currency (INR only?) and tax (GST invoices)?  

---

## 17. Bottom line

| Layer | Job |
|-------|-----|
| **Customer Admin** | Run one company’s HR |
| **Parent Admin** | Manage subsidiaries in a group |
| **Super Admin** | Run the **SaaS business**: tenants, limits, plans, invoices, health |

Build Super Admin as a **control plane** on top of your existing multi-tenant HRMS — do not overload company `admin` with platform powers.

Start with **Phase 1 (companies + suspend + KPIs)**, then **billing (plans/invoices)**, then automation (gateway, flags, impersonation).
