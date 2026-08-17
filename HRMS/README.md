# SPAXADS HRMS

A modern, full-featured **Human Resource Management System** built with React 18 + Vite. Soft purple/violet theme, card-based layout, light & dark modes, and 10 core modules covering the full employee lifecycle.

![Stack](https://img.shields.io/badge/React-18-6C63FF) ![Vite](https://img.shields.io/badge/Vite-8-646CFF) ![Tailwind](https://img.shields.io/badge/Tailwind-3-38BDF8)

## Getting started

```bash
npm install
npm run dev      # start dev server → http://localhost:5173
npm run build    # production build → dist/
npm run preview  # preview the production build
```

## Modules

| # | Module | Route | Highlights |
|---|--------|-------|------------|
| 1 | Employee Management | `/employees` | Directory (grid/table), rich profile with 8 tabs, 5-step add/edit wizard |
| 2 | Attendance | `/attendance` | Clock in/out, colour-coded month calendar, team view, analytics |
| 3 | Leave | `/leave` | Balance cards, apply modal, approval workflow, holidays, policies |
| 4 | Payroll | `/payroll` | Cost dashboard, 4-step run wizard, salary sheet, payslip viewer |
| 5 | Recruitment | `/recruitment` | Jobs board, drag-and-drop ATS Kanban, interviews, offers |
| 6 | Performance | `/performance` | Goals with progress rings, self-assessment, team reviews, cycles |
| 7 | Training | `/training` | Course catalog, enrolments, certificates, admin management |
| 8 | Assets | `/assets` | Inventory table, my assets, request approvals |
| 9 | Expenses | `/expenses` | Claim submission, approval queue, policy limits |
| 10 | Helpdesk | `/helpdesk` | Tickets, SLA tracking, knowledge base, analytics |

Plus a **Dashboard** (`/`) aggregating KPIs, headcount & department charts, attendance, approvals and an activity feed.

## Tech stack

- **React 18 + Vite** · **Tailwind CSS 3** (CSS-variable theming for light/dark)
- **React Router** · **Zustand** (auth, UI, notifications) · **TanStack Query & Table**
- **Recharts** · **Lucide icons** · **React Hook Form + Zod** · **@dnd-kit** (Kanban)
- **date-fns** · **react-hot-toast**

## Key features

- 🎨 **Design system** — semantic colour tokens, reusable UI kit in `src/components/ui`
- 🌙 **Dark mode** — toggle in the top bar, persisted (`Moon`/`Sun`)
- 🔐 **Role-based access** — preview as Admin / HR / Manager / Employee from the profile menu; routes and tabs adapt
- 🔔 **Notifications** — bell drawer grouped by day, unread badges
- ⚡ **Performance** — route-based code splitting, skeleton loaders, debounced search

## Project structure

```
src/
├── components/
│   ├── ui/          # design-system components (Card, Button, Table, Modal…)
│   ├── layout/      # Sidebar, Topbar, RightPanel, AppLayout, drawers
│   ├── charts/      # themed Recharts helpers
│   └── shared/      # AttendanceCalendar, KanbanBoard
├── data/            # mock data (employees, hr, talent, ops, dashboard)
├── store/           # Zustand stores (auth, ui, notifications)
├── lib/             # utils, constants, csv export
└── pages/           # one file per module
```

> The app runs entirely on realistic mock data — no backend required. Swap the modules in `src/data/` for real API calls (via TanStack Query) to connect a server.
