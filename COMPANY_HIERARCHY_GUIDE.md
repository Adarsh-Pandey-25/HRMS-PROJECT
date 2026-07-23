# Parent & Child Company — Concept & Management Guide

How a **parent (holding / group) company** creates and manages **child companies** in this HRMS, built on the existing flat multi-tenant model.

---

## Status (implemented)

Phase 1 of this guide is implemented for **Admin role**:

- Migration: `backend/supabase/migrations/20260723_company_hierarchy.sql`
- APIs: `/api/companies/*` (Admin only)
- UI: **Organizations** module (`/organizations`) — View / Add / Access tabs
- Employee form: **Company** dropdown for Admin when adding/editing employees

**You must run the SQL migration in Supabase** before using the module.

---

## 1. What you already have today

Your project is already **multi-company (SaaS)**, but **flat**:

```
Company A  ←→  Company B  ←→  Company C
     (peers — no parent/child link)
```

| Piece | How it works today |
|-------|-------------------|
| Table `companies` | `id`, `name`, `slug`, `is_active`, `employee_code_seq` |
| Isolation | Almost every module filters by `employees.company_id` |
| Settings | Keys like `t:{companyId}:company_profile` |
| New company | `/welcome` → Onboarding → `POST /api/auth/bootstrap-admin` creates a **new peer** company |
| Login | User belongs to **one** company only |
| Switch company | **Not available** |

**There is no parent/child hierarchy yet** — no `parent_company_id`, no org tree, no group dashboard.

---

## 2. What you want (concept)

```
┌─────────────────────────────────────────┐
│  Parent Company (e.g. Spaxads Group)    │
│  - Owns / manages child workspaces      │
│  - Can see group-level reports (optional)│
└───────────────┬─────────────────────────┘
                │
       ┌────────┴────────┐
       ▼                 ▼
┌─────────────┐   ┌─────────────┐
│ Child Co 1  │   │ Child Co 2  │
│ (Raju Co)   │   │ (Other Pvt) │
│ own HR,     │   │ own HR,     │
│ payroll,    │   │ payroll,    │
│ employees   │   │ employees   │
└─────────────┘   └─────────────┘
```

### Mental model (recommended)

| Layer | Meaning |
|-------|---------|
| **Parent** | Group / holding company — creates children, may view rollup |
| **Child** | Real operating company — full HRMS data of its own |
| **Isolation** | Child data stays separate (attendance, payroll, leaves…) |
| **Link** | Only the hierarchy link + optional shared reporting |

Each child remains a **full tenant** (same as today’s `companies` row). Parent is also a `companies` row, with children pointing to it.

---

## 3. Recommended data model

### 3.1 Extend `companies` table

```sql
ALTER TABLE companies
  ADD COLUMN parent_company_id UUID NULL
    REFERENCES companies(id) ON DELETE RESTRICT,
  ADD COLUMN company_type VARCHAR(20) NOT NULL DEFAULT 'standalone'
    CHECK (company_type IN ('standalone', 'parent', 'child'));
```

| `company_type` | Meaning |
|----------------|---------|
| `standalone` | Current behavior — independent company (default) |
| `parent` | Can create/manage children |
| `child` | Belongs to one parent (`parent_company_id` set) |

**Rules:**

- Child → must have `parent_company_id`
- Parent → `parent_company_id` is NULL
- Standalone → no parent, no children
- Optional: only **1 level** first (parent → child). Avoid grandchild trees until needed.

### 3.2 Keep data isolation

Do **not** mix employees of Child A and Child B in one list by default.

| Data | Scoped to |
|------|-----------|
| Employees, attendance, leave, payroll | **Child company only** |
| Settings, holidays, announcements | **That company only** |
| Parent “group report” | Aggregates **read-only** across child IDs |

### 3.3 Optional later: group membership

If one person (e.g. Group CFO) must access **multiple** companies:

| Approach | Complexity | When |
|----------|------------|------|
| **A. Separate logins** (one email per company) | Low | Start here |
| **B. Membership table** (`user_company_roles`) + company switcher | High | When same person needs many companies |

Today email is **globally unique** on `employees`, so Approach A needs different emails or you redesign uniqueness later.

---

## 4. Roles & who can do what

| Actor | Can do |
|-------|--------|
| **Parent Admin** | Create child company, deactivate child, view list of children, (optional) group dashboard |
| **Child Admin / HR** | Full HRMS for **their child only** (same as today) |
| **Child employee** | Self-service in their child only |
| **Parent employee** (if any) | Only parent’s own roster unless you add switcher |

