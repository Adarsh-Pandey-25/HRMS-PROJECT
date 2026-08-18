# Local Setup Handoff — Files Git Does NOT Send

Use this when sharing the project with a coworker. Git already ignores secrets and generated folders. Your coworker gets the code from Git, then you give them a few files/credentials privately.

---

## 1. Must share privately (Git will never push these)

These are **gitignored** on purpose (see `.gitignore`: `**/.env`).

| File | Why needed | How to share |
|------|------------|--------------|
| **`backend/.env`** | Supabase keys, JWT secrets, SMTP, CORS, office IP — backend will not start without this | Copy privately (chat/USB/password manager). **Do not commit.** |
| **`HRMS/.env`** | Optional. Usually `VITE_API_URL=` empty (uses Vite proxy) | Can recreate; sharing is optional |

### What your coworker should do

```bash
# After git clone — use real .env files (gitignored, share privately)
# backend/.env  — required
# HRMS/.env     — optional; VITE_API_URL= for local proxy
```

Or you send them your real `backend/.env` (recommended if you share the **same** Supabase project).

---

## 2. Do NOT share (they regenerate themselves)

| Path | Why ignored |
|------|-------------|
| `**/node_modules/` | Run `npm install` in `backend/` and `HRMS/` |
| `**/dist/` | Frontend build output |
| `**/logs/` | Backend log files |
| `**/coverage/` | Test coverage |
| `**/uploads/` | Local uploads (if any) |
| `backend/supabase/.temp/` | Supabase CLI temp |
| `backend/proj.json` | Local/project junk (ignored) |

---

## 3. Keys that must be filled in `backend/.env`

Your coworker needs real values for at least:

| Key | Purpose |
|-----|---------|
| `SUPABASE_URL` | Database / storage project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_KEY` | Server-side key (secret) |
| `JWT_SECRET` | Access token signing |
| `JWT_REFRESH_SECRET` | Refresh token signing |
| `FRONTEND_URL` | Usually `http://localhost:5173` |
| `CORS_ORIGINS` | Usually `http://localhost:5173` |
| `SMTP_*` | Optional for email; without SMTP, emails are mocked/logged |
| `COOKIE_SECURE` | `false` on localhost HTTP |
| `HOST` / `PORT` | Usually `127.0.0.1` / `5000` |

Non-secret defaults (office IP, rate limits, TZ) can stay as in `backend/.env`.

---

## 5. Not a file — but they also need this access

| Item | Notes |
|------|--------|
| **Same Supabase project** (or their own) | If same DB: share `.env` keys. If their own: they create a project and run SQL migrations under `backend/supabase/`. |
| **Storage buckets** | documents, receipts, payslips, course-videos, training-materials, profile-pictures (as used by the app) |
| **Node.js + npm** | Install deps locally |

---

## 6. Files that are NOT ignored but also NOT committed yet

These show as `??` (untracked). They are **source/docs**, not secrets — **commit them to Git** instead of sending privately:

- `API_REFERENCE.md`
- `SECURITY.md`
- `MODULE_LOGIC.md`
- `backend/supabase/migrations/*.sql` (SaaS / employee_code / enrollment archive)
- Other new backend services/scripts if still untracked

If you only push an old commit, your coworker will miss those.

---

## 7. Quick “run on localhost” checklist for coworker

1. `git clone` + checkout your branch  
2. Receive **`backend/.env`** from you (private)  
3. Create `HRMS/.env` with `VITE_API_URL=` (empty)  
4. `cd backend && npm install && npm run dev` (or `node src/server.js`)  
5. `cd HRMS && npm install && npm run dev`  
6. Open `http://localhost:5173`  
7. Backend should be on `http://127.0.0.1:5000`

---

## Summary — what you personally must send

| Send privately | Do not send | Put in Git instead |
|----------------|-------------|--------------------|
| `backend/.env` | `node_modules/`, `dist/`, `logs/` | Migrations, docs, source code |
| Supabase access notes (if needed) | Real passwords in chat if avoidable — prefer secure channel | — |

**Bottom line:** The only important file Git will not send is **`backend/.env`**. Everything else is either regenerable (`npm install`) or should be committed to the repo.
