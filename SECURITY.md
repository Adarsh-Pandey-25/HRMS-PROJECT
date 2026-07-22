# HRMS Security Reference

Complete guide to **what security exists** in this project, **why each control exists**, and **what risks remain**.

**Scope:** `backend/` + `HRMS/` frontend  
**Related:** [API_REFERENCE.md](./API_REFERENCE.md)

---

## Why security matters in this HRMS

This system holds **PII** (names, emails, phones), **payroll/salary**, **bank details**, **documents** (Aadhaar/PAN-style uploads), **attendance**, and **company settings**.

If security fails, an attacker (or even another company on the same SaaS) could:

- Steal or change passwords and take over accounts  
- Read another company’s employees, payslips, or tickets  
- Inject malicious scripts into announcements and hijack admin sessions  
- Upload malware disguised as PDFs/images  
- Brute-force login or OTP endpoints  
- Exfiltrate secrets from API responses, browser storage, or logs  

Every control below exists to block one or more of those outcomes.

---

## Table of contents

1. [Authentication — who are you?](#1-authentication--who-are-you)
2. [HTTP & network hardening](#2-http--network-hardening)
3. [Authorization (RBAC) — what can you do?](#3-authorization-rbac--what-can-you-do)
4. [Input validation](#4-input-validation)
5. [Response sanitization & privacy](#5-response-sanitization--privacy)
6. [File uploads & storage](#6-file-uploads--storage)
7. [Secrets & environment](#7-secrets--environment)
8. [Frontend security](#8-frontend-security)
9. [Multi-tenant isolation](#9-multi-tenant-isolation)
10. [Email & OTP](#10-email--otp)
11. [Logging](#11-logging)
12. [Attendance / IP controls](#12-attendance--ip-controls)
13. [Other module controls](#13-other-module-controls)
14. [Remaining security concerns (explained)](#14-remaining-security-concerns-explained)
15. [Maturity snapshot](#15-maturity-snapshot)
16. [Source files](#16-source-files)

**Status legend:** **Implemented** = in use · **Partial** = exists with caveats · **Gap** = missing / weak

---

## 1. Authentication — who are you?

**Reason this section exists:** Without strong authentication, anyone who can call the API could pretend to be HR/Admin and access the whole company.

### JWT access tokens — **Implemented**

- **What:** Short-lived signed tokens (`JWT_SECRET`, ~24h) identifying the user.
- **Why:** The server must know *which* employee is calling without storing a server-side session for every request. Signing prevents clients from forging `role: admin`.

### JWT refresh tokens — **Implemented**

- **What:** Longer-lived tokens (`JWT_REFRESH_SECRET`, ~7d) used only to get a new access token.
- **Why:** Access tokens expire often (limits damage if stolen). Refresh tokens let users stay signed in without typing the password every hour.

### Refresh token hashing in DB — **Implemented**

- **What:** Only SHA-256 hashes of refresh tokens are stored.
- **Why:** If the database is leaked, attackers cannot reuse raw refresh tokens to mint new sessions.

### HttpOnly cookies — **Implemented**

- **What:** Tokens are set as `httpOnly`, `sameSite: strict`, `secure` in production. Not returned in login JSON.
- **Why:**
  - `httpOnly` → JavaScript (including XSS) cannot read the cookie.
  - `sameSite=strict` → browser won’t send cookies on most cross-site requests (reduces CSRF).
  - `secure` → cookies only over HTTPS in production.
  - Not putting tokens in `localStorage` avoids the classic “XSS steals token” attack.

### Cookie + Bearer dual read — **Implemented**

- **What:** Middleware accepts cookie **or** `Authorization: Bearer`.
- **Why:** Browser app uses cookies; tools/scripts can still use Bearer if needed.

### Active-user revalidation — **Implemented**

- **What:** Every request verifies JWT **and** reloads the employee with `is_active = true`.
- **Why:** Deactivating someone must cut access immediately — a token alone must not keep working forever after HR disables the account.

### Password hashing (bcrypt) — **Implemented**

- **What:** Passwords stored with bcrypt (10 rounds), never plaintext.
- **Why:** If the DB leaks, attackers cannot use passwords as-is; bcrypt is slow to crack by design.

### Password policy — **Partial**

- **What:** Min length, number, special character (configurable).
- **Why:** Stops trivial passwords (`123456`). Incomplete vs common guidance (no forced upper/lower) — still better than nothing.

### Password-reset OTP — **Implemented**

- **What:** 6-digit OTP, hashed, 10‑min expiry, one-time; response never confirms whether email exists.
- **Why:**
  - Reset without knowing the old password.
  - Hashing means DB leak ≠ OTP reuse.
  - Short expiry + one-time use limits guessing.
  - Generic message prevents **email enumeration** (attackers learning which emails are registered).

### OTP lockout / resend cooldown — **Partial**

- **What:** Max 3 wrong OTPs; progressive wait; in-memory guards.
- **Why:** Stops unlimited OTP guessing. **Caveat:** in-memory = resets on server restart and doesn’t sync across multiple servers.

### Onboarding email OTP — **Partial**

- **What:** Admin email must be verified before creating a company workspace.
- **Why:** Stops strangers spinning up workspaces with *your* email, or mass-creating spam companies.

### Logout / revoke — **Implemented**

- **What:** Deletes refresh hashes and clears cookies.
- **Why:** “Sign out” must actually invalidate the session, not leave a working refresh token behind.

### Default generated passwords — **Partial**

- **What:** Pattern like `FirstNameLastName@123`, emailed.
- **Why (product):** New users need a first password.  
- **Risk:** Pattern is guessable until they change it — treat as temporary only.

### Login account lockout — **Gap**

- **Why we care:** Without lockout after N wrong passwords, attackers can try many passwords against one account (rate limit helps by IP, not always by account).

### MFA / 2FA — **Gap**

- **Why we care:** Stolen password alone should not be enough for Admin/HR. Second factor (app/SMS) blocks most phishing + password reuse.

---

## 2. HTTP & network hardening

**Reason:** Even with good auth, the HTTP layer can leak metadata, allow abuse, or accept traffic from hostile websites.

### Helmet — **Implemented**

- **Why:** Sets browser security headers (frame denial, MIME sniffing protection, etc.) so the API is harder to embed/abuse in attacks.

### Hide `X-Powered-By` — **Implemented**

- **Why:** Don’t advertise “Express” to attackers scanning for known framework bugs.

### Trust proxy (loopback only) — **Implemented**

- **Why:** Correct client IP behind Vite/ngrok — but only trust local proxy. Trusting all proxies would let attackers spoof IPs and bypass rate limits / office IP rules.

### CORS whitelist — **Implemented**

- **Why:** Only your frontend origin may call the API with cookies. Without this, any website could try to make the user’s browser hit your API while logged in.

### Rate limiting (general + auth + bootstrap + OTP) — **Implemented**

- **Why:**
  - General: stop API flooding / DoS.
  - Auth: slow password stuffing and credential stuffing.
  - Bootstrap/OTP: stop mass company creation and OTP spam to inboxes.

### Body size limits — **Implemented**

- **Why:** Huge JSON bodies can crash or exhaust memory (DoS). Cap keeps requests bounded.

### CSRF tokens — **Partial**

- **Why CSRF matters:** A malicious site could try to trigger “approve leave” using the user’s cookies.  
- **Why SameSite helps:** Modern browsers mostly won’t send strict cookies on cross-site posts.  
- **Gap:** No explicit CSRF token — relies on SameSite + CORS.

---

## 3. Authorization (RBAC) — what can you do?

**Reason:** Authentication only proves identity. Authorization ensures an **employee** cannot run payroll or delete the company.

### `authenticate` on almost all routes — **Implemented**

- **Why:** No anonymous access to HR data.

### Role helpers (`isHROrAdmin`, `isManagerOrAbove`, …) — **Implemented**

- **Why:** Clear role gates at the route layer — e.g. only HR/Admin generate payslips.

### Ownership / team checks in services — **Implemented**

- **Why:** A manager should see **their team**, not every leave in the company; an employee should only cancel **their own** leave. Role alone is not enough.

### Frontend `RequireAuth` / permission matrix — **Partial**

- **Why UI gates exist:** Better UX (hide buttons users can’t use).  
- **Critical reason they’re not enough:** Attackers call the API directly. **Backend must always enforce.**

### Settings writable by HR — **Partial**

- **Why it’s a concern:** HR can change the permission matrix. Convenient, but a compromised HR account can widen access. Some orgs lock that to Admin only.

---

## 4. Input validation

**Reason:** Never trust client input. Invalid or malicious payloads cause crashes, SQL/logic bugs, or data corruption.

### express-validator + `validate` middleware — **Implemented**

- **Why:** Rejects bad emails, unknown enums, invalid UUIDs, wrong date formats **before** business logic runs.

### Announcement HTML check — **Partial**

- **Why partial:** Ensures content isn’t empty after stripping tags, but does **not** remove dangerous HTML (`<script>`, event handlers). That’s an XSS gap (see §14).

### Mass-assignment guards — **Implemented**

- **Why:** Without them, a client could POST `role: "admin"` or `password_hash: "..."` and escalate privileges.

### Pagination caps — **Implemented**

- **Why:** `?limit=999999` could dump entire tables and overload the DB.

---

## 5. Response sanitization & privacy

**Reason:** Even authorized APIs must not accidentally send secrets that belong in the DB only.

### `sanitizeForClient` on every success response — **Implemented**

- **Why:** Nested joins (`employee:*`) used to be able to leak `password_hash`. Central stripping is a safety net so one missed query doesn’t expose hashes/tokens/API keys to DevTools → Network.

### `omitSensitive` / employee privacy — **Implemented**

- **Why:** Colleagues shouldn’t see each other’s **bank/salary** unless they’re HR/Admin or self. Least privilege for PII.

### No temp passwords in API / toasts — **Implemented**

- **Why:** Passwords in JSON or UI toast appear in Network tabs, screenshots, support chat, and browser history. Email is still imperfect, but better than broadcasting to the frontend.

### Error masking (5xx) — **Implemented**

- **Why:** Stack traces and DB errors help attackers map your stack and find injection points. Clients only get a generic message.

---

## 6. File uploads & storage

**Reason:** Uploads are a classic malware / path-traversal / storage-abuse vector.

### Extension + MIME filter (Multer) — **Implemented**

- **Why:** Block `.exe` renamed casually; only allow expected types.

### Magic-byte signature checks — **Implemented**

- **Why:** Attackers rename `malware.exe` → `file.pdf`. Checking file **content** (magic bytes) stops that lie.

### Size limits — **Implemented**

- **Why:** Prevent filling disk/bandwidth with huge uploads.

### Private buckets + signed URLs — **Implemented**

- **Why:** Files aren’t public URLs. Access requires auth + a short-lived signed link, so random internet users can’t browse payslips.

### Download authz (documents / receipts) — **Implemented**

- **Why:** Even with signed URLs, only generate them for people allowed to see that file.

### Long payslip URL TTL (~1 year) — **Partial**

- **Why it’s a risk:** If a payslip link is forwarded or logged, it may work for a long time. Shorter TTL is safer.

---

## 7. Secrets & environment

**Reason:** Secrets in the frontend or git = permanent leak (browsers, repos, CDNs).

### Backend `.env` + gitignore — **Implemented**

- **Why:** JWT secrets, DB keys, SMTP passwords must never be committed.

### Supabase service key server-only — **Implemented**

- **Why:** Service role bypasses RLS and can read/write everything. In the browser it would be catastrophic.

### Frontend only `VITE_API_URL` — **Implemented**

- **Why:** Anything `VITE_*` is public in the built JS. Never put secrets there.

### SMTP credentials not in browser — **Implemented**

- **Why:** SMTP password in `localStorage` or Settings UI = any XSS or shared PC can steal mail-sending credentials and spam as your company.

---

## 8. Frontend security

**Reason:** The browser is a hostile environment (extensions, XSS, malicious sites).

### Cookie session + `withCredentials` — **Implemented**

- **Why:** Aligns with HttpOnly cookie auth; session isn’t copied into JS variables by default.

### Strip `console` / `debugger` in production — **Implemented**

- **Why:** Accidental `console.log(user)` or tokens in builds shouldn’t ship to customers’ DevTools.

### Security headers in Vite dev — **Implemented**

- **Why:** Reduce clickjacking / MIME sniffing during development. Production host should set stronger headers too.

### No CSP in Vite — **Gap**

- **Why CSP matters:** Content-Security-Policy blocks inline scripts and unknown script sources — major XSS defense. Deferred here because CSP breaks Vite HMR; must be added on the **production** host.

### Allowed hosts — **Implemented**

- **Why:** Prevent Host-header attacks when tunneling (ngrok).

### 401 auto-logout — **Implemented**

- **Why:** Expired/invalid session shouldn’t leave a half-broken UI that keeps retrying with bad credentials.

### Announcement `dangerouslySetInnerHTML` — **Gap**

- **Why dangerous:** If HR pastes (or an attacker injects) `<script>` / `<img onerror=...>`, every employee who opens announcements can get their session abused. Needs HTML sanitization (e.g. DOMPurify).

---

## 9. Multi-tenant isolation

**Reason:** This is a **SaaS** HRMS. Company A must never see Company B’s employees, payroll, or tickets.

### `company_id` on users, tables, settings keys — **Implemented**

- **Why:** Every row and setting is tagged to a workspace so queries can filter.

### Query scoping in services — **Partial**

- **Why critical:** Isolation is only as good as each query. One forgotten `.eq('company_id', …)` can leak data across tenants.

### Bootstrap creates a new company UUID — **Implemented**

- **Why:** New customers get an empty, isolated workspace — not another company’s data.

### Service role bypasses DB RLS — **Partial**

- **Why this matters:** Supabase Row Level Security isn’t the real wall here; the **Node backend** is. That’s fine if every query is careful; it’s fragile if developers skip filters. Defense-in-depth would add tenant RLS policies usable with a non-service key.

---

## 10. Email & OTP

**Reason:** Email delivers passwords/OTPs — treat it as semi-trusted.

### SMTP from env only — **Implemented**

- **Why:** Mail credentials stay on the server.

### Redact recipients in logs — **Implemented**

- **Why:** Logs often get copied to support tools; full emails are PII.

### OTP hashed at rest — **Implemented**

- **Why:** Same as password hashing — DB dump shouldn’t give usable OTPs.

### Temp password by email — **Partial**

- **Why needed:** Users must receive first credentials somehow.  
- **Risk:** Email can be intercepted or left in shared inboxes — force password change on first login is the usual next step (not fully enforced as a hard gate today).

---

## 11. Logging

**Reason:** Logs help debugging but become a second database of secrets if careless.

### Console redaction of password/token/otp keys — **Partial**

- **Why:** Developers shouldn’t see live secrets scrolling in terminals.

### File log redaction incomplete — **Partial**

- **Why it matters:** Rotating log files may still contain sensitive meta if someone `logger.info({ password })`. Prefer never logging those fields at all.

### No stack traces to clients — **Implemented**

- **Why:** See §5 — stacks are for operators, not attackers.

---

## 12. Attendance / IP controls

**Reason:** Attendance fraud (check-in from home while marked “office”) costs companies money and trust.

### Office CIDR enforcement — **Implemented**

- **Why:** Office-mode check-in must come from the office network range.

### Login not IP-gated — **By design**

- **Why:** People work remotely and still need to open HRMS. Restricting login to office IP would break WFH. Attendance is the right place for geo/IP rules.

### Biometric webhook weak auth — **Gap**

- **Why dangerous:** A biometric device should prove itself with a **shared secret / HMAC**. Today any logged-in user hitting the webhook with an `employee_code` could forge punches. That’s attendance fraud.

---

## 13. Other module controls

| Control | Why it exists |
|---------|----------------|
| Training anti-skip | Stops “complete course” by seeking to the end without watching. |
| Department-scoped courses | Engineering courses shouldn’t appear for Finance unless intended. |
| Deactivated accounts blocked | Fired/exited staff must lose access immediately. |
| Typed AppError (401/403/404…) | Consistent errors; avoid leaking “user exists” vs “wrong password” where it matters. |
| Public `/health` only | Load balancers need a probe; don’t put secrets there. |

---

## 14. Remaining security concerns (explained)

| # | Severity | Concern | Why it’s a problem | What “good” looks like |
|---|----------|---------|--------------------|------------------------|
| 1 | **High** | Stored XSS (announcements) | Malicious HTML runs in other users’ browsers → cookie abuse, data theft. | Sanitize HTML (DOMPurify) or store markdown/plain text. |
| 2 | **High** | Biometric webhook | Anyone authenticated can forge attendance. | Device API key + HMAC signature + IP allowlist. |
| 3 | **High** | App-only tenant isolation | One buggy query = cross-company data leak (GDPR / customer-destroying). | Mandatory `company_id` helpers + tests; ideally RLS with non-service DB role. |
| 4 | **Medium** | No production CSP | XSS payloads execute more easily. | Strict CSP on nginx/CDN/hosting. |
| 5 | **Medium** | In-memory OTP state | Multi-server deploy: lockouts/OTPs inconsistent; restart clears protections. | Redis/DB-backed OTP + lockout counters. |
| 6 | **Medium** | No login lockout | Targeted password guessing on one email. | Lock account after N failures; captcha / delay. |
| 7 | **Medium** | Predictable default passwords | Attackers who know naming pattern try `Name@123`. | Random temp passwords + forced change on first login. |
| 8 | **Medium** | Long payslip signed URLs | Forwarded link stays valid for months. | Hours/days TTL + re-auth download. |
| 9 | **Medium** | No MFA | Password reuse / phishing = full HR takeover. | TOTP/WebAuthn for Admin/HR. |
| 10 | **Low** | Weak password charset rules | Slightly easier password guessing. | Require upper + lower + number + symbol. |
| 11 | **Low** | File logs not fully redacted | Secrets in log archives. | Structured redaction on all transports. |
| 12 | **Low** | Legacy Bearer/localStorage | Temptation to put tokens in JS again. | Remove Bearer path if unused. |
| 13 | **Low** | Frontend-only RBAC | False sense of security. | Always duplicate checks on API. |
| 14 | **Low** | CSRF = SameSite only | Older browsers / odd embed cases. | Double-submit CSRF token if needed. |
| 15 | **Info** | Passwords over email | Inbox compromise. | Magic links / invite flow + forced reset. |
| 16 | **Info** | No silent refresh | Users get logged out when access cookie expires. | Call `/auth/refresh-token` in background. |

---

## 15. Maturity snapshot

| Area | Level | One-line reason |
|------|-------|-----------------|
| Auth (JWT, cookies, bcrypt, OTP) | **Strong** | Industry-standard session model; gaps are lockout/MFA/OTP store. |
| HTTP hardening | **Strong** | Helmet + CORS + rate limits block common internet abuse. |
| Validation + sanitization | **Strong** | Stops junk input and secret leakage in JSON. |
| Uploads + signed URLs | **Strong** | Magic bytes + private storage; tighten payslip TTL. |
| Tenant isolation | **Partial–Strong** | Works if queries are correct; not DB-enforced. |
| Frontend | **Mixed** | Cookie auth is strong; XSS/CSP need work. |
| Secrets | **Strong** | Server-only env; no SMTP in browser. |

---

## 16. Source files

| Area | Paths |
|------|--------|
| App / Helmet / CORS / rate limit | `backend/src/app.js`, `middleware/rateLimiter.middleware.js`, `config/database.js` |
| Auth | `services/auth.service.js`, `controllers/auth.controller.js`, `middleware/auth.middleware.js`, `routes/auth.routes.js` |
| Roles | `middleware/role.middleware.js`, `routes/*.js` |
| Sanitize / helpers | `utils/helpers.js`, `middleware/errorHandler.middleware.js` |
| Uploads / storage | `middleware/upload.middleware.js`, `middleware/videoUpload.middleware.js`, `services/storage.service.js` |
| Tenant | `utils/tenant.js`, `services/tenant.service.js`, `supabase/migrations/20260720_saas_*.sql` |
| Logging / email | `utils/logger.js`, `services/email.service.js`, `config/email.js` |
| Frontend auth / client | `HRMS/src/api/client.js`, `api/auth.api.js`, `store/authStore.js`, `vite.config.js` |
| Settings / SMTP UI | `HRMS/src/pages/settings/NotificationsSection.jsx`, `store/settingsStore.js` |

---

*Update this file when security controls change. Prefer fixing High items in §14 before shipping to production customers.*