**Suggested permission:**

```
companies.create_child   → parent admin only
companies.view_children  → parent admin / parent HR
companies.manage_child   → parent admin (activate/deactivate, rename)
```

Child HR cannot create siblings or see other children.

---

## 5. How parent creates a child (product flow)

### Happy path

1. Login as **Parent Admin**
2. Open new module: **Organizations / Companies**
3. Click **Add child company**
4. Fill form:
   - Company name
   - Slug (optional, auto from name)
   - Admin name + email + phone
5. System:
   - Creates `companies` row (`type=child`, `parent_company_id=parent`)
   - Seeds settings (`seedCompanySettings`) for the new company
   - Creates first **Admin** employee in that child
   - Emails temp password / invite (same pattern as bootstrap)
6. Child admin logs in → sees **only** that child’s HRMS

### What parent should **not** do by default

- Edit child payroll runs
- Approve child leaves
- Change child attendance  

Those stay with **child HR**. Parent = ownership + visibility, not day-to-day ops (unless you explicitly want “group HR”).

---

## 6. Module structure (what to build)

### New module: **Organizations** (or **Group Companies**)

| Screen | Purpose |
|--------|---------|
| **Company list** | Parent sees all children (name, status, admin, employee count) |
| **Add child** | Form → create company + first admin |
| **Child detail** | Status, branding link, open “impersonate / switch” later |
| **Group dashboard** (phase 2) | Headcount, attendance %, open tickets across children |

### Backend endpoints (planned)

| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| GET | `/api/companies/me` | Auth | Current company + type + parent info |
| GET | `/api/companies/children` | Parent admin | List child companies |
| POST | `/api/companies/children` | Parent admin | Create child + bootstrap admin |
| PATCH | `/api/companies/children/:id` | Parent admin | Rename / activate / deactivate |
| GET | `/api/companies/children/:id/summary` | Parent admin | Optional KPIs |

### Reuse existing code

| Existing | Reuse for |
|----------|-----------|
| `ensureCompanyRow` | Create child row |
| `seedCompanySettings` | Copy default policies into child |
| `bootstrapAdmin` pattern | Create first admin under child |
| `getCompanyEmployeeIds` | Still per-company; add `getChildCompanyIds(parentId)` for rollups |
| Company profile Settings | Each child keeps its own logo/name |

---

## 7. How to manage day-to-day

### Parent company admin

| Task | How |
|------|-----|
| Add new subsidiary | Organizations → Add child |
| Stop a subsidiary | Deactivate child (`is_active=false`) — block login for that company |
| See headcount | Group dashboard (later) or open child summary |
| Branding | Parent profile ≠ child profile (separate logos OK) |

### Child company admin / HR

| Task | How |
|------|-----|
| Hire, attendance, payroll | Same HRMS screens as today |
| Settings | Own `t:{childId}:*` settings |
| Cannot | See sibling companies or parent’s private employees |

### Employees

- Login → land in **their** company only  
- Biometric / attendance codes stay **per company** (`employee_code` unique per `company_id`)

---

## 8. Settings & policies: inherit or separate?

| Strategy | Pros | Cons |
|----------|------|------|
| **Fully separate** (recommended first) | Simple; child HR independent | Parent must reconfigure each child |
| **Copy-on-create** | Seed from parent’s current settings | Child can diverge later |
| **Live inherit + override** | Central policy | Complex; bugs in payroll/leave |

**Recommendation:** On create child → **copy** parent settings once (`seedCompanySettings` from parent keys). After that, child edits its own settings.

---

## 9. Reporting (parent view)

Start simple:

| Report | Logic |
|--------|-------|
| Children list | `WHERE parent_company_id = :parent` |
| Total employees | `COUNT` employees where `company_id IN (child_ids)` |
| Attendance today | Aggregate open check-ins across child IDs |
| Payroll cost | Sum finalized payroll months per child (read-only) |

Never let parent **mutate** child payroll without an explicit “group HR” role.

---

## 10. Security rules (must enforce)

1. **Child user** cannot query another child’s `company_id`.
2. **Parent** can list children only if `companies.id = parent` and requester’s `company_id` is that parent.
3. Creating a child must set `parent_company_id` from **logged-in parent**, never from client-forged UUID alone (validate server-side).
4. Deactivated child → login rejected (`is_active=false`).
5. Keep using service-role + app filters (same as today); hierarchy does not replace `company_id` checks.

