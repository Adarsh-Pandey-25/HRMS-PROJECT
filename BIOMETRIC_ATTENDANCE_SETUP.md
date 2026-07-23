# Biometric Attendance — Setup & Integration Guide

How to connect your office biometric device to HRMS, handle **multiple punches per day**, and use **first punch = check-in** and **last punch = check-out**.

---

## 1. Goal

| What you want | How it should work |
|---------------|-------------------|
| Office attendance via biometric | Employee scans finger/face at office device |
| Many punches allowed | 20–30 scans per day is OK |
| Final attendance | **First punch** = check-in, **last punch** = check-out |
| Website check-in | Optional — can disable when biometric is live |
| WFH staff | Can still use web check-in if HR approves WFH |

---

## 2. Current HRMS behavior (today)

| Feature | Status |
|---------|--------|
| Website Clock In / Clock Out | Working (`My Attendance` page) |
| One check-in + one check-out per day | Enforced — second punch fails |
| Biometric webhook stub | Exists but **not production-ready** |
| Multi-punch (first/last logic) | **Not implemented** |
| Device API key validation | UI only — backend does not verify yet |
| Office IP check on biometric | **Blocks** biometric today (needs fix) |

**Existing endpoint (stub):**

```
POST /api/attendance/biometric-webhook
```

Requires user login (JWT) today — a physical device cannot use this as-is.

---

## 3. Recommended design (to implement)

Use **two layers**: store every punch, then compute one daily record.

### Layer A — Raw punches (new table: `attendance_punches`)

Every scan from the device is saved. No limit on count.

| Column | Purpose |
|--------|---------|
| `id` | UUID |
| `employee_id` | Linked employee |
| `company_id` | Tenant |
| `punch_time` | Exact time from device (IST) |
| `device_id` | Machine ID (e.g. `GATE-01`) |
| `source` | `biometric` |
| `created_at` | When HRMS received it |

### Layer B — Daily attendance (existing `attendance` table)

Computed from punches for each employee, each IST calendar day:

```
check_in_time  = MIN(punch_time)   ← first punch
check_out_time = MAX(punch_time)   ← last punch
total_hours    = check_out - check_in - break
status         = present / late / half_day / early_departure
```

Recompute:
- **On every new punch** (real-time), or
- **Every 15 minutes** + **end of day** (e.g. 11:55 PM IST)

### Example: 6 punches in one day

| Punch | Time | Used in final record |
|-------|------|----------------------|
| 1 | 09:02 | **Check-in** |
| 2 | 10:15 | Ignored |
| 3 | 12:30 | Ignored |
| 4 | 13:00 | Ignored |
| 5 | 17:45 | Ignored |
| 6 | 18:10 | **Check-out** |

**Result:** Present, 09:02 → 18:10 (~9h 8m)

---

## 4. How to connect office biometric to HRMS (brief)

Most devices **do not** talk to a custom API directly. You need a path from device → your backend.

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│  Office biometric   │     │  Bridge (if needed)   │     │  HRMS backend       │
│  (ZKTeco / eSSL /   │ ──► │  Office PC script or  │ ──► │  POST /biometric-   │
│   Matrix, etc.)     │     │  device HTTP push     │     │  punch              │
└─────────────────────┘     └──────────────────────┘     └─────────────────────┘
                                      │
                                      ▼
                            Save punch → first/last → attendance row
