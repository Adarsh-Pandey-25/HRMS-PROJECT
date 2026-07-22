# HRMS API Reference

Complete inventory of every backend endpoint and every frontend API client function used in this project.

**Base URL**

| Environment | Value |
|-------------|--------|
| Backend | `http://localhost:5000` (default) |
| Frontend axios `baseURL` | `import.meta.env.VITE_API_URL` or `/api` |
| Typical proxy | Frontend calls `/api/...` → backend `/api/...` |

**Auth**

- Most routes require `Authorization: Bearer <access_token>` (and cookies where used).
- Role middleware: `isEmployee`, `isManagerOrAbove`, `isHROrAdmin`, `authorize(role)`.

**Response shape**

```json
{ "success": true, "message": "...", "data": {}, "meta": { "page": 1, "limit": 20, "total": 0 } }
```

**Multipart upload fields**

| Field | Used by |
|-------|---------|
| `receipt` | Reimbursement submit |
| `file` | Document upload |
| `logo` | Company logo |
| `attachment` | Announcement create |
| `thumbnail` | Course create/update |
| `video` | Lesson video upload |
| `materials` | Legacy training create |

---

## Table of contents

1. [App-level](#1-app-level)
2. [Auth](#2-auth--apiauth)
3. [Attendance](#3-attendance--apiattendance)
4. [Leaves](#4-leaves--apileaves)
5. [Payroll](#5-payroll--apipayroll)
6. [Reimbursements](#6-reimbursements--apireimbursements)
7. [Training / LMS](#7-training--lms--apitraining)
8. [Announcements](#8-announcements--apiannouncements)
9. [Holidays](#9-holidays--apiholidays)
10. [Documents](#10-documents--apidocuments)
11. [Employees](#11-employees--apiemployees)
12. [Settings](#12-settings--apisettings)
13. [Reports](#13-reports--apireports)
14. [Notifications](#14-notifications--apinotifications)
15. [Dashboard](#15-dashboard--apidashboard)
16. [Assets](#16-assets--apiassets)
17. [Performance](#17-performance--apiperformance)
18. [Recruitment](#18-recruitment--apirecruitment)
19. [Helpdesk](#19-helpdesk--apihelpdesk)
20. [Frontend API clients](#20-frontend-api-clients)
21. [Counts](#21-counts)

---

## 1. App-level

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Public | API root |
| GET | `/health` | Public | Health check |

---

## 2. Auth — `/api/auth`

| Method | Path | Auth / roles | Description | Frontend |
|--------|------|--------------|-------------|----------|
| POST | `/api/auth/register` | Auth + HR/Admin | Register user | — |
| POST | `/api/auth/login` | Public (rate-limited) | Login | `loginApi` |
| POST | `/api/auth/onboarding/send-otp` | Public (rate-limited) | Send onboarding OTP | `sendOnboardingOtpApi` |
| POST | `/api/auth/onboarding/verify-otp` | Public (rate-limited) | Verify onboarding OTP | `verifyOnboardingOtpApi` |
| POST | `/api/auth/bootstrap-admin` | Public (rate-limited) | Bootstrap first company admin | `bootstrapAdminApi` |
| POST | `/api/auth/logout` | Auth | Logout | `logoutApi` |
| POST | `/api/auth/refresh-token` | Public (rate-limited) | Refresh access token | — |
| GET | `/api/auth/me` | Auth | Current user | `fetchMeApi` |
| PUT | `/api/auth/change-password` | Auth | Change password | — |
| POST | `/api/auth/forgot-password` | Public (rate-limited) | Forgot password | `forgotPasswordApi` |
| POST | `/api/auth/reset-password` | Public (rate-limited) | Reset password with OTP | `resetPasswordApi` |

---

## 3. Attendance — `/api/attendance`

All routes require authentication.

| Method | Path | Roles | Description | Frontend |
|--------|------|-------|-------------|----------|
| POST | `/api/attendance/check-in` | Employee+ | Check in | `checkInApi` |
| POST | `/api/attendance/check-out` | Employee+ | Check out | `checkOutApi` |
| GET | `/api/attendance/check-context` | Employee+ | Check-in context | `fetchCheckContextApi` |
| POST | `/api/attendance/biometric-webhook` | Auth | Biometric webhook | — |
| GET | `/api/attendance/my-attendance` | Employee+ | My attendance | `fetchMyAttendanceApi` |
| GET | `/api/attendance/team-attendance` | Manager+ | Team attendance | `fetchTeamAttendanceApi` |
| GET | `/api/attendance/all-attendance` | HR/Admin | All attendance | `fetchAllAttendanceApi` |
| GET | `/api/attendance/report/:employeeId` | Auth | Employee report | `fetchEmployeeAttendanceReportApi` |
| PUT | `/api/attendance/manual-entry` | HR/Admin | Manual entry | `manualAttendanceEntryApi` |
| GET | `/api/attendance/monthly-summary` | Employee+ | Monthly summary | `fetchMonthlySummaryApi` |
| POST | `/api/attendance/wfh-requests` | Employee+ | Request WFH | `requestWfhDayApi` |
| GET | `/api/attendance/wfh-requests/mine` | Employee+ | My WFH requests | `fetchMyWfhRequestsApi` |
| DELETE | `/api/attendance/wfh-requests/:id` | Employee+ | Cancel WFH | `cancelWfhDayApi` |
| GET | `/api/attendance/wfh-requests/pending` | Manager+ | Pending WFH | `fetchPendingWfhRequestsApi` |
| PUT | `/api/attendance/wfh-requests/:id/review` | Manager+ | Review WFH | `reviewWfhRequestApi` |

---

## 4. Leaves — `/api/leaves`

All routes require authentication.

| Method | Path | Roles | Description | Frontend |
|--------|------|-------|-------------|----------|
| POST | `/api/leaves/apply` | Employee+ | Apply leave | `applyLeaveApi` |
| GET | `/api/leaves/my-leaves` | Employee+ | My leaves | `fetchMyLeavesApi` |
| GET | `/api/leaves/team-leaves` | Manager+ | Team leaves | `fetchTeamLeavesApi` |
| GET | `/api/leaves/all-leaves` | HR/Admin | All leaves | `fetchAllLeavesApi` |
| PUT | `/api/leaves/:id/approve` | Manager+ | Approve leave | `approveLeaveApi` |
| PUT | `/api/leaves/:id/reject` | Manager+ | Reject leave | `rejectLeaveApi` |
| DELETE | `/api/leaves/:id/cancel` | Employee+ | Cancel leave | `cancelLeaveApi` |
| GET | `/api/leaves/balance/:employeeId` | Auth | Leave balance | `fetchLeaveBalanceApi` |
| GET | `/api/leaves/types` | Auth | Leave types | `fetchLeaveTypesApi` |
| GET | `/api/leaves/calendar` | Auth | Leave calendar | `fetchLeaveCalendarApi` |

---

## 5. Payroll — `/api/payroll`

All routes require authentication.

| Method | Path | Roles | Description | Frontend |
|--------|------|-------|-------------|----------|
| POST | `/api/payroll/months` | HR/Admin | Initialize payroll month | `initializePayrollMonthApi` |
| GET | `/api/payroll/months` | Employee+ | Month status | `fetchPayrollMonthApi` |
| POST | `/api/payroll/payslips/generate` | HR/Admin | Generate payslips | `generatePayslipsApi` |
| POST | `/api/payroll/payslips/recalculate-from-settings` | HR/Admin | Recalculate from settings | `recalculatePayslipsFromSettingsApi` |
| PUT | `/api/payroll/payslips/:id/publish` | HR/Admin | Publish payslip | `publishPayslipApi` |
| GET | `/api/payroll/payslips` | Employee+ | List payslips | `fetchPayslipsApi`, `fetchAllPayslipsForYearApi` |
| GET | `/api/payroll/payslips/:id/download` | Auth | Download payslip PDF | `downloadPayslipApi`, `payslipDownloadUrl` |

---

## 6. Reimbursements — `/api/reimbursements`

All routes require authentication.

| Method | Path | Roles | Description | Upload | Frontend |
|--------|------|-------|-------------|--------|----------|
| POST | `/api/reimbursements/submit` | Employee+ | Submit claim | `receipt` | `submitReimbursementApi` |
| GET | `/api/reimbursements/my-reimbursements` | Employee+ | My claims | | `fetchMyReimbursementsApi` |
| GET | `/api/reimbursements/team-reimbursements` | Manager+ | Team claims | | `fetchTeamReimbursementsApi` |
| GET | `/api/reimbursements/all-reimbursements` | HR/Admin | All claims | | `fetchAllReimbursementsApi` |
| GET | `/api/reimbursements/:id/receipt` | Employee+ | Receipt signed URL | | `openReceiptApi` |
| PUT | `/api/reimbursements/:id/approve` | Manager+ | Approve | | `approveReimbursementApi` |
| PUT | `/api/reimbursements/:id/reject` | Manager+ | Reject | | `rejectReimbursementApi` |
| DELETE | `/api/reimbursements/:id` | Employee+ | Delete claim | | `deleteReimbursementApi` |

---

## 7. Training / LMS — `/api/training`

Also mounted at **`/api/trainings`** (same router). All routes require authentication.

### LMS / courses

| Method | Path | Roles | Description | Upload | Frontend |
|--------|------|-------|-------------|--------|----------|
| GET | `/api/training/departments` | Manager+ | Departments | | — |
| GET | `/api/training/progress-report` | Manager+ | Progress report | | `fetchTrainingProgressReportApi` |
| GET | `/api/training/catalog` | Employee+ | Course catalog | | `fetchEmployeeCoursesApi` |
| GET | `/api/training/enrollments` | HR/Admin | List enrollments | | `fetchEnrollmentsApi` |
| POST | `/api/training/enrollments` | HR/Admin | Create enrollments | | `createEnrollmentsApi` |
| PUT | `/api/training/enrollments/:id/archive` | HR/Admin | Archive enrollment | | `archiveEnrollmentApi` |
| POST | `/api/training/enrollments/:id/archive` | HR/Admin | Archive (POST alias) | | — |
| POST | `/api/training/courses` | Manager+ | Create course | `thumbnail` | `createCourseApi` |
| GET | `/api/training/courses/manage` | Manager+ | Manage courses list | | `fetchManageCoursesApi` |
| GET | `/api/training/courses/manage/:id` | Manager+ | Manage course detail | | `fetchManageCourseApi` |
| PUT | `/api/training/courses/:id` | Manager+ | Update course | `thumbnail` | `updateCourseApi` |
| DELETE | `/api/training/courses/:id` | Manager+ | Delete course | | `deleteCourseApi` |
| POST | `/api/training/courses/:id/lessons` | Manager+ | Add lesson to course | `video` | `addCourseLessonApi` |
| POST | `/api/training/courses/:id/chapters` | Manager+ | Add chapter | | — |
| POST | `/api/training/courses/:id/enroll` | Employee+ | Self-enroll | | `enrollCourseApi` |
| GET | `/api/training/courses` | Employee+ | Employee courses | | — |
| GET | `/api/training/courses/:id` | Employee+ | Course detail | | `fetchCourseDetailApi` |
| POST | `/api/training/chapters/:id/lessons` | Manager+ | Add lesson to chapter | `video` | — |
| POST | `/api/training/lessons/:id/progress` | Employee+ | Lesson progress | | `updateLessonProgressApi` |
| GET | `/api/training/lessons/:id/video-url` | Employee+ | Signed video URL | | `fetchLessonVideoUrlApi` |

### Legacy training

| Method | Path | Roles | Description | Upload | Frontend |
|--------|------|-------|-------------|--------|----------|
| POST | `/api/training/create` | HR/Admin | Create training | `materials` | — |
| GET | `/api/training/all-trainings` | Auth | All trainings | | `fetchAllTrainingsApi` |
| GET | `/api/training/my-trainings` | Employee+ | My trainings | | `fetchMyTrainingsApi` |
| POST | `/api/training/assign` | Manager+ | Assign training | | `assignTrainingApi` |
| PUT | `/api/training/:id/complete` | Employee+ | Complete training | | — |
| GET | `/api/training/:id/participants` | Auth | Participants | | `fetchTrainingParticipantsApi` |
| DELETE | `/api/training/:id` | HR/Admin | Delete training | | — |

---

## 8. Announcements — `/api/announcements`

All routes require authentication.

| Method | Path | Roles | Description | Upload | Frontend |
|--------|------|-------|-------------|--------|----------|
| POST | `/api/announcements/create` | HR/Admin | Create | `attachment` | `createAnnouncementApi` |
| GET | `/api/announcements/all` | Auth | All announcements | | `fetchAllAnnouncementsApi` |
| GET | `/api/announcements/active` | Employee+ | Active feed | | `fetchActiveAnnouncementsApi` |
| PUT | `/api/announcements/:id/update` | HR/Admin | Update | | `updateAnnouncementApi` |
| DELETE | `/api/announcements/:id` | HR/Admin | Delete | | `deleteAnnouncementApi` |
| POST | `/api/announcements/:id/acknowledge` | Employee+ | Acknowledge | | `acknowledgeAnnouncementApi` |

---

## 9. Holidays — `/api/holidays`

All routes require authentication.

| Method | Path | Roles | Description | Frontend |
|--------|------|-------|-------------|----------|
| POST | `/api/holidays/create` | HR/Admin | Create holiday | `createHolidayApi` |
| GET | `/api/holidays/year/:year` | Employee+ | By year | `fetchHolidaysByYearApi` |
| PUT | `/api/holidays/:id/update` | HR/Admin | Update | — |
| DELETE | `/api/holidays/:id` | HR/Admin | Delete | `deleteHolidayApi` |
| GET | `/api/holidays/upcoming` | Employee+ | Upcoming | `fetchUpcomingHolidaysApi` |

---

## 10. Documents — `/api/documents`

All routes require authentication.

| Method | Path | Roles | Description | Upload | Frontend |
|--------|------|-------|-------------|--------|----------|
| POST | `/api/documents/upload` | Employee+ | Upload | `file` | `uploadDocumentApi` |
| GET | `/api/documents/my-documents` | Employee+ | My documents | | `fetchMyDocumentsApi` |
| GET | `/api/documents/all` | HR/Admin | All documents | | `fetchAllDocumentsApi` |
| GET | `/api/documents/employee/:employeeId` | Auth | By employee | | `fetchEmployeeDocumentsApi` |
| PUT | `/api/documents/:id/verify` | HR/Admin | Verify | | `verifyDocumentApi` |
| DELETE | `/api/documents/:id` | Auth | Delete | | `deleteDocumentApi` |
| GET | `/api/documents/:id/download` | Auth | Download / signed URL | | `openDocumentApi`, `documentDownloadUrl` |

---

## 11. Employees — `/api/employees`

All routes require authentication.

| Method | Path | Roles | Description | Frontend |
|--------|------|-------|-------------|----------|
| POST | `/api/employees/create` | HR/Admin | Create employee | `createEmployeeApi` |
| GET | `/api/employees/all` | HR/Admin | List all | `fetchAllEmployeesApi` |
| GET | `/api/employees/team/:managerId` | Manager+ | Team members | `fetchTeamEmployeesApi` |
| GET | `/api/employees/:id` | Auth | Get by id | `fetchEmployeeByIdApi` |
| PUT | `/api/employees/:id/update` | Auth | Update | `updateEmployeeApi` |
| DELETE | `/api/employees/:id` | HR/Admin | Delete | `deleteEmployeeApi` |
| PUT | `/api/employees/:id/deactivate` | HR/Admin | Deactivate | `deactivateEmployeeApi` |

---

## 12. Settings — `/api/settings`

All routes require authentication. Routes after `company-profile` (except those listed as Auth-only) require **HR/Admin**.

| Method | Path | Roles | Description | Upload | Frontend |
|--------|------|-------|-------------|--------|----------|
| GET | `/api/settings/role_permissions` | Auth | Role permissions matrix | | `fetchRolePermissionsApi` |
| GET | `/api/settings/company-profile` | Auth | Company profile (+ logo URL) | | `fetchCompanyProfileApi` |
| POST | `/api/settings/company-logo` | HR/Admin | Upload company logo | `logo` | `uploadCompanyLogoApi` |
| GET | `/api/settings/` | HR/Admin | All settings | | `fetchAllSettingsApi` |
| GET | `/api/settings/payroll-components` | HR/Admin | Payroll components | | `fetchPayrollComponentsApi` |
| POST | `/api/settings/payroll-components` | HR/Admin | Create component | | `createPayrollComponentApi` |
| PUT | `/api/settings/payroll-components/:id` | HR/Admin | Update component | | `updatePayrollComponentApi` |
| DELETE | `/api/settings/payroll-components/:id` | HR/Admin | Delete component | | `deletePayrollComponentApi` |
| GET | `/api/settings/leave-allocations` | HR/Admin | Leave allocations | | `fetchLeaveAllocationsApi` |
| PUT | `/api/settings/leave-allocations` | HR/Admin | Update allocations | | `updateLeaveAllocationsApi` |
| POST | `/api/settings/leave-allocations/apply` | HR/Admin | Apply allocations | | — |
| GET | `/api/settings/leave-policy` | HR/Admin | Leave policy | | `fetchLeavePolicyApi` |
| PUT | `/api/settings/leave-policy` | HR/Admin | Update policy | | `updateLeavePolicyApi` |
| POST | `/api/settings/leave-policy/apply` | HR/Admin | Apply policy | | `applyLeavePolicyApi` |
| GET | `/api/settings/:key` | HR/Admin | Get setting by key | | `fetchSettingApi` |
| PUT | `/api/settings/:key` | HR/Admin | Update setting by key | | `updateSettingApi` |

### Common setting keys (`PUT /api/settings/:key`)

| Key | Used for |
|-----|----------|
| `company_profile` | Company name, branding, address, logoPath |
| `role_permissions` | RBAC matrix |
| `attendance_config` | Shifts, geo, new-joiner training flags |
| `training_config` | Training rules |
| `announcement_config` | Channels, email subject, approval |
| `expense_config` | Expense categories / approval |
| `asset_config` | Asset categories / depreciation |
| `helpdesk_config` | Categories / SLA |
| `recruitment_config` | Pipeline / careers |
| `security_config` | Password / session policy |
| `backup_config` | Backup preferences |
| `integrations_config` | Slack / webhooks |
| `payroll_config` | PF, PT, TDS, ESI, components |
| `payroll_working_days` | Working days/month |
| `payroll_pf_rate` | PF rate |
| `payroll_professional_tax` | PT amount |
| `payroll_tds_percent` | TDS % |
| `document_types` | Document type list |
| `leave_policy_meta` | Leave policy metadata |
| `office_cidr` / `office_ip` | Office network |
| `allow_remote_login` | Remote check-in |

---

## 13. Reports — `/api/reports`

| Method | Path | Roles | Description | Frontend |
|--------|------|-------|-------------|----------|
| GET | `/api/reports/team-performance` | Manager+ | Team performance report | — |

---

## 14. Notifications — `/api/notifications`

All routes require authentication + employee-capable role.

| Method | Path | Description | Frontend |
|--------|------|-------------|----------|
| GET | `/api/notifications/` | List my notifications | `fetchNotificationsApi` |
| GET | `/api/notifications/unread-count` | Unread count | `fetchUnreadCountApi` |
| PUT | `/api/notifications/read-all` | Mark all read | `markAllNotificationsReadApi` |
| PUT | `/api/notifications/:id/read` | Mark one read | `markNotificationReadApi` |

---

## 15. Dashboard — `/api/dashboard`

All routes require authentication.

| Method | Path | Roles | Description | Frontend |
|--------|------|-------|-------------|----------|
| GET | `/api/dashboard/admin` | HR/Admin | Admin dashboard | `fetchDashboardApi` (admin) |
| GET | `/api/dashboard/hr` | HR/Admin | HR dashboard | `fetchDashboardApi` (hr) |
| GET | `/api/dashboard/manager` | Manager | Manager dashboard | `fetchDashboardApi` (manager) |
| GET | `/api/dashboard/employee` | Employee | Employee dashboard | `fetchDashboardApi`, `fetchEmployeeDashboardAttendance` |
| GET | `/api/dashboard/search` | Auth | Global search (`?q=`) | `globalSearchApi` |

---

## 16. Assets — `/api/assets`

All routes require authentication.

| Method | Path | Roles | Description | Frontend |
|--------|------|-------|-------------|----------|
| GET | `/api/assets/` | Auth | List assets | `fetchAssetsApi` |
| GET | `/api/assets/mine` | Auth | My assets | `fetchMyAssetsApi` |
| GET | `/api/assets/categories` | Auth | Categories | `fetchAssetCategoriesApi` |
| GET | `/api/assets/requests` | Auth | Requests | `fetchAssetRequestsApi` |
| POST | `/api/assets/requests` | Auth | Submit request | `submitAssetRequestApi` |
| PUT | `/api/assets/requests/:id` | HR/Admin | Act on request | `updateAssetRequestApi` |
| POST | `/api/assets/categories` | HR/Admin | Create category | `createAssetCategoryApi` |
| POST | `/api/assets/` | HR/Admin | Create asset | `createAssetApi` |
| PUT | `/api/assets/:id/assign` | HR/Admin | Assign | `assignAssetApi` |
| PUT | `/api/assets/:id/return` | HR/Admin | Return | `returnAssetApi` |
| PUT | `/api/assets/:id` | HR/Admin | Update asset | `updateAssetApi` |

---

## 17. Performance — `/api/performance`

All routes require authentication.

| Method | Path | Roles | Description | Frontend |
|--------|------|-------|-------------|----------|
| GET | `/api/performance/goals` | Auth | My goals | `fetchMyGoalsApi` |
| POST | `/api/performance/goals` | Auth | Create goal | `createGoalApi` |
| PUT | `/api/performance/goals/:id` | Auth | Update goal | `updateGoalApi` |
| GET | `/api/performance/cycles` | Auth | Review cycles | `fetchReviewCyclesApi` |
| POST | `/api/performance/cycles` | HR/Admin | Create cycle | `createReviewCycleApi` |
| GET | `/api/performance/team-reviews` | Manager+ | Team reviews | `fetchTeamReviewsApi` |
| POST | `/api/performance/team-reviews/open` | Manager+ | Open reviews | `openTeamReviewsApi` |
| PUT | `/api/performance/reviews/:id` | Manager+ | Update review | `updateReviewApi` |

---

## 18. Recruitment — `/api/recruitment`

All routes require authentication.

| Method | Path | Roles | Description | Frontend |
|--------|------|-------|-------------|----------|
| GET | `/api/recruitment/jobs` | Auth | List jobs | `fetchJobsApi` |
| POST | `/api/recruitment/jobs` | HR/Admin | Create job | `createJobApi` |
| GET | `/api/recruitment/candidates` | Auth | Candidates | `fetchCandidatesApi` |
| PUT | `/api/recruitment/candidates/:id/stage` | HR/Admin | Move stage | `moveCandidateApi` |
| GET | `/api/recruitment/interviews` | Auth | Interviews | `fetchInterviewsApi` |
| GET | `/api/recruitment/offers` | Auth | Offers | `fetchOffersApi` |

---

## 19. Helpdesk — `/api/helpdesk`

All routes require authentication.

| Method | Path | Roles | Description | Frontend |
|--------|------|-------|-------------|----------|
| GET | `/api/helpdesk/tickets` | HR/Admin | All tickets | `fetchAllTicketsApi` |
| GET | `/api/helpdesk/my-tickets` | Auth | My tickets | `fetchMyTicketsApi` |
| POST | `/api/helpdesk/tickets` | Auth | Create ticket | `createTicketApi` |
| PUT | `/api/helpdesk/tickets/:id/status` | HR/Admin | Update status | `updateTicketStatusApi` |
| POST | `/api/helpdesk/tickets/:id/comments` | Auth | Add comment | `addTicketCommentApi` |
| GET | `/api/helpdesk/kb/categories` | Auth | KB categories | `fetchKbCategoriesApi` |
| GET | `/api/helpdesk/kb/articles` | Auth | KB articles | `fetchKbArticlesApi` |

---

## 20. Frontend API clients

Source: `HRMS/src/api/`. Base URL: `VITE_API_URL` or `/api`.

| File | Exported API functions |
|------|------------------------|
| `client.js` | `api`, `apiRequest`, `apiRequestPaginated`, `apiUpload`, token helpers |
| `auth.api.js` | `loginApi`, `logoutApi`, `fetchMeApi`, `forgotPasswordApi`, `resetPasswordApi`, `sendOnboardingOtpApi`, `verifyOnboardingOtpApi`, `bootstrapAdminApi` |
| `dashboard.api.js` | `fetchDashboardApi`, `globalSearchApi` |
| `employees.api.js` | `fetchAllEmployeesApi`, `fetchTeamEmployeesApi`, `fetchEmployeeByIdApi`, `createEmployeeApi`, `updateEmployeeApi`, `deleteEmployeeApi`, `deactivateEmployeeApi` |
| `attendance.api.js` | `checkInApi`, `checkOutApi`, `fetchCheckContextApi`, WFH APIs, attendance list/report/manual APIs |
| `leaves.api.js` | apply / list / approve / reject / cancel / balance / types / calendar |
| `payroll.api.js` | months, generate, publish, recalculate, list, download |
| `reimbursements.api.js` | submit / list / approve / reject / delete / open receipt |
| `training.api.js` | catalog, courses CRUD, enrollments, lessons, progress, legacy assign |
| `announcements.api.js` | active / all / create / update / delete / acknowledge |
| `holidays.api.js` | by year / upcoming / create / delete |
| `documents.api.js` | upload / list / verify / delete / open |
| `settings.api.js` | settings CRUD, company profile, logo upload, payroll components, leave policy/allocations |
| `notifications.api.js` | list / unread count / mark read / mark all |
| `assets.api.js` | inventory, mine, requests, categories, assign/return |
| `performance.api.js` | goals, cycles, team reviews |
| `recruitment.api.js` | jobs, candidates, interviews, offers |
| `helpdesk.api.js` | tickets, comments, KB |

---

## 21. Counts

| Area | Count |
|------|------:|
| App-level endpoints | 2 |
| Auth | 11 |
| Attendance | 15 |
| Leaves | 10 |
| Payroll | 7 |
| Reimbursements | 8 |
| Training / LMS (unique under `/api/training`) | 27 |
| Announcements | 6 |
| Holidays | 5 |
| Documents | 7 |
| Employees | 7 |
| Settings | 16 |
| Reports | 1 |
| Notifications | 4 |
| Dashboard | 5 |
| Assets | 11 |
| Performance | 8 |
| Recruitment | 6 |
| Helpdesk | 7 |
| **Backend unique path definitions** | **~163** |
| **With `/api/trainings` alias** | **~190** |
| **Frontend HTTP-calling API exports** | **~145** |

---

## Source files

| Layer | Path |
|-------|------|
| Route mounts | `backend/src/app.js` |
| Route modules | `backend/src/routes/*.routes.js` |
| Frontend clients | `HRMS/src/api/*.js` |

*Generated from the current codebase. When you add or remove routes, update this file.*
