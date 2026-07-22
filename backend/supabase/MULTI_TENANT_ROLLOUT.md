# Multi-Tenant SaaS — Manual Rollout (no API break)

Your HRMS uses **one Supabase database** for all companies. Isolation = `company_id` on rows + settings keys `t:{companyId}:*`.

Default / demo company UUID (do not change):

`00000000-0000-0000-0000-000000000001`

Accounts that stay on default company: `admin@company.com`, `hr1@company.com`, seeded employees.

---

## What you do manually in Supabase (today)

### Before anything
1. Open Supabase → **Project Settings → Database** → take a backup / note project ref.
2. Open **SQL Editor**.

### Phase 1 — companies + employees (required first)
1. Open file: `backend/supabase/migrations/20260720_saas_phase1_companies_employees.sql`
2. Paste into SQL Editor → **Run**.
3. Verify:

```sql
SELECT id, name, slug FROM companies;

SELECT company_id, COUNT(*) FROM employees GROUP BY company_id;

SELECT email, company_id, address->>'company_id' AS address_company
FROM employees
WHERE email IN ('admin@company.com', 'hr1@company.com');
```

Expect: default company row exists; admin/hr1 have `company_id = 00000000-0000-0000-0000-000000000001`.

### Phase 2 — shared tables (required for strict isolation)
1. Open file: `backend/supabase/migrations/20260720_saas_phase2_tenant_columns.sql`
2. Paste → **Run**.
3. If a statement errors because a table doesn’t exist (e.g. `courses`), skip that block — the migration already wraps some in `IF EXISTS`.
4. Verify:

```sql
SELECT company_id, month, year FROM payroll_months ORDER BY year, month;
SELECT company_id, COUNT(*) FROM job_openings GROUP BY company_id;
SELECT company_id, COUNT(*) FROM assets GROUP BY company_id;
```

Expect: existing data sits on the default company UUID.

### Do NOT do yet
- Do **not** enable RLS until every API filters by `company_id` (backend uses service role; RLS alone won’t protect you).
- Do **not** delete bare `system_settings` keys (`leave_policy`, etc.) — default company still falls back to them.

---

## After SQL — keep APIs working

Phase 1+2 alone are **backward compatible** if the backend still:
- Reads `address.company_id` **or** `employees.company_id`
- Dual-writes both on create/update
- Filters lists by company

Until code is updated for Phase 2 tables, some modules (recruitment, courses, payroll months) can still leak — SQL only **prepares** the columns.

### Order of code work (we implement next; APIs keep same URLs)

| Step | Change | API impact |
|------|--------|------------|
| A | Dual-write `employees.company_id` + JSON; `getCompanyEmployeeIds` uses column | None (same responses) |
| B | `payroll_months` / `payroll_components` filter + stamp `company_id` | Same routes; data isolated |
| C | Recruitment / cycles / courses / assets / KB filter + stamp | Same routes; new company sees empty lists |
| D | Announcements / holidays use `company_id` column | Same routes |
| E | Onboarding inserts into `companies` table | Same `/auth/bootstrap-admin` |

Frontend: keep same `/api/...` calls. Only ensure login/me returns `company_id` (already does) and Settings save to current company (already does).

---

## How a new company works (after full code)

1. User opens `/onboarding` → Launch.
2. Backend inserts `companies` row + first admin with that `company_id`.
3. Seeds settings as `t:{newId}:leave_policy` etc.
4. That admin sees **only** their company’s data.
5. Default company (`admin@company.com`) unchanged.

---

## Smoke test after each phase

### After Phase 1 SQL + backend restart
- [ ] Login `admin@company.com` / `SystemAdmin@123`
- [ ] Employees list still shows seeded people
- [ ] Leave / attendance / dashboard still work

### After Phase 2 SQL (columns present)
- [ ] Same login still works
- [ ] No 500s on payroll / employees / settings

### After code Steps A–E
- [ ] Create 2nd company via onboarding (new email)
- [ ] Company B employee list empty
- [ ] Company B does **not** see Company A jobs / courses / assets / KB
- [ ] Both companies can initialize the **same** payroll month
- [ ] Company A leave policy change does not change Company B My Leave totals

---

## Mental model

```
Supabase (1 project)
├── companies
│   ├── Default (…0001)  ← your tested demo data
│   └── Acme / Bon / …   ← each signup
├── employees.company_id → companies.id
├── leaves / attendance / payroll → via employee (and soon direct company_id)
└── system_settings key = t:{companyId}:leave_policy
```

One DB. Many companies. Strict isolation by `company_id`. Same frontend/backend API paths.
