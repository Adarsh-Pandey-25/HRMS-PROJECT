# HRMS Backend — Complete Guide

> **Project:** HR-PROJECT  
> **Stack:** Node.js · Express · Supabase (PostgreSQL + Storage)  
> **API base:** `http://localhost:5000/api`  
> **Timezone:** Asia/Kolkata (IST)

Use this document to explain how the backend was built — in interviews, demos, or team handoffs.

---

## Table of Contents

1. [One-liner summary](#1-one-liner-summary)
2. [Tech stack](#2-tech-stack)
3. [Architecture](#3-architecture)
4. [Project structure](#4-project-structure)
5. [How the server starts](#5-how-the-server-starts)
6. [Express app setup](#6-express-app-setup)
7. [Database design](#7-database-design)
8. [Authentication & authorization](#8-authentication--authorization)
9. [API response format](#9-api-response-format)
10. [Module-by-module logic](#10-module-by-module-logic)
11. [Payroll deep dive](#11-payroll-deep-dive)
12. [Training deep dive](#12-training-deep-dive)
13. [Cross-cutting systems](#13-cross-cutting-systems)
14. [Security model](#14-security-model)
15. [Environment variables](#15-environment-variables)
16. [Full API map](#16-full-api-map)
17. [How to tell the build story](#17-how-to-tell-the-build-story)
18. [Key design decisions](#18-key-design-decisions)

---

## 1. One-liner summary

> "I built a **REST API backend** for an HRMS using **Node.js + Express**, with **Supabase (PostgreSQL)** as the database and file storage. The API handles auth, attendance, leaves, payroll, training, documents, and more — with **role-based access control**, **JWT authentication**, and a **layered architecture** (routes → controllers → services → database)."

---

## 2. Tech stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js |
| Framework | Express.js |
| Database | Supabase (PostgreSQL) |
| File storage | Supabase Storage |
| Auth | JWT + bcrypt + refresh tokens |
| Validation | express-validator |
| Security | Helmet, CORS, rate limiting |
| Email | Nodemailer (SMTP) |
| PDF | PDFKit (payslips) |
| Cron jobs | node-cron |
| Logging | Winston |
| Timezone | moment-timezone (Asia/Kolkata) |

---

## 3. Architecture

Every API call follows the same pipeline:

```
Client (React) → HTTP + JWT → Express App
    → Global Middleware (helmet, cors, rate limit)
    → Route + Auth + Role check
    → Validation
    → Controller (thin)
    → Service (business logic)
    → Supabase DB / Storage / Email / PDF
    → JSON Response
```

### Layer responsibilities

| Layer | Folder | Job |
|-------|--------|-----|
| **Entry** | `server.js` | Starts server, cron, error handlers |
| **App setup** | `app.js` | Middleware, route mounting |
| **Routes** | `routes/*.routes.js` | URL + HTTP method + who can access |
| **Controllers** | `controllers/*.controller.js` | Parse request, call service, send response |
| **Services** | `services/*.service.js` | Business logic, DB queries, calculations |
| **Middleware** | `middleware/*.js` | Auth, roles, validation, uploads, IP check |
| **Config** | `config/*.js` | Env vars, Supabase, email |
| **Utils** | `utils/*.js` | Helpers, errors, constants, validators |

**Why this structure?** Routes stay thin. Business logic lives in services. Easy to test, maintain, and explain.

---

## 4. Project structure

```
backend/
├── src/
│   ├── server.js              # App entry point
│   ├── app.js                 # Express config + all routes
│   ├── config/
│   │   ├── database.js        # Env, CORS, rate limits
│   │   ├── supabase.js        # DB client (service role)
│   │   ├── email.js           # SMTP config
│   │   └── payroll.config.js  # Payroll defaults
│   ├── routes/                # 13 route files
│   ├── controllers/           # HTTP handlers
│   ├── services/              # Business logic
│   ├── middleware/            # Auth, roles, upload, IP, errors
│   ├── cron/                  # Auto checkout at 4 AM
│   └── utils/                 # Helpers, errors, validators
├── supabase/
│   ├── schema.sql             # Main DB schema
│   ├── payroll_v2.sql         # Payroll migrations
│   ├── training_v2.sql        # Training migrations
│   ├── notifications.sql
│   └── leave_types_v2.sql
├── scripts/                   # Seed, migrate helpers
├── postman/                   # API collection for testing
└── .env                       # Secrets (never commit)
```

---

## 5. How the server starts

**File:** `backend/src/server.js`

1. Load `.env` secrets via `dotenv`
2. Import Express `app` from `app.js`
3. Listen on port **5000** (configurable)
4. Start **auto-checkout cron** (4:00 AM IST + 15-min fallback)
5. Handle `SIGTERM`, unhandled rejections, uncaught exceptions

---

## 6. Express app setup

**File:** `backend/src/app.js`

### Global middleware (every request)

| Middleware | Purpose |
|------------|---------|
| `helmet()` | Security headers |
| `compression()` | Smaller responses |
| `cors()` | Only allow frontend origin |
| `morgan()` | Request logging |
| `express.json()` | Parse JSON body (10mb limit) |
| `cookieParser()` | Read auth cookies |
| `generalLimiter` | Rate limit per user/IP |

### Mounted routes

```
GET  /              API info
GET  /health        Health check

/api/auth
/api/employees
/api/attendance
/api/leaves
/api/payroll
/api/reimbursements
/api/training
/api/announcements
/api/holidays
/api/documents
/api/settings
/api/reports
/api/notifications
```

---

## 7. Database design

**Database:** Supabase PostgreSQL  
**Access:** Backend uses **service role key** — all security enforced in Express.

### Core tables

| Table | Purpose |
|-------|---------|
| `employees` | Users, roles, salary, department, manager |
| `refresh_tokens` | JWT refresh token storage |
| `password_reset_tokens` | OTP-based password reset |
| `attendance` | Check-in/out records |
| `leaves` + `leave_balances` | Leave requests and balances |
| `payroll` + `payroll_months` + `payroll_components` | Payslips and salary rules |
| `reimbursements` | Expense claims |
| `documents` | Employee document metadata |
| `courses`, `course_chapters`, `lessons` | Training structure |
| `course_enrollments`, `lesson_progress` | Training progress |
| `announcements`, `holidays` | Company comms |
| `notifications` | In-app alerts |
| `system_settings` | Admin-configurable settings |

### Roles (PostgreSQL enum)

```
admin → hr → manager → employee
```

Higher roles inherit lower permissions in middleware (e.g. `isEmployee` allows all four roles).

### Employee salary (JSONB)

```json
{
  "basic": 45000,
  "hra": 18000
}
```

Stored in `employees.salary_details` — used by payroll calculation.

---

## 8. Authentication & authorization

### Login flow

1. User sends `POST /auth/login` with email + password
2. Backend finds employee in `employees` table
3. `bcrypt.compare()` validates password
4. Generate **access token** (JWT, 24h) + **refresh token** (JWT, 7d)
5. Store refresh token hash in `refresh_tokens` table
6. Return tokens + employee profile (password_hash stripped)

### On every protected route

1. `authenticate` middleware reads token from `Authorization: Bearer` header or cookie
2. Verifies JWT with `JWT_SECRET`
3. Loads full employee from DB (must be `is_active = true`)
4. Sets `req.user` for downstream handlers

### Role middleware

```javascript
isAdmin          → admin only
isHROrAdmin      → hr, admin
isManagerOrAbove → manager, hr, admin
isEmployee       → all roles (any logged-in user)
```

### Auth endpoints

| Endpoint | Who | What |
|----------|-----|------|
| `POST /auth/register` | Admin | Create employee account |
| `POST /auth/login` | Public | Login (+ office IP check) |
| `POST /auth/refresh-token` | Public | Get new access token |
| `POST /auth/logout` | Authenticated | Revoke refresh token |
| `GET /auth/me` | Authenticated | Current user profile |
| `PUT /auth/change-password` | Authenticated | Change password |
| `POST /auth/forgot-password` | Public | Send OTP email |
| `POST /auth/reset-password` | Public | Reset with OTP |

### Default password on registration

Format: `{FirstName}{LastName}@123` (no space)  
Sent to employee via welcome email.

---

## 9. API response format

### Success

```json
{
  "success": true,
  "message": "Payslips fetched",
  "data": { },
  "timestamp": "2026-07-13T..."
}
```

### Error

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient permissions",
    "details": null
  },
  "timestamp": "2026-07-13T..."
}
```

### Error classes

| Class | HTTP | When |
|-------|------|------|
| `BadRequestError` | 400 | Invalid input |
| `UnauthorizedError` | 401 | Missing/invalid token |
| `ForbiddenError` | 403 | Wrong role |
| `NotFoundError` | 404 | Resource missing |
| `ConflictError` | 409 | Duplicate / already exists |

---

## 10. Module-by-module logic

### Employees (`/api/employees`)

| Endpoint | Role | Action |
|----------|------|--------|
| `POST /create` | HR/Admin | Create employee |
| `GET /all` | HR/Admin | List all employees |
| `GET /team/:managerId` | Manager+ | Team under manager |
| `GET /:id` | Authenticated | Get employee |
| `PUT /:id/update` | Authenticated | Update employee |
| `DELETE /:id` | Admin | Delete employee |
| `PUT /:id/deactivate` | HR/Admin | Deactivate account |

---

### Attendance (`/api/attendance`)

| Endpoint | Role | Action |
|----------|------|--------|
| `POST /check-in` | Employee | Record check-in (office IP optional) |
| `POST /check-out` | Employee | Record check-out, calculate hours |
| `GET /check-context` | Employee | Today's status + IP context |
| `GET /my-attendance` | Employee | Own records |
| `GET /team-attendance` | Manager+ | Team records |
| `GET /all-attendance` | HR/Admin | All records |
| `GET /monthly-summary` | Employee | Month stats (used by payroll) |
| `PUT /manual-entry` | HR/Admin | Manual attendance correction |

**Attendance status logic:**
- `present` — on time, full hours
- `late` — checked in after 9:30 AM + threshold
- `half_day` — worked less than half of 9 hours
- `early_departure` — worked less than 9 hours

**Auto-checkout cron:**
- Runs at **4:00 AM IST** daily
- Catches up on server startup
- Fallback every **15 minutes**
- Closes sessions where employee forgot to check out

---

### Leaves (`/api/leaves`)

| Endpoint | Role | Action |
|----------|------|--------|
| `POST /apply` | Employee | Submit leave request |
| `GET /my-leaves` | Employee | Own leaves |
| `GET /team-leaves` | Manager+ | Team leaves |
| `GET /all-leaves` | HR/Admin | All leaves |
| `PUT /:id/approve` | Manager+ | Approve leave |
| `PUT /:id/reject` | Manager+ | Reject leave |
| `DELETE /:id/cancel` | Employee | Cancel own pending leave |
| `GET /balance/:employeeId` | Authenticated | Leave balance by type |
| `GET /types` | Authenticated | Available leave types |
| `GET /calendar` | Authenticated | Team leave calendar |

**Leave types:** CL, SL, EL, WFH, COMP_OFF, MATERNITY, PATERNITY, UNPAID

**Workflow:** apply → pending → manager approves/rejects → balance updated

---

### Payroll (`/api/payroll`)

See [Section 11 — Payroll deep dive](#11-payroll-deep-dive).

---

### Reimbursements (`/api/reimbursements`)

| Endpoint | Role | Action |
|----------|------|--------|
| `POST /submit` | Employee | Submit claim + receipt upload |
| `GET /my-reimbursements` | Employee | Own claims |
| `GET /team-reimbursements` | Manager+ | Team claims |
| `GET /all-reimbursements` | HR/Admin | All claims |
| `PUT /:id/approve` | Manager+ | Approve |
| `PUT /:id/reject` | Manager+ | Reject |
| `GET /:id/receipt` | Employee | Download receipt |

---

### Training (`/api/training`)

See [Section 12 — Training deep dive](#12-training-deep-dive).

---

### Documents (`/api/documents`)

| Endpoint | Role | Action |
|----------|------|--------|
| `POST /upload` | Employee | Upload document |
| `GET /my-documents` | Employee | Own documents |
| `GET /all` | HR/Admin | All documents |
| `PUT /:id/verify` | HR/Admin | Verify document |
| `GET /:id/download` | Authenticated | Download via signed URL |

**Document types:** offer_letter, aadhar, pan, payslip, form_16, etc.

---

### Announcements & Holidays

- HR creates announcements (priority, audience: all/hr/managers/employees)
- Holiday calendar (public / optional / restricted)

---

### Settings (`/api/settings`) — Admin only

| Area | What |
|------|------|
| System settings | Office IP, remote login, payroll rates |
| Payroll components | Dynamic salary structure (earnings/deductions) |
| Leave allocations | Days per leave type per year |
| Leave policy | Rules applied to all employees |

---

### Reports (`/api/reports`)

- `GET /team-performance` — Manager dashboard data

---

### Notifications (`/api/notifications`)

- In-app notifications (payroll published, leave approved, etc.)
- `GET /` — list notifications
- `GET /unread-count` — badge count
- `PUT /:id/read` — mark one read
- `PUT /read-all` — mark all read

---

## 11. Payroll deep dive

### Workflow

```
HR: Initialize Month → Generate Drafts → Review → Publish → PDF + Notify Employee
```

### Month statuses

| Status | Meaning |
|--------|---------|
| `PENDING` | Month open, drafts can be generated |
| `COMPLETED` | All employees published — month closed |

### Payslip statuses

| Status | Who can see |
|--------|-------------|
| `DRAFT` | HR/Admin only |
| `PUBLISHED` | Employee + HR/Admin |

### Salary calculation (`calculateContractPayslip`)

**Inputs:**
- `employee.salary_details` → basic, hra
- Attendance monthly summary → present days
- System settings → working days, PF rate, professional tax
- Optional `payroll_components` from Settings

**Formulas:**

```
gross              = basic + hra
present_days       = present + (half_day × 0.5)
unpaid_leave_days  = max(0, working_days - present_days)
lop_deduction      = (gross / working_days) × unpaid_leave_days
pf_deduction       = basic × pf_rate          (default 12%)
professional_tax   = fixed amount             (default ₹200)
net_pay            = gross - all deductions
```

**Month auto-close:** When every active employee has a published payslip → `payroll_months.status = COMPLETED`

### API endpoints

| Endpoint | Role | Action |
|----------|------|--------|
| `POST /months` | HR/Admin | Initialize payroll month |
| `GET /months` | Employee | Get month status |
| `POST /payslips/generate` | HR/Admin | Generate draft(s) |
| `PUT /payslips/:id/publish` | HR/Admin | Publish + PDF + notify |
| `GET /payslips` | Employee | List payslips |
| `GET /payslips/:id/download` | Owner/HR | Download PDF |

---

## 12. Training deep dive

### Structure

```
Course → Chapter → Lesson (VIDEO_UPLOAD or EXTERNAL_LINK)
```

### Department targeting

- Courses have `target_departments` array (e.g. `["Sales", "Marketing"]`)
- Employee only sees courses matching their `department` (case-insensitive)

### Anti-skip logic

**Backend (`PROGRESS_JUMP_TOLERANCE = 12`):**
- Rejects progress if jump > 12 seconds ahead
- Never allows progress to go backward in DB
- Marks complete at `duration - 5` seconds

**Frontend:**
- Uploaded videos: blocks timeline seek ahead
- YouTube: IFrame API snaps back on scrub

### Sequential lesson locking

- Lesson N+1 locked until Lesson N is `is_completed = true`

### API endpoints

| Endpoint | Role | Action |
|----------|------|--------|
| `POST /courses` | Manager+ | Create course |
| `GET /courses/manage` | Manager+ | List all courses |
| `POST /courses/:id/chapters` | Manager+ | Add chapter |
| `POST /chapters/:id/lessons` | Manager+ | Add lesson (+ video upload) |
| `GET /courses` | Employee | Department-filtered catalog |
| `GET /courses/:id` | Employee | Course player structure |
| `POST /courses/:id/enroll` | Employee | Enroll in course |
| `POST /lessons/:id/progress` | Employee | Save watch progress |
| `GET /lessons/:id/video-url` | Employee | Signed video URL |
| `GET /progress-report` | Manager+ | Employee completion dashboard |

---

## 13. Cross-cutting systems

### File storage (`storage.service.js`)

| Bucket | Used for |
|--------|----------|
| `documents` | HR documents |
| `receipts` | Reimbursement receipts |
| `training-materials` | Course videos, thumbnails |
| `payslips` | Generated PDF payslips |
| `profile-pictures` | Employee photos |

- Files are **not public**
- Backend generates **signed URLs** with in-memory cache
- Training video max: **50 MB**

### Email (`email.service.js`)

- Welcome email with default password
- Password reset OTP (10 min expiry)
- SMTP via Nodemailer

### Cron (`cron/autoCheckout.cron.js`)

- 4:00 AM IST daily
- Startup catch-up
- 15-minute interval fallback

### Office IP validation

- Optional check-in restriction to office network
- Config: `ALLOW_REMOTE_LOGIN`, `OFFICE_IP`, `OFFICE_CIDR`
- Also configurable via Admin Settings

### Validation

- `express-validator` rules in `utils/validators.js`
- Applied before controller on every write endpoint
- UUID params, pagination, email, file types validated

### Logging

- Winston logger
- Daily rotate file in production
- Errors logged with path + method; stack hidden from client in production

---

## 14. Security model

```
Frontend (public)  →  only knows API URL (VITE_API_BASE_URL)
        ↓
   JWT on every request (Authorization: Bearer)
        ↓
Backend (private)  →  holds all secrets in .env
        ↓
Supabase service key → full DB + storage access
```

### Security layers

1. JWT authentication on protected routes
2. Role-based authorization per endpoint
3. Input validation on all writes
4. Rate limiting (general + auth routes)
5. Helmet + CORS (locked to FRONTEND_URL)
6. bcrypt password hashing (10 rounds)
7. Sensitive fields stripped from API responses
8. Signed URLs for files (buckets not public)
9. Production error masking (no stack traces to client)
10. Refresh tokens stored as SHA-256 hash

### Secrets — backend only (never in frontend)

```
JWT_SECRET
JWT_REFRESH_SECRET
SUPABASE_SERVICE_KEY
SMTP_PASSWORD
```

### Frontend .env — safe values only

```
VITE_API_BASE_URL=http://localhost:5000/api
```

---

## 15. Environment variables

**File:** `backend/.env` (see `backend/.env.example` for template)

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | development / production |
| `PORT` | Server port (default 5000) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Full DB access (secret) |
| `SUPABASE_ANON_KEY` | Limited access (backend only) |
| `JWT_SECRET` | Access token signing |
| `JWT_REFRESH_SECRET` | Refresh token signing |
| `JWT_EXPIRE` | Access token TTL (default 24h) |
| `JWT_REFRESH_EXPIRE` | Refresh token TTL (default 7d) |
| `FRONTEND_URL` | CORS allowed origin |
| `SMTP_*` | Email configuration |
| `OFFICE_IP` / `OFFICE_CIDR` | Office network for check-in |
| `ALLOW_REMOTE_LOGIN` | true/false |
| `TZ` | Asia/Kolkata |
| `WORK_HOURS` | Standard work hours (9) |
| `AUTO_CHECKOUT_TIME` | 04:00 |
| `RATE_LIMIT_MAX` | Requests per minute |
| `MAX_FILE_SIZE` | Upload limit (bytes) |

---

## 16. Full API map

```
AUTH
  POST   /auth/register
  POST   /auth/login
  POST   /auth/logout
  POST   /auth/refresh-token
  GET    /auth/me
  PUT    /auth/change-password
  POST   /auth/forgot-password
  POST   /auth/reset-password

EMPLOYEES
  POST   /employees/create
  GET    /employees/all
  GET    /employees/team/:managerId
  GET    /employees/:id
  PUT    /employees/:id/update
  DELETE /employees/:id
  PUT    /employees/:id/deactivate

ATTENDANCE
  POST   /attendance/check-in
  POST   /attendance/check-out
  GET    /attendance/check-context
  GET    /attendance/my-attendance
  GET    /attendance/team-attendance
  GET    /attendance/all-attendance
  GET    /attendance/monthly-summary
  PUT    /attendance/manual-entry

LEAVES
  POST   /leaves/apply
  GET    /leaves/my-leaves
  GET    /leaves/team-leaves
  GET    /leaves/all-leaves
  PUT    /leaves/:id/approve
  PUT    /leaves/:id/reject
  DELETE /leaves/:id/cancel
  GET    /leaves/balance/:employeeId
  GET    /leaves/types
  GET    /leaves/calendar

PAYROLL
  POST   /payroll/months
  GET    /payroll/months
  POST   /payroll/payslips/generate
  PUT    /payroll/payslips/:id/publish
  GET    /payroll/payslips
  GET    /payroll/payslips/:id/download

REIMBURSEMENTS
  POST   /reimbursements/submit
  GET    /reimbursements/my-reimbursements
  GET    /reimbursements/team-reimbursements
  GET    /reimbursements/all-reimbursements
  PUT    /reimbursements/:id/approve
  PUT    /reimbursements/:id/reject

TRAINING
  POST   /training/courses
  GET    /training/courses
  GET    /training/courses/manage
  POST   /training/courses/:id/chapters
  POST   /training/chapters/:id/lessons
  POST   /training/lessons/:id/progress
  GET    /training/progress-report

DOCUMENTS
  POST   /documents/upload
  GET    /documents/my-documents
  GET    /documents/all
  GET    /documents/:id/download

SETTINGS (admin)
  GET    /settings
  GET    /settings/payroll-components
  POST   /settings/payroll-components
  GET    /settings/leave-policy

NOTIFICATIONS
  GET    /notifications
  GET    /notifications/unread-count
  PUT    /notifications/:id/read
  PUT    /notifications/read-all
```

---

## 17. How to tell the build story

### Step 1 — Planning
"I designed a modular HRMS with 4 roles and 10+ HR features. I chose **Express + Supabase** so I get PostgreSQL and file storage without managing infrastructure."

### Step 2 — Foundation
"I set up layered architecture: routes, controllers, services. I built auth first — JWT, refresh tokens, bcrypt — because every module depends on it."

### Step 3 — Core HR modules
"I added attendance with IP validation and auto-checkout cron, leave management with approval workflow and balances, then payroll with a draft/publish workflow and PDF generation."

### Step 4 — Extended features
"I built reimbursements with file uploads, document management, training with anti-skip video progress, announcements, holidays, and in-app notifications."

### Step 5 — Admin & configurability
"I added a Settings module so admin can configure payroll components, leave policy, and office rules without code changes."

### Step 6 — Production readiness
"I added Helmet, CORS, rate limiting, Winston logging, centralized error handling, timezone support for IST, and environment-based configuration."

---

## 18. Key design decisions

| Decision | Why |
|----------|-----|
| Supabase instead of raw PostgreSQL | Faster setup, built-in storage, managed DB |
| Service layer separate from controllers | Reusable logic, cleaner tests |
| JWT + refresh tokens | Stateless API, secure session refresh |
| `breakdown_json` in payroll | Flexible payslip lines without schema changes |
| Department-based training | Auto-assign courses, no manual enrollment lists |
| Cron + interval fallback | Reliable auto-checkout on Windows dev |
| Signed URL cache | Faster video/document loading |
| Settings table | Admin can change rules without redeploy |
| Draft → Publish payroll | HR reviews before employees see payslips |
| Anti-skip on backend + frontend | Frontend UX + server as source of truth |

---

## Interview quick answers

**Q: How does auth work?**  
JWT access token on every request. Refresh token stored hashed in DB. bcrypt for passwords. Role checked per route.

**Q: How does payroll calculate salary?**  
Basic + HRA = gross. LOP from attendance (working days minus present days). PF on basic. Fixed PT. Optional dynamic components from Settings. Net = gross - deductions.

**Q: How do you secure file uploads?**  
Multer validates type/size. Files go to private Supabase buckets. API returns signed URLs, not public links.

**Q: How does training prevent skipping?**  
Backend rejects progress jumps > 12 seconds. Frontend blocks video seek. YouTube uses IFrame API to snap back.

**Q: Why Express + Supabase?**  
Express gives full control over business logic and auth. Supabase handles PostgreSQL and storage without ops overhead.

---

*Generated for HR-PROJECT · Last updated: July 2026*
