# HRMS Security Guide

> **Project:** HR-PROJECT  
> **Stack:** React frontend · Express backend · Supabase  
> Use this document to explain security in interviews, demos, or team handoffs.

---

## Table of Contents

1. [Security architecture](#1-security-architecture)
2. [Authentication](#2-authentication)
3. [Authorization (roles)](#3-authorization-roles)
4. [Network & HTTP security](#4-network--http-security)
5. [CORS explained simply](#5-cors-explained-simply)
6. [Input validation](#6-input-validation)
7. [File upload security](#7-file-upload-security)
8. [File & data access](#8-file--data-access)
9. [Secrets management](#9-secrets-management)
10. [Database security](#10-database-security)
11. [Error handling](#11-error-handling)
12. [Module-specific rules](#12-module-specific-rules)
13. [Frontend security](#13-frontend-security)
14. [Security layers summary](#14-security-layers-summary)
15. [Interview answers](#15-interview-answers)
16. [Production checklist](#16-production-checklist)

---

## 1. Security architecture

```
User Browser
    ↓  HTTPS (production) + CORS whitelist
Express API
    ↓  JWT auth + Role check + Validation
Business logic (ownership checks)
    ↓  Service role key (server only)
Supabase DB + Private file storage
```

**Main principle:** The frontend is public. The backend holds all secrets and enforces every rule. Users never get direct database access.

**Key files:**
- `backend/src/middleware/auth.middleware.js`
- `backend/src/middleware/role.middleware.js`
- `backend/src/config/supabase.js`
- `backend/.env` (secrets — never commit)

---

## 2. Authentication

| Feature | How it works |
|---------|--------------|
| **Password hashing** | `bcrypt` with 10 salt rounds — plain passwords never stored |
| **JWT access token** | Short-lived (24h), signed with `JWT_SECRET` |
| **JWT refresh token** | 7 days, signed with `JWT_REFRESH_SECRET` |
| **Refresh token storage** | SHA-256 hash stored in DB — raw token not saved |
| **Token verification** | Every protected route verifies JWT + reloads active user |
| **Logout** | Deletes refresh token from DB — cannot reuse |
| **Password reset** | 6-digit OTP, hashed, expires in 10 minutes, one-time use |
| **Email privacy** | Reset response: "If email exists, OTP sent" — no email enumeration |
| **httpOnly cookies** | Tokens in cookies JS cannot read |
| **Secure cookies** | `secure: true` in production (HTTPS only) |
| **SameSite strict** | Reduces cross-site cookie theft |

### Auth flow

```
Login → bcrypt verify → JWT issued → refresh token hashed in DB
Every request → verify JWT → load employee (is_active = true) → req.user
Logout → delete refresh token hash
```

**Files:** `backend/src/services/auth.service.js`, `backend/src/controllers/auth.controller.js`

---

## 3. Authorization (roles)

Four roles: **admin → hr → manager → employee**

| Middleware | Who can access |
|------------|----------------|
| `isAdmin` | Admin only |
| `isHROrAdmin` | HR + Admin |
| `isManagerOrAbove` | Manager + HR + Admin |
| `isEmployee` | All logged-in users |

### Route-level examples

| Action | Required role |
|--------|---------------|
| Generate/publish payroll | HR / Admin |
| System settings | Admin |
| Apply leave | Employee |
| Approve leave | Manager+ |
| Create employee | HR / Admin |
| Delete employee | Admin |

### Service-level ownership checks

Beyond roles, services verify **who owns the data**:

- Employee can only cancel **own** leaves
- Employee can only download **own** payslips
- Manager approves only **team** requests
- Training courses filtered by **department**
- Document download: owner or HR/Admin

**File:** `backend/src/middleware/role.middleware.js`

---

## 4. Network & HTTP security

| Feature | Purpose | File |
|---------|---------|------|
| **Helmet** | Secure HTTP headers (XSS, clickjacking, etc.) | `app.js` |
| **CORS** | Only whitelisted frontend can call API from browser | `config/database.js` |
| **Rate limiting** | 100 req/min per user/IP; stricter on auth routes | `rateLimiter.middleware.js` |
| **Trust proxy** | Correct client IP behind reverse proxy | `app.js` |
| **Compression** | Smaller responses | `app.js` |

### Rate limiting logic

Priority for identifying the client:
1. JWT user ID (if authenticated)
2. Email (on login routes)
3. IP address (fallback)

---

## 5. CORS explained simply

### What is CORS?

**CORS tells the browser: "This website is allowed to talk to my API."**

### Why you need it

| App | URL (dev) |
|-----|-----------|
| Frontend | `http://localhost:5191` |
| Backend API | `http://localhost:5000` |

Different ports = different origins. Browser blocks cross-origin calls unless backend allows it.

### Your CORS config

```javascript
// backend/src/config/database.js
cors: {
  origin: [process.env.FRONTEND_URL, 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}
```

### Frontend must match

```typescript
// hrms-frontend/src/lib/api.ts
axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  withCredentials: true,  // required for cookies with CORS
})
```

### One-line explanation

> "CORS lets my frontend talk to my backend, but stops other websites from doing the same."

### CORS is NOT

- A replacement for login/JWT
- Protection against Postman or direct API calls (JWT + roles handle that)

### Common error

```
FRONTEND_URL=http://localhost:3000   ← wrong
Browser actually on: localhost:5191  ← blocked
```

**Fix:** Set `FRONTEND_URL=http://localhost:5191` in `backend/.env`

---

## 6. Input validation

All user input validated **before** business logic runs.

| Validated | Rule |
|-----------|------|
| Email | Format + normalize |
| Password | Min 8 characters |
| UUID params | Must be valid UUID |
| Pagination | Page/limit capped (max 100) |
| Payroll month | Month 1–12, valid year |
| File extensions | Whitelist only |

**Files:** `backend/src/utils/validators.js`, `backend/src/middleware/validation.middleware.js`

---

## 7. File upload security

| Rule | Value |
|------|-------|
| Storage | Memory (multer) — not arbitrary disk paths |
| Document types | pdf, doc, docx, jpg, jpeg, png |
| Document max size | 5 MB (configurable) |
| Training video types | mp4, webm, mov, m4v |
| Training video max | 50 MB |
| Thumbnail max | 5 MB (jpg, png, webp) |
| Oversized files | Rejected with clear error |

**Files:** `upload.middleware.js`, `videoUpload.middleware.js`

---

## 8. File & data access

| Feature | How |
|---------|-----|
| **Private buckets** | Supabase storage not public |
| **Signed URLs** | Temporary download links (1–2 hours) |
| **URL cache** | Performance without permanent public URLs |
| **Draft payslips** | Not downloadable until published |
| **Sensitive field stripping** | `password_hash`, `bank_details` never in API responses |

```javascript
// helpers.js
omitSensitive(employee, ['password_hash', 'bank_details'])
```

**File:** `backend/src/services/storage.service.js`

---

## 9. Secrets management

### Backend only (never in frontend or Git)

```
JWT_SECRET
JWT_REFRESH_SECRET
SUPABASE_SERVICE_KEY
SUPABASE_ANON_KEY
SMTP_PASSWORD
```

### Frontend only (safe to expose)

```
VITE_API_BASE_URL=http://localhost:5000/api
```

### Rules

| Do | Don't |
|----|-------|
| Store secrets in `backend/.env` | Commit `.env` to Git |
| Use hosting secret manager in production | Put secrets in frontend `VITE_*` vars |
| Rotate keys if exposed | Share service key in Postman collections |

`backend/.env` is in `.gitignore`.

---

## 10. Database security

| Feature | How |
|---------|-----|
| **Service role key** | Only backend accesses DB — browser never gets key |
| **RLS enabled** | Row Level Security on sensitive Supabase tables |
| **Active user check** | `is_active = false` → cannot login |
| **Unique constraints** | One payslip/employee/month, one enrollment/course |
| **Cascade deletes** | Related records cleaned up |

**Important:** Backend uses service role key, so **Express API is the primary security gate**. RLS is defense in depth.

**Tables with RLS:** employees, attendance, leaves, payroll, reimbursements, documents

---

## 11. Error handling

| Feature | How |
|---------|-----|
| Central error handler | Consistent JSON error format |
| Production masking | Stack traces hidden from client |
| Operational errors | Safe 400/401/403/404 messages |
| Winston logging | Full errors logged server-side only |

**File:** `backend/src/middleware/errorHandler.middleware.js`

---

## 12. Module-specific rules

| Module | Security rule |
|--------|---------------|
| **Auth** | bcrypt, JWT, OTP reset, refresh token rotation |
| **Attendance** | Optional office IP validation for check-in |
| **Leaves** | Approval workflow; balance check; ownership on cancel |
| **Payroll** | Draft → Publish; employees see published only |
| **Training** | Department filter; anti-skip (max 12s progress jump) |
| **Reimbursements** | Manager approval; private receipt storage |
| **Documents** | HR verification; signed URL download |
| **Employees** | Salary/bank hidden; admin-only delete |
| **Settings** | Admin only |
| **Notifications** | User sees own notifications only |

---

## 13. Frontend security

| Feature | How |
|---------|-----|
| JWT in Authorization header | `Bearer <token>` on every API call |
| Auto logout on 401 | Redirect to login |
| Silent token refresh | Retry failed request after refresh |
| No secrets in frontend | Only public API URL in env |
| Protected routes | `RequireAuth` + `RequireRole` components |
| Lazy-loaded routes | Suspense inside layout (no full-page flash) |

**Files:** `hrms-frontend/src/lib/api.ts`, `hrms-frontend/src/routes/RequireAuth.tsx`

---

## 14. Security layers summary

```
Layer 1: CORS + Helmet + Rate limit     → Block bad traffic
Layer 2: JWT Authentication             → Who are you?
Layer 3: Role middleware                → What role do you have?
Layer 4: Input validation               → Is input safe?
Layer 5: Service ownership checks       → Is this YOUR data?
Layer 6: Private storage + signed URLs  → Files protected
Layer 7: Secrets in .env only           → Keys never exposed
```

---

## 15. Interview answers

**Q: How did you secure the HRMS?**

> JWT authentication with bcrypt passwords and refresh token rotation. Role-based access on every route. Helmet, CORS, and rate limiting for HTTP security. Input validation on all writes. Private file storage with signed URLs. Secrets only in backend environment variables.

**Q: Why use CORS?**

> Frontend and backend run on different origins. CORS whitelists only my frontend so my app works in the browser, but random websites cannot call my API.

**Q: Where do API keys go?**

> Backend `.env` only. Frontend gets the public API URL. Supabase service key never leaves the server.

**Q: How are passwords stored?**

> bcrypt hashed with 10 salt rounds. Never returned in API responses.

**Q: How are files protected?**

> Private Supabase buckets. Backend generates short-lived signed URLs. File type and size validated on upload.

**Q: What if someone bypasses the frontend?**

> CORS only affects browsers. Direct API calls still need a valid JWT and correct role. Service-level checks enforce ownership.

---

## 16. Production checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use HTTPS on frontend and API
- [ ] Set `FRONTEND_URL` to exact production domain
- [ ] Set `secure: true` cookies (automatic with `NODE_ENV=production`)
- [ ] Rotate JWT secrets, Supabase service key, SMTP password if ever exposed
- [ ] Add `.env` to `hrms-frontend/.gitignore`
- [ ] Set `ALLOW_REMOTE_LOGIN=false` if office-only check-in required
- [ ] Remove unused CORS origins (e.g. `localhost:3000`)
- [ ] Use hosting secret manager (Railway, Render, AWS) — not hardcoded secrets
- [ ] Lower `AUTH_RATE_LIMIT_MAX` if needed (e.g. 10–20 for login)
- [ ] Consider 2FA for Admin/HR accounts (future enhancement)

---

*Generated for HR-PROJECT · Last updated: July 2026*