```

### Connection options

| Option | When to use | Difficulty |
|--------|-------------|------------|
| **A. Device HTTP push** | Device firmware supports REST/webhook | Easy |
| **B. Bridge script** | Device only has desktop software / SDK (most common) | Medium |
| **C. CSV import** | Testing or no live API yet | Easy (manual) |

---

## 5. Step-by-step setup

### Step 1 — Know your device

Ask IT or vendor:

1. **Brand & model** (e.g. ZKTeco K40, eSSL F18, Matrix COSEC)
2. **Connection type:** HTTP push, ADMS, TCP, USB, or desktop app only?
3. **Employee ID on device:** user ID, card number, or employee code?
4. **Can it export logs** (CSV/Excel) or push to a URL?

Write this down before wiring HRMS.

---

### Step 2 — Map employees (critical)

HRMS uses `employees.employee_code`. The biometric device must use the **same value** (or you maintain a mapping table).

| HRMS `employee_code` | Biometric user ID | Employee name |
|----------------------|-------------------|---------------|
| EMP001 | 1 | Raju |
| EMP002 | 2 | Priya |

- Mismatch = punches won’t link to anyone.
- After hiring, add the person on **both** HRMS and the biometric device the same day.

---

### Step 3 — Expose HRMS API to the device

The device or bridge must reach your backend.

**Development (ngrok):**

```
https://hazy-quickness-sixfold.ngrok-free.dev/api/attendance/biometric-punch
```

**Production:** use your real domain, e.g.

```
https://hrms.yourcompany.com/api/attendance/biometric-punch
```

Ensure:
- `backend/.env` → `CORS_ORIGINS` includes your frontend URL (if needed)
- Backend is running on port `5000`
- Firewall allows outbound HTTPS from office PC (for bridge option)

---

### Step 4 — Register device in HRMS (Settings)

1. Login as **Admin / HR**
2. Go to **Settings → Attendance**
3. Enable **Biometric Device** method
4. Add device:
   - **Name:** e.g. `Main Gate`
   - **Device ID:** e.g. `GATE-01` (must match what bridge sends)
   - **API Key:** long random secret (share only with bridge/device)
   - **Location:** e.g. `Office entrance`

> **Note:** Device list is saved in attendance settings. Backend validation of device ID + API key is **planned** — implement before production.

---

### Step 5 — Choose how data reaches HRMS

#### Option A — Device sends HTTP directly

If the device supports “push URL” or webhook, configure:

```http
POST /api/attendance/biometric-punch
Content-Type: application/json
X-Device-Id: GATE-01
X-Device-Key: your-api-key-from-settings

