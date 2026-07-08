# HRMS Backend API

Production-ready Human Resource Management System backend built with **Node.js**, **Express**, and **Supabase (PostgreSQL)**.

## Quick Start

```bash
cd backend
cp .env.example .env
# Edit .env with your Supabase and JWT credentials
npm install
npm run dev
```

Server runs at `http://localhost:5000`

## Your Setup Checklist

### Step 1: Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Note these from **Project Settings → API**:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_KEY` (keep secret — backend only)

### Step 2: Database Schema

1. Open **SQL Editor** in Supabase
2. Paste and run `supabase/schema.sql` (full schema, triggers, RLS)
3. Verify tables under **Table Editor**

### Step 3: Storage Buckets

Create **private** buckets in **Storage**:

| Bucket | Purpose |
|--------|---------|
| `documents` | Employee documents |
| `receipts` | Reimbursement receipts |
| `training-materials` | Training files |
| `profile-pictures` | Profile photos |
| `payslips` | Generated PDF payslips |

Optional: run `supabase/storage-policies.sql` for storage RLS policies.

### Step 4: Environment Variables

Copy `.env.example` to `.env` and set:

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
JWT_SECRET=your-32-char-minimum-secret-key-here
JWT_REFRESH_SECRET=your-32-char-refresh-secret-key
ALLOW_REMOTE_LOGIN=true   # set false in production with office IP
FRONTEND_URL=http://localhost:3000
```

Generate JWT secrets:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 5: Seed Admin User

```bash
node scripts/seed-admin.js
```

Default credentials:
- Email: `admin@company.com`
- Password: `Admin@123456`

**Change the password immediately after first login.**

### Step 6: Run Server

```bash
npm run dev    # development with nodemon
npm start      # production
```

Test: `GET http://localhost:5000/health`

### Step 7: Postman Testing

1. Import `postman/HRMS-API.postman_collection.json`
2. Set collection variable `baseUrl` = `http://localhost:5000`
3. Run **Auth → Login** (saves token automatically)
4. Test other endpoints

For login from non-office IP during development, set `ALLOW_REMOTE_LOGIN=true`.

---

## API Modules

| Module | Base Path | Description |
|--------|-----------|-------------|
| Auth | `/api/auth` | Login, register, JWT, password reset |
| Employees | `/api/employees` | CRUD, team, deactivate |
| Attendance | `/api/attendance` | Check-in/out, reports, auto-checkout |
| Leaves | `/api/leaves` | Apply, approve, balance, calendar |
| Payroll | `/api/payroll` | Generate, payslips, PDF download |
| Reimbursements | `/api/reimbursements` | Submit, approve, receipts |
| Training | `/api/training` | Programs, assignments, completion |
| Announcements | `/api/announcements` | Company announcements |
| Holidays | `/api/holidays` | Holiday calendar |
| Documents | `/api/documents` | Upload, download, verify |

## Roles

| Role | Access |
|------|--------|
| `admin` | System config, users, holidays, all reports |
| `hr` | Employees, attendance, leave, payroll, training |
| `manager` | Team attendance, leaves, reimbursements |
| `employee` | Self-service: attendance, leaves, payslips |

## Security Features

- JWT (24h) + Refresh token (7d) in httpOnly cookies
- bcrypt password hashing (10 rounds)
- Office IP validation (`182.69.179.236/32`)
- Role-based access control (RBAC)
- Rate limiting on all endpoints
- Helmet security headers
- Input validation (express-validator)
- Winston logging with daily rotation

## Auto Check-out Cron

Runs daily at **4:00 AM IST** (`Asia/Kolkata`):
- Auto check-out for forgotten sessions
- Calculates working hours
- Flags `auto_checkout` in remarks
- Sends email notification

## Response Format

**Success:**
```json
{
  "success": true,
  "message": "...",
  "data": {},
  "meta": { "page": 1, "limit": 20, "total": 100 },
  "timestamp": "2026-07-06T12:00:00.000Z"
}
```

**Error:**
```json
{
  "success": false,
  "error": { "code": "BAD_REQUEST", "message": "...", "details": [] },
  "timestamp": "2026-07-06T12:00:00.000Z"
}
```

## SMTP Email (Optional)

Configure in `.env` for notifications:
- Welcome emails
- Leave approval/rejection
- Payslip delivery
- Password reset
- Auto check-out alerts

Without SMTP, emails are logged to console (dev mode).

## Production Notes

1. Set `NODE_ENV=production`
2. Set `ALLOW_REMOTE_LOGIN=false`
3. Use strong JWT secrets (32+ chars)
4. Never expose `SUPABASE_SERVICE_KEY` to frontend
5. Enable HTTPS and secure cookies
6. Configure real SMTP for email notifications
7. Set up log monitoring for `logs/` directory

## Project Structure

```
backend/
├── src/
│   ├── config/          # Supabase, email, app config
│   ├── controllers/     # Request handlers (10 modules)
│   ├── middleware/      # Auth, RBAC, IP, upload, errors
│   ├── routes/          # API route definitions
│   ├── services/        # Business logic
│   ├── utils/           # Helpers, validators, logger
│   ├── cron/            # Auto check-out job
│   ├── app.js
│   └── server.js
├── supabase/
│   ├── schema.sql       # Full database schema
│   └── storage-policies.sql
├── scripts/
│   └── seed-admin.js
├── postman/
│   └── HRMS-API.postman_collection.json
└── logs/                # Auto-created by Winston
```

## License

ISC