---

## 11. Migration path for your current data

You already have peer companies (e.g. Default + Company 2).

| Step | Action |
|------|--------|
| 1 | Add `parent_company_id`, `company_type` (default `standalone`) |
| 2 | Pick one company as Parent → set `company_type='parent'` |
| 3 | Set other companies to `child` + `parent_company_id` **or** leave as standalone |
| 4 | Build Organizations UI for parent only |
| 5 | New subsidiaries created only via “Add child”, not via public Welcome bootstrap (or restrict bootstrap) |

**Decision:** Should public `/welcome` onboarding still create **standalone** companies, or only Parent Admins create children?

| Mode | Use when |
|------|----------|
| Keep public bootstrap | True SaaS — many unrelated customers |
| Parent-only create | Corporate group — only subsidiaries under one group |

You can support **both**: public = standalone; logged-in parent = child.

---

## 12. Phased delivery (practical)

### Phase 1 — Core hierarchy (MVP)

1. DB columns `parent_company_id`, `company_type`
2. API: list / create / deactivate children
3. UI module: Organizations (parent admin)
4. Create child + first admin + seed settings
5. Child login works as today (isolated)

### Phase 2 — Visibility

1. Child summary cards (headcount, present today)
2. Parent dashboard rollup
3. Link “Open company profile” (read-only)

### Phase 3 — Advanced (optional)

1. Company switcher / multi-membership
2. Shared leave policy inherit
3. Cross-company transfers (move employee child A → B)
4. Consolidated payroll export

---

## 13. Frontend module sketch

```
Sidebar (Parent Admin only)
  └── Organizations
        ├── All companies      (parent + children tree)
        ├── Add child company
        └── [Child name] → summary

Settings (unchanged)
  └── Company Profile         (always = MY company only)
```

Child Admin sidebar: **no** Organizations module.

---

## 14. Example: Spaxads Group

| Company | Type | Parent |
|---------|------|--------|
| Spaxads Digital Media Pvt Ltd | `parent` | — |
| Raju Company | `child` | Spaxads |
| North Branch Ops | `child` | Spaxads |

- Spaxads admin creates Raju Company → Raju HR runs attendance/payroll alone  
- Biometric devices / `employee_code` scoped per child  
- Spaxads dashboard (later): total headcount = Raju + North  

---

## 15. What NOT to do

| Mistake | Why |
|---------|-----|
| Put all employees under parent with a “department = company” | Breaks payroll, settings, biometric isolation |
| Soft-share one `company_id` for group | You already built real multi-tenant — keep it |
| Deep trees (parent → child → grandchild) in v1 | Harder permissions; add later if needed |
| Let child see siblings | Data leak between subsidiaries |

---

## 16. Checklist — how you manage it

1. **Promote / create** one Parent company  
2. Parent Admin opens **Organizations → Add child**  
3. System creates isolated workspace + child Admin  
4. Child Admin configures profile, shifts, biometric, holidays  
5. Child hires employees (codes unique inside that child)  
6. Parent only monitors list / KPIs — does not run daily HR for child  
7. Deactivate child when subsidiary closes  

---

## 17. Info to decide before coding

Answer these so implementation matches your business:

1. **Only 1 group**, or many unrelated SaaS customers too?  
2. Should `/welcome` still create standalone companies?  
3. Parent needs **read-only reports** in v1, or only create/deactivate children?  
4. Same person as admin of parent **and** a child? (separate emails OK?)  
5. Max depth = **1** (parent→child) for now?

---

## Related docs

| File | Relevance |
|------|-----------|
| `backend/supabase/MULTI_TENANT_ROLLOUT.md` | Current flat SaaS model |
| `MODULE_LOGIC.md` | Per-module `company_id` rules |
| `API_REFERENCE.md` | Bootstrap / settings APIs |
| `BIOMETRIC_ATTENDANCE_SETUP.md` | Biometric stays per company |

---

## Bottom line

- Today: **many companies, all equal (flat)**.  
- Goal: **Parent owns children**; each child is still a full isolated HRMS.  
- Manage via a new **Organizations** module: create child, seed settings, first admin, list/deactivate.  
- Keep attendance/payroll/employees **inside the child**.  
- Add group reports later; do not merge databases into one company.