{
  "employee_code": "EMP001",
  "timestamp": "2026-07-22T09:02:00+05:30",
  "device_id": "GATE-01",
  "company_id": "optional-uuid-if-multi-tenant"
}
```

#### Option B — Bridge on office PC (most offices)

1. Install device vendor software on a PC that stays on (same LAN as device).
2. Run a small **Node/Python script** that:
   - Reads new punches from device (SDK, log file, or ADMS)
   - POSTs each punch to HRMS URL above
   - Retries on network failure
3. Schedule script every **1–5 minutes** (Task Scheduler on Windows).

**Typical stack:**

| Device brand | Common approach |
|--------------|-----------------|
| ZKTeco | ZKAccess / BioTime + custom push script or ADMS receiver |
| eSSL | eTimeTrackLite export or SDK bridge |
| Matrix COSEC | COSEC software + API bridge |

#### Option C — CSV import (pilot)

1. Export daily punch log from device software.
2. HR uploads CSV in HRMS (feature to add) or run a one-off import script.
3. Backend applies first/last logic per employee per day.

Good for **testing** before live integration.

---

### Step 6 — Test with one employee

1. Create/update employee in HRMS with `employee_code = EMP001`
2. Register same user on biometric with matching ID
3. Punch **5–10 times** in one day
4. In HRMS **My Attendance** or **Team Attendance**, verify:
   - Check-in = earliest punch
   - Check-out = latest punch
   - Hours and status look correct

---

### Step 7 — Go live office-wide

1. Register all employees on biometric (match `employee_code`)
2. Start bridge script or device push 24/7
3. Disable **Web check-in** in Settings if office staff must use biometric only
4. Keep **WFH approval** for remote days
5. HR uses **Manual Entry** / **Regularization** for corrections

---

## 6. Planned API contract (after implementation)

### `POST /api/attendance/biometric-punch`

- **Auth:** `X-Device-Id` + `X-Device-Key` (no employee JWT)
- **Body:**

```json
{
  "employee_code": "EMP001",
  "timestamp": "2026-07-22T09:02:00+05:30",
  "device_id": "GATE-01",
  "company_id": "uuid-optional"
}
```

- **Behavior:**
  1. Validate device credentials
  2. Resolve employee by `employee_code` (+ `company_id` if needed)
  3. Insert row into `attendance_punches`
  4. Recompute today’s `attendance` (first = in, last = out)
  5. Skip office IP check for biometric
  6. Return `{ success: true, checkIn, checkOut, punchCount }`

### Disable website check-in (optional)

In **Settings → Attendance**, turn off **Web Check-in**.  
Employees see attendance history only; clock buttons hidden when biometric-only.

---

## 7. Office network checklist

| Item | Action |
|------|--------|
| Biometric device IP | Static IP on office LAN |
| Office PC (bridge) | Same network as device, always on |
| Internet | Bridge needs HTTPS out to HRMS/ngrok |
| HRMS backend | Running (`npm run dev` or production server) |
| ngrok (dev only) | Tunnel to frontend port `5173`; API via Vite proxy `/api` |
| Employee codes | Synced HRMS ↔ device |

---

## 8. Night shifts & cross-midnight (e.g. 4 PM → 1 AM)

### The problem with “calendar day” only

If you use **only IST midnight → midnight** to group punches:

| Punch | Time | Calendar day |
|-------|------|--------------|
| 1 | Tue 16:00 (4 PM) | Tuesday |
| 2 | Tue 18:30 | Tuesday |
| 3 | Tue 23:00 | Tuesday |
| 4 | Wed 01:00 (1 AM) | **Wednesday** ← wrong day |

**What goes wrong:**

- **Tuesday** record: check-in 4 PM, check-out **11 PM** (last punch *before midnight*) — **missing the real 1 AM checkout**
- **Wednesday** record: check-in **1 AM** looks like a new day — **wrong**

So plain **MIN/MAX per calendar day does not work** for shifts that cross midnight.

---

### Correct rule: use the employee’s **shift window**, not midnight

Each employee has a shift in Settings (e.g. `16:00`–`01:00`).  
Attendance is grouped by **shift date** = the date when the shift **starts**.

For shift **4 PM Tue → 1 AM Wed**, all punches from **4 PM Tue** until **before next shift starts** belong to **Tuesday’s attendance**.

```
Shift window (Night / 16:00–01:00):
┌─────────────────────────────────────────────────────────────┐
│  Tue 16:00 ──────────────────────────────► Wed 01:00       │
│       ↑ first punch = check-in    last punch = check-out ↑  │
│       Attendance DATE = Tuesday (shift start date)          │
└─────────────────────────────────────────────────────────────┘
```

| Punch | Time | Belongs to attendance date |
|-------|------|----------------------------|
| 1 | Tue 16:02 | **Tuesday** (check-in) |
| 2 | Tue 20:15 | Tuesday (ignored in middle) |
| 3 | Tue 23:40 | Tuesday (ignored) |
| 4 | Wed 01:05 | **Tuesday** (check-out) |

**Result:** Tue attendance = 16:02 → 01:05 (~9h), stored on **Tuesday** in the calendar.

---

### How to detect “night shift” (end time &lt; start time)

| Shift | Start | End | Crosses midnight? |
|-------|-------|-----|-------------------|
| General | 09:00 | 18:00 | No |
| Evening | 16:00 | 01:00 | **Yes** (`01:00 < 16:00`) |
| Night | 22:00 | 07:00 | **Yes** |

**Algorithm (to implement):**

1. Load employee shift (`start`, `end`) from `attendance_config.shifts`.
2. If `end >= start` (same day): window = `[date + start, date + end]`.
3. If `end < start` (night): window = `[date + start, date+1 + end]`.
4. Collect all punches inside that window → `check_in = MIN`, `check_out = MAX`.
5. Save attendance with **attendance_date = shift start date** (Tuesday in the example).

**Early-morning punches (e.g. Wed 00:30):**  
Assign to **previous** shift if the employee is on a night shift and the punch is before `end + grace` (e.g. before 02:00).

---

### Late / half-day for night shift

Today the backend uses a **fixed 9:30 AM** rule — shifts in Settings are **not** used for late detection yet.

| What should happen (after implementation) | Example shift 16:00–01:00 |
|-------------------------------------------|---------------------------|
| Late if check-in after | 16:00 + grace (e.g. 16:30) |
| Full day hours | 9 hours (or shift length) |
| Half day | &lt; 4.5 hours worked in window |

Assign each employee the correct shift in **Employees → Shift** (e.g. “Evening Shift 16:00–01:00”).

---

### Auto checkout at 4 AM

Current cron closes open sessions at **4:00 AM IST**. For a **1 AM** shift end that is fine.  
For shifts ending **7 AM**, either extend the cutoff for night shifts or run rollup after shift end + buffer.

---

### Summary for your case (4 PM → 1 AM)

| Question | Answer |
|----------|--------|
| First punch? | Earliest punch in the shift window (e.g. 4:02 PM) |
| Last punch? | Latest punch in the window (e.g. 1:05 AM **next calendar day**) |
| Which day on calendar? | **Day shift started** (Tuesday, not Wednesday) |
| Plain min/max per midnight day? | **No** — breaks night shifts |
| Shifts in Settings used today? | **UI only** — backend must be updated to use shift windows |

---

## 9. Attendance rules (current vs planned)

After first/last times are set inside the **correct shift window**, rules apply:

| Rule | Current (all staff) | Planned (per shift) |
|------|---------------------|---------------------|
| Late | Check-in after **10:00 AM IST** | Check-in after **shift start + grace** |
| Half day | Working hours &lt; 4.5h | Same, within shift window |
| Early departure | 4.5h – 9h | Same |
| Full day | ≥ 9h | Same (or shift duration) |
| Auto checkout cron | **4:00 AM IST** | May need shift-aware cutoff for long night shifts |

---

## 10. What is NOT done yet (development backlog)

Before production biometric use, implement:

| # | Task |
|---|------|
| 1 | New table `attendance_punches` + migration |
| 2 | `POST /api/attendance/biometric-punch` with device API key auth |
| 3 | First/last punch rollup into `attendance` |
| 4 | Bypass office IP for `method: biometric` |
| 5 | Use device `timestamp` (not only server `now()`) |
| 6 | Persist biometric devices in `system_settings` and validate on backend |
| 7 | Optional: hide web Clock In/Out when biometric-only |
| 8 | Optional: CSV import for pilot |
| 9 | Punch sync log / `lastSync` per device in admin UI |
| 10 | **Shift-aware punch grouping** for night shifts (4 PM–1 AM, 10 PM–7 AM) |
| 11 | **Late detection from employee shift**, not fixed 9:30 AM |

---

## 11. Quick reference — connect in 5 minutes (dev test)

1. Start backend + frontend + ngrok (see `SETUP_HANDOFF.md`).
2. Note URL: `https://hazy-quickness-sixfold.ngrok-free.dev`
3. Use Postman or curl to simulate a device punch (after endpoint is implemented):

```bash
curl -X POST "https://hazy-quickness-sixfold.ngrok-free.dev/api/attendance/biometric-punch" \
  -H "Content-Type: application/json" \
  -H "X-Device-Id: GATE-01" \
  -H "X-Device-Key: your-secret-key" \
  -H "ngrok-skip-browser-warning: true" \
  -d "{\"employee_code\":\"EMP001\",\"timestamp\":\"2026-07-22T09:02:00+05:30\",\"device_id\":\"GATE-01\"}"
```

4. Send 3–5 punches with different timestamps for the same `employee_code`.
5. Confirm attendance shows first time as in, last time as out.

---

## 12. Info to share when requesting implementation

Provide:

1. Biometric **brand and model**
2. **Push vs bridge** — does device support HTTP, or only desktop software?
3. **Biometric-only** or **biometric + WFH web** for hybrid staff?
4. **Real-time** (each punch updates HRMS) or **end-of-day batch**?

---

## Related docs

| File | Contents |
|------|----------|
| `MODULE_LOGIC.md` | Attendance module business rules |
| `API_REFERENCE.md` | Current attendance API routes |
| `SECURITY.md` | Webhook auth concerns |
| `SETUP_HANDOFF.md` | `.env`, ngrok, local run |
