# HRMS Module Working Logic

How every major module works — purpose, roles, step-by-step flows, backend/frontend files, business rules, and data entities.

**Related:** [API_REFERENCE.md](./API_REFERENCE.md) · [SECURITY.md](./SECURITY.md)

---

## Cross-cutting rules (apply almost everywhere)

| Rule | Detail |
|------|--------|
| **Roles** | `admin`, `hr`, `manager`, `employee` |
| **Tenant** | Data scoped by `employees.company_id`. Settings keys: `t:{companyId}:{key}` |
| **Auth** | JWT in HttpOnly cookies; `authenticate` loads active user onto `req.user` |
| **UI RBAC** | Admin bypasses matrix; others use `role_permissions` via `useCan` / `ProtectedRoute` |
| **API base** | `/api/{module}` mounted in `backend/src/app.js` |

---

## Table of contents

1. [Auth / Onboarding / Session](#1-auth--onboarding--session)
2. [Dashboard & Global Search](#2-dashboard--global-search)
3. [Employees](#3-employees)
4. [Attendance (+ WFH, shifts, office IP)](#4-attendance--wfh-shifts-office-ip)
5. [Leave](#5-leave)
6. [Payroll / Payslips](#6-payroll--payslips)
7. [Reimbursements / Expenses](#7-reimbursements--expenses)
8. [Training / LMS / Courses](#8-training--lms--courses)
9. [Announcements](#9-announcements)
10. [Holidays](#10-holidays)
11. [Documents](#11-documents)
12. [Settings](#12-settings)
13. [Notifications](#13-notifications)
14. [Assets](#14-assets)
15. [Performance](#15-performance)
16. [Recruitment](#16-recruitment)
17. [Helpdesk / Knowledge Base](#17-helpdesk--knowledge-base)
18. [Reports](#18-reports)
19. [API prefix quick reference](#19-api-prefix-quick-reference)
20. [Known asymmetries](#20-known-asymmetries)

---

## 1. Auth / Onboarding / Session

**Purpose:** Authenticate users, create new company workspaces, keep cookie sessions alive.

**Who**
- Public: login, forgot/reset password, onboarding OTP + bootstrap  
- Authenticated: logout, refresh, me, change password  
- HR/Admin: register user  

**Working logic**

1. **New company onboarding**  
   Welcome → `/onboarding` → company / contact / brand / admin steps → send OTP → verify OTP → `bootstrap-admin` creates `companies` + first `admin` employee + seeded settings → login with emailed temp password.

2. **Login**  
   `/login` → `POST /api/auth/login` → HttpOnly cookies set → frontend hydrates via `/auth/me` → dashboard prefetch.

3. **Session restore**  
   App boot → `hydrateSession()` → `/auth/me`. Failure clears session.

4. **Forgot password**  
   Email OTP → reset with OTP + new password (policy from `security_config`).

5. **Logout**  
   Clear cookies + React Query cache.

**Backend:** `routes/auth.routes.js` · `controllers/auth.controller.js` · `services/auth.service.js`  
**Frontend:** `Login.jsx`, `Onboarding.jsx`, `ForgotPassword.jsx`, `Welcome.jsx` · `store/authStore.js` · `api/auth.api.js`

**Key rules**
- Tokens stay in cookies (not login JSON).
- Onboarding requires verified email OTP before bootstrap.
- Each bootstrap creates an **isolated** `company_id`.
- Temp passwords are emailed only (not returned to the UI).

**Entities:** `employees`, `companies`, `refresh_tokens`, `password_reset_tokens`, `system_settings`

---

## 2. Dashboard & Global Search

**Purpose:** Role-specific home KPIs and topbar search.

**Who:** All authenticated roles (dashboard endpoint matches role).

**Working logic**

1. Open `/dashboard` → `GET /api/dashboard/{admin|hr|manager|employee}`.
2. **Admin/HR:** headcount, today’s attendance, pending leave/expense/tickets, announcements, charts.
3. **Manager:** team attendance/leave/expense summaries + pending approvals.
4. **Employee:** own attendance, leave balance, payslips, claims, announcements.
5. Global search (≥2 chars, debounced) → `GET /api/dashboard/search` → results dropdown / `/search`.

**Backend:** `dashboard.routes.js` · `dashboard.controller.js` · `dashboard.service.js`  
**Frontend:** `pages/dashboard/*` · `hooks/useDashboardData.js` · `useGlobalSearch.js` · `api/dashboard.api.js`

**Key rules**
- Aggregates scoped to company employee IDs.
- Search currently returns **employees + announcements** (employee role: announcements only).

---

## 3. Employees

**Purpose:** Company directory, profiles, create/import, salary & documents attachment points.

**Who**
- View directory: roles with `employees.view`  
- Create / import / edit / delete / deactivate: HR/Admin  

**Working logic**

1. Directory `/employees` → `GET /api/employees/all` (excludes `role=admin`).
2. Add wizard `/employees/new` → `POST /api/employees/create` → auto `employee_code` per company → welcome email.
3. Profile `/employees/:id` (UUID or employee code) → tabs (including documents).
4. Edit / deactivate / delete via update endpoints.
5. Bulk import `/employees/import` (frontend loops create).
6. Team list: `GET /api/employees/team/:managerId`.

**Backend:** `employee.routes.js` · `employee.controller.js` · `employeeCode.service.js`  
**Frontend:** `EmployeeList.jsx`, `EmployeeForm.jsx`, `EmployeeProfile.jsx`, `EmployeeImport.jsx` · `hooks/useEmployees.js` · `api/employees.api.js`

**Key rules**
- Strict company isolation.
- Lookup by UUID **or** `employee_code` within company.
- Admins hidden from directory listing.

**Entities:** `employees` (manager self-FK)

---

## 4. Attendance (+ WFH, shifts, office IP)

**Purpose:** Daily check-in/out, team views, WFH approvals, shifts, regularization.

**Who**
- Check-in/out / my attendance: employee-class  
- Team / all: Manager+ / HR-Admin  
- WFH approvals: Manager+  
- Manual entry: HR/Admin  

**Working logic**

1. **Check-in**  
   Resolve mode (`office` / `wfh` / `hybrid`) → office IP enforced unless WFH mode, approved daily WFH, or HR/Admin → insert `attendance` (status `wfh` or `present`). One check-in per IST day.

2. **Check-out**  
   Compute hours / OT / status; optional half-day-before-goal setting for payroll.

3. **Daily WFH request**  
   Create `wfh_day_requests` → notify manager/HR → approve → unlock WFH check-in for that date.

4. **Team / All attendance** pages with filters.

5. **Shifts**  
   Defined in settings `attendance_config.shifts`; assigned on employee address/shift fields. No separate `shifts` table.

6. **Regularization**  
   Employee raises helpdesk ticket; HR can also use `manual-entry`.

7. **Auto-checkout cron**  
   4:00 AM IST closes open check-ins.

8. **Biometric webhook**  
   By `employee_code` (+ optional `company_id`).

**Backend:** `attendance.routes.js` · `attendance.service.js` · `wfhRequest.service.js` · `ipValidation.middleware.js` · `cron/autoCheckout.cron.js`  
**Frontend:** `MyAttendance.jsx`, `TeamAttendance.jsx`, `WfhApprovals.jsx`, `Regularization.jsx`, `Shifts.jsx` · `api/attendance.api.js`

**Key rules**
- Office IP from `office_cidr` / `office_ip` / `allow_remote_login`.
- Permanent WFH/hybrid skip IP; daily WFH needs approval for office-mode staff.
- Notifications on WFH request/review.

**Entities:** `attendance`, `wfh_day_requests`, `helpdesk_tickets` (regularization), `system_settings`

---

## 5. Leave

**Purpose:** Apply leave, track balances, team calendar, multi-level approvals.

**Who**
- Apply / my leaves / cancel: employee  
- Team / approve-reject: Manager+  
- All leaves: HR/Admin  

**Working logic**

1. Apply `/leave/apply` → validate dates, enabled types, balance → `leaves` = pending → notify manager (else HR).
2. Approvals:
   - **Single-level:** manager or HR finalizes → approved → email + notification.
   - **Two-level:** manager stamps `manager_approved_*` → HR finalizes.
3. Reject with reason → email + notification.
4. Cancel pending/approved (employee).
5. Balance / types / calendar APIs feed the UI.

**Backend:** `leave.routes.js` · `leave.service.js`  
**Frontend:** `MyLeave.jsx`, `ApplyLeave.jsx`, `TeamLeave.jsx`, `LeaveApprovals.jsx` · `api/leaves.api.js`

**Key rules**
- Policy from `leave_policy` / `leave_allocations` / `leave_policy_meta.approval_level`.
- Types: CL, SL, EL, WFH, COMP_OFF, MATERNITY, PATERNITY, UNPAID.
- Balance checked on apply for allocated types.

**Entities:** `leaves`, `leave_balances`, `notifications`, `system_settings`

---

## 6. Payroll / Payslips

**Purpose:** Monthly payroll run, draft/publish payslips, salary sheet, CTC updates.

**Who**
- My payslips / download: employee (own published)  
- Initialize / generate / publish / recalculate: HR/Admin  

**Working logic**

1. **Run Payroll** `/payroll/run`  
   Initialize `payroll_months` → generate drafts for employees (attendance + salary + `payroll_components`) → publish → PDF to storage + notify employee.

2. **My Payslips** `/payroll/me` — list/download published slips.

3. **Salary Sheet** `/payroll/sheet` — HR month view.

4. **Salary Revisions** `/payroll/revisions` — updates employee salary fields via employee API; revision history is **session-local** (no revisions table).

**Backend:** `payroll.routes.js` · `payroll.service.js` · `payslipPdf.service.js`  
**Frontend:** `RunPayroll.jsx`, `MyPayslips.jsx`, `SalarySheet.jsx`, `SalaryRevisions.jsx` · `api/payroll.api.js`

**Key rules**
- Month unique per `(company_id, month, year)`.
- Draft recalculable; published locked.
- Publish uploads PDF, sets `payslip_status=PUBLISHED`, notifies employee.

**Entities:** `payroll_months`, `payroll`, `payroll_components`, storage bucket `payslips`

---

## 7. Reimbursements / Expenses

**Purpose:** Expense claims with receipts and manager → HR approval.

**Who**
- Submit / my claims / delete own pending: employee  
- Team queue: Manager+  
- All claims / final approve: HR/Admin  

**Working logic**

1. Submit claim (+ optional receipt) → amount/receipt rule from `expense_config` → insert `reimbursements` → notify manager/HR.
2. Manager approve → records `manager_approved_*` → notifies HR (**does not finalize**).
3. HR/Admin approve → requires manager step if employee has a manager → `status=approved`.
4. Reject / delete pending own claim.
5. Receipt via signed URL.

**Backend:** `reimbursement.routes.js` · `reimbursement.controller.js`  
**Frontend:** `MyClaims.jsx`, `SubmitClaim.jsx`, `ExpenseApprovals.jsx`, `AllClaims.jsx` · `api/reimbursements.api.js`

**Key rules**
- Receipt required above configurable threshold (default ₹500).
- Two-level when employee has a manager.

**Entities:** `reimbursements`, storage `receipts`, `notifications`

---

## 8. Training / LMS / Courses

**Purpose:** Course catalog, video lessons, enrollments, progress tracking (+ legacy trainings).

**Who**
- Catalog / play / self-enroll / progress: employee  
- Manage courses / enrollments: Manager+ / HR-Admin  

**Working logic**

1. Catalog `/training/catalog` → published courses for company / target departments.
2. Enroll (self or HR bulk) → `course_enrollments`.
3. Player `/training/courses/:id/play` → signed video URL → lesson progress → completion.
4. Enrollments admin: list / archive.
5. Manage: create course, chapters, upload video/thumbnail.
6. Legacy path: create/assign/complete against `trainings` / `employee_trainings`.

**Backend:** `training.routes.js` · `course.service.js` · `course.controller.js` · `training.controller.js`  
**Frontend:** `CourseCatalog.jsx`, `CoursePlayer.jsx`, `MyTrainings.jsx`, `Enrollments.jsx`, `ManageCourses.jsx` · `api/training.api.js`

**Key rules**
- Courses tenant-scoped.
- Video access gated to enrolled users.
- Anti-skip / sequential unlock rules in course progress.

**Entities:** `courses`, `course_chapters`, `course_lessons`, `course_enrollments`, `course_progress`, legacy `trainings`, `employee_trainings`

---

## 9. Announcements

**Purpose:** Company broadcasts with in-app (and optional email) delivery + acknowledgements.

**Who**
- View / acknowledge: roles with `announcements.view`  
- Create / update / delete: HR/Admin  

**Working logic**

1. HR publishes announcement (+ optional attachment) → `company_id` scoped → in-app notifications to matching audience.
2. Email sent if `announcement_config` / per-announcement channels enable email (subject template supported).
3. Users browse `/announcements` (all / active).
4. Acknowledge → `announcement_acknowledgements`.
5. If `requireApproval` is on, non-admin publish may stay inactive until admin activates.

**Backend:** `announcement.routes.js` · `announcement.controller.js`  
**Frontend:** `Announcements.jsx` · `api/announcements.api.js`

**Key rules**
- Audience: `all` | `employees` | `managers` | `hr` (+ optional department).
- Publisher excluded from notifications.

**Entities:** `announcements`, `announcement_acknowledgements`, `notifications`

---

## 10. Holidays

**Purpose:** Yearly holiday calendar used by leave UI.

**Who**
- View: employee-class  
- Create / update / delete: HR/Admin  

**Working logic**

1. `/leave/holidays` → `GET /api/holidays/year/:year`.
2. HR manages public / optional / restricted holidays.
3. Upcoming holidays available for dashboards.

**Backend:** `holiday.routes.js` · `holiday.controller.js`  
**Frontend:** `HolidayCalendar.jsx` · `api/holidays.api.js`

**Entities:** `holidays`

---

## 11. Documents

**Purpose:** Employee document upload, HR verification, secure download (lives on employee profile/wizard — no top-level nav).

**Who**
- Upload own / list mine: employee  
- Upload for others / list all / verify: HR/Admin  

**Working logic**

1. Profile Documents tab or wizard → upload → notifies HR for verification.
2. HR verifies → `is_verified = true`.
3. Download via authenticated endpoint / signed URL.
4. Document types configured in Settings → Employee Document Config.

**Backend:** `document.routes.js` · `document.controller.js`  
**Frontend:** `EmployeeProfile.jsx`, wizard `StepDocuments.jsx` · `api/documents.api.js`

**Entities:** `documents`, storage `documents`

---

## 12. Settings

**Purpose:** Tenant configuration, RBAC, and module policies.

**Who**
- `role_permissions` + `company-profile`: any authenticated user  
- All other settings writes: HR/Admin  

**Backend:** `settings.routes.js` · `settings.controller.js` · `settings.service.js`  
**Frontend:** `Settings.jsx` + `pages/settings/*` · `settingsStore.js` · `api/settings.api.js`

| Section | Working logic |
|---------|----------------|
| **Company Profile** | Save profile JSON; logo uploaded to storage, `logoPath` stored, signed URL for sidebar. |
| **User & Role Management** | Edit `role_permissions` matrix → applies on next refresh for users. |
| **Employee Document Config** | Required document types list. |
| **Attendance Config** | Office IP/CIDR, remote login, shifts, modes. |
| **Leave Policy** | Types/allocations, approval level; apply-to-all balances. |
| **Payroll Settings** | Components, PF/ESI/TDS, working days, half-day rule. |
| **Notifications & Email** | In-app trigger preferences; SMTP is **server `.env` only**. |
| **Recruitment Settings** | Pipeline / careers defaults. |
| **Announcement Settings** | Default channels, email subject template, require approval. |
| **Asset / Expense / Training / Helpdesk** | Module defaults (categories, thresholds, rules). |
| **Integrations** | External hooks UI. |
| **Security** | Password policy (`security_config`). |
| **Data & Backup** | Export / backup preferences UI. |

**Entities:** `system_settings`, `payroll_components`

---

## 13. Notifications

**Purpose:** In-app inbox + unread badge.

**Who:** All authenticated employee-class users.

**Working logic**

1. Topbar drawer loads list + unread count (polling).
2. Mark one / mark all read.
3. Click → navigate via `lib/notificationLinks.js` (legacy link remap supported).

**Producers include:** leave, reimbursement, payroll/payslip, announcement, document, ticket, WFH.

**Backend:** `notification.routes.js` · `notification.service.js`  
**Frontend:** `NotificationDrawer.jsx` · `hooks/useNotifications.js` · `api/notifications.api.js`

**Entities:** `notifications`

---

## 14. Assets

**Purpose:** Inventory, categories, assignment, employee requests.

**Who**
- My assets / submit requests: employee (Admin portal hides these nav items)  
- Inventory / categories / approve requests: HR/Admin  

**Working logic**

1. Employee requests asset → `asset_requests`.
2. HR approves / rejects / fulfills.
3. HR creates assets in categories → assign to employee → return to inventory.
4. My Assets lists `assigned_to = me`.

**Backend:** `assets.routes.js` · `assets.service.js`  
**Frontend:** `MyAssets.jsx`, `AssetInventory.jsx`, `AssetRequests.jsx`, `AssetCategories.jsx` · `api/assets.api.js`

**Key rules:** Company-scoped; statuses `available` | `assigned` | `in-repair` | `retired`.

**Entities:** `assets`, `asset_categories`, `asset_requests`

---

## 15. Performance

**Purpose:** Personal goals, review cycles, manager team reviews.

**Who**
- Goals (own): all authenticated  
- Create cycles: HR/Admin  
- Team reviews open/update: Manager+  

**Working logic**

1. Employee sets goals `/performance/goals`.
2. HR creates cycle `/performance/cycles`.
3. Manager opens reviews for direct reports against active cycle → `performance_reviews` pending.
4. Manager scores/updates → may mark completed.

**Backend:** `performance.routes.js` · `performance.service.js`  
**Frontend:** `MyGoals.jsx`, `TeamReviews.jsx`, `ReviewCycles.jsx` · `api/performance.api.js`

**Entities:** `performance_goals`, `review_cycles`, `performance_reviews`

---

## 16. Recruitment

**Purpose:** Job openings and candidate pipeline.

**Who**
- View jobs/candidates: `recruitment.view`  
- Create jobs / move stage: HR/Admin  
- Interviews / offers: mostly list reads  

**Working logic**

1. Create job → `job_openings`.
2. Candidates list / move stage (Kanban).
3. Interviews / offers pages list existing rows (create APIs limited / list-focused today).

**Backend:** `recruitment.routes.js` · `recruitment.service.js`  
**Frontend:** `JobOpenings.jsx`, `AddJob.jsx`, `Candidates.jsx`, `Interviews.jsx`, `Offers.jsx` · `api/recruitment.api.js`

**Key rules:** Company-scoped; moving stage resets `days_in_stage`.

**Entities:** `job_openings`, `candidates`, `interviews`, `job_offers`

---

## 17. Helpdesk / Knowledge Base

**Purpose:** Support tickets with comments/SLA + knowledge base articles.

**Who**
- Raise / my tickets / comment: employee  
- All tickets / status changes: HR/Admin  
- KB: `helpdesk.view`  

**Working logic**

1. Raise ticket → `helpdesk_tickets` (default SLA ~+48h) → notify HR/Admin.
2. HR updates status / comments → notify raiser; employee comment notifies HR.
3. KB categories/articles (defaults seeded if empty for company).
4. Attendance regularization reuses tickets with structured subject/body.

**Backend:** `helpdesk.routes.js` · `helpdesk.service.js`  
**Frontend:** `MyTickets.jsx`, `RaiseTicket.jsx`, `AllTickets.jsx`, `KnowledgeBase.jsx` · `api/helpdesk.api.js`

**Entities:** `helpdesk_tickets`, `helpdesk_ticket_comments`, `kb_categories`, `kb_articles`

---

## 18. Reports

**Purpose:** Manager team performance rollup (attendance + leave + reimbursement for a month).

**Who:** Manager, HR, Admin (`isManagerOrAbove`).

**Working logic**

1. `GET /api/reports/team-performance?month=&year=` → per direct-report summaries.
2. No dedicated frontend Reports page; API is available for dashboards/tools.

**Backend:** `reports.routes.js` · `reports.controller.js`  
**Frontend:** none dedicated

**Entities (read):** `employees`, `attendance`, `leaves`, `reimbursements`

---

## 19. API prefix quick reference

| Module | Prefix |
|--------|--------|
| Auth | `/api/auth` |
| Dashboard / Search | `/api/dashboard` |
| Employees | `/api/employees` |
| Attendance + WFH | `/api/attendance` |
| Leave | `/api/leaves` |
| Payroll | `/api/payroll` |
| Expenses | `/api/reimbursements` |
| Training / LMS | `/api/training` (+ `/api/trainings`) |
| Announcements | `/api/announcements` |
| Holidays | `/api/holidays` |
| Documents | `/api/documents` |
| Settings | `/api/settings` |
| Notifications | `/api/notifications` |
| Assets | `/api/assets` |
| Performance | `/api/performance` |
| Recruitment | `/api/recruitment` |
| Helpdesk | `/api/helpdesk` |
| Reports | `/api/reports` |

---

## 20. Known asymmetries

| Area | Reality in code |
|------|-----------------|
| Global search UI | Mentions tickets/assets/etc., but backend search returns employees + announcements. |
| Salary revision history | Client-session only; CTC writes go to employee salary fields. |
| Shifts | Settings JSON + employee fields — not a `shifts` table. |
| Recruitment interviews/offers | Mostly list APIs; limited create endpoints. |
| Documents | Full API + profile UI; not a top-level sidebar module. |
| Reports | Backend only; no dedicated Reports page. |

---

*Update this file when module flows change.*
