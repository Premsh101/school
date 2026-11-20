# School Management System — project brief for Claude Code

Read this whole file before any work. It is the source of truth for scope, stack,
rules and the order in which modules are built. Keep it up to date: when a module
ships or a decision changes, edit this file in the same commit.

## 1. What we are building

A web app for **Soni Pariya Public School** (Kamalganj, Farrukhabad, Uttar Pradesh),
one school with **several branches** (Kamalganj and Kannauj so far; more can be added). Used daily by the owner/admin, branch
principals, accountants at the fee counter, and teachers, mostly on **phones**.

It grows module by module:

| Phase | Module | Status |
| --- | --- | --- |
| 0 | Core: sign-in, roles, branches, sessions, classes, students, staff, settings, audit log | built (v1 backup import and photos pending, see docs/decisions.md) |
| 1 | Fees: rate chart, per-fee discounts, collection, receipts, dashboard, reports | built (v1 backup import pending, see docs/modules/fees.md) |
| 2 | Attendance: students (daily) and staff | later |
| 3 | Lectures: subjects, timetable, lecture log, syllabus progress | later |
| 4 | Leave: staff leave types, quotas, apply and approve; student leave notes | later |
| 5+ | Ideas only: exams and results, parent portal, SMS/WhatsApp alerts | not planned |

Build **only the phase you are asked for**. Design phase 0 so later modules plug
in without rewriting it.

A working first version of the fees app exists in `reference/school-fees-v1/`
(if present). It is plain JS on a Cloudflare Worker with D1. Treat it as the
specification for fee rules, screens and reports; do not copy its structure.

## 2. Hard constraints

- **Cloudflare free plan only.** Workers (with static assets) + D1. No paid
  services, no other hosting. Check current free-plan limits in Cloudflare's docs
  before relying on them (request CPU time, D1 queries per request, D1 size,
  rows read/written per day). Design for them:
  - Batch D1 statements; keep each request well under the per-request query limit.
  - Password hashing must fit the free CPU limit per request. Measure it in
    `wrangler dev` and document the chosen cost in `docs/decisions.md`.
  - Paginate lists; never load whole tables on hot paths except small ones.
- **Deploys through GitHub.** The repo is connected to Cloudflare Workers Builds.
  A push to `main` must build, apply D1 migrations, and deploy with no manual step.
- **Phones first.** Every screen must work at 360 px wide with one thumb. Desktop
  gets wider layouts, not different features.
- **Money is integer rupees.** Store whole rupees as INTEGER. Show as ₹ with
  Indian grouping (₹2,90,075). Never use floats for money.
- **Dates**: store `YYYY-MM-DD` in India time (Asia/Kolkata). Session `2026-27`
  starts in April (configurable).
- **Nothing financial is ever hard-deleted.** Receipts are cancelled with a reason
  and stay visible, struck through.
- **No secrets in the repo.** Use `wrangler secret` for anything secret.

## 3. Stack

- TypeScript everywhere, strict mode.
- API: Cloudflare Worker with **Hono**, request validation with **Zod**.
- Database: **D1**, schema changes only through numbered SQL files in
  `migrations/` applied by `wrangler d1 migrations apply`. Use Drizzle ORM for
  typed queries if it stays light; otherwise typed raw SQL helpers.
- Frontend: **React + Vite + TypeScript**, React Router, TanStack Query. Built to
  `dist/` and served by the same Worker as static assets (single deploy, one
  domain, no CORS).
- Styling: plain CSS with design tokens in `src/web/styles.css`. Look (owner's request,
  2026-11-20: "ultra modern", use the logo): the school logo (`public/logo-*.png`,
  `logo-256.webp`) in the sidebar, sign-in screen, receipts and as the app icon; brand blue
  from the logo, navy sidebar, glass top bar, floating bottom bar on phones; fonts Plus
  Jakarta Sans with Mukta for Hindi; green paid, red overdue; light and dark mode.
- Charts: small SVG components in `src/web/components/charts.tsx` (no chart library). Series
  colours are the validated data-viz palette; every chart has a legend and a table view.
- Tests: Vitest; API tests with `@cloudflare/vitest-pool-workers` against a local D1.
- Lint/format: ESLint + Prettier. CI: GitHub Actions runs typecheck, lint, tests on
  every pull request.

### Cloudflare build settings (Workers Builds)

- Build command: `npm ci && npm run build`
- Deploy command: `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`
- `wrangler.jsonc`: Worker name `school-app`, D1 binding `DB`, database
  `school_app`, assets directory `dist`, SPA fallback to `index.html`, `/api/*`
  handled by the Worker first.

## 4. Repository layout

```
/
├─ CLAUDE.md                 this file
├─ README.md                 what it is, local dev, deploy, backup
├─ docs/
│  ├─ setup-guide.md         step-by-step GitHub + Cloudflare setup for non-developers
│  ├─ decisions.md           short dated log of technical decisions
│  └─ modules/<module>.md    rules and screens per module
├─ migrations/               0001_core.sql, 0002_fees.sql, ...
├─ seed/                     demo data script (sample students, receipts)
├─ src/
│  ├─ worker/
│  │  ├─ index.ts            Hono app, mounts module routers, serves assets
│  │  ├─ core/               auth, sessions, users, roles, branches, classes, students, staff, settings, audit
│  │  └─ modules/
│  │     ├─ fees/            routes.ts, service.ts, schema.ts, permissions.ts, reports.ts
│  │     ├─ attendance/      (phase 2)
│  │     ├─ lectures/        (phase 3)
│  │     └─ leave/           (phase 4)
│  ├─ shared/                types and Zod schemas used by both API and UI
│  └─ web/
│     ├─ app/                layout, navigation, auth, module registry
│     ├─ components/         shared UI
│     └─ modules/<module>/   pages for each module
├─ tests/
└─ .github/workflows/ci.yml
```

### Module contract

Every module exports a manifest so the shell can show it without hard-coding:

```ts
// src/worker/modules/<name>/index.ts and src/web/modules/<name>/index.ts
{ id: 'fees', name: 'Fees', icon, routes, navItems, permissions: ['fees.view', 'fees.collect', ...], dashboardWidgets }
```

- A module may read core tables (students, staff, branches, sessions, classes).
- A module never writes to another module's tables; it calls that module's
  service functions instead.
- Each module can be switched on or off in Settings, per school.
- Each module adds its own migration file(s); never edit a migration that has
  already been applied in production.

## 5. Phase 0: Core

**Sign-in and roles**
- The school itself ships with the first release as migration `0003_initial_school.sql`:
  name, schools (branches) Kamalganj (KMG) and Kannauj (KNJ), session 2026-27 (current),
  section A in every class, the printed 2026-27 fee chart for both schools, and the first
  admin login `admin@sps.com` / `admin@123` (owner's decision, 2026-11-20). Only a hash is
  stored, and the admin must choose a new password at the first sign-in.
  Migration `0004_initial_school_manager.sql` adds a management login `manager@sps.com` /
  `manager@123` on the same terms (owner's request, 2026-11-20).
  Migration `0006_initial_school_demo.sql` adds a **Demo School** (code DEMO, `is_demo`) with
  sample students, fees and receipts; "All schools" always leaves demo schools out (owner's
  request, 2026-11-20). Rebuild it with `seed/demo/build.sh`, never by hand.
- **Sign in only, no sign-up.** The admin creates every other login under Logins. A new login
  (or a password the admin resets) is a first password only: the person must choose their own
  at the first sign-in before they can do anything else.
- **The sign-in screen asks for the school.** Everything the person sees is limited to that
  school. Admin and management may also choose "All schools" and can switch school from the
  top bar; an accountant can only choose a school assigned to them.
- Username (an email like `name@sps.com` is fine) + password; session token in an httpOnly,
  Secure, SameSite=Lax cookie; sessions stored in D1 with expiry, holding the chosen school;
  sign out everywhere when a password changes.
- Three roles (owner's decision, 2026-11-20):
  - **Admin**: everything, all schools; the only role that creates logins, edits branches,
    sessions, settings and the fee rate chart, sees the activity log and takes backups.
  - **Management**: the daily work of all schools: students, import, promotion, staff,
    sections, fees (collect, edit student fees, cancel receipts).
  - **Accountant**: fees in their assigned school(s); can look students up but not edit them.
  - Later phases (attendance, lectures, leave) may add teacher and staff roles; roles are
    checked in code, so adding one needs no table rebuild.
- Every API route checks permission **and** branch scope on the server.
- Rate-limit failed sign-ins.

**School structure**
- Branches: name, short code (used on receipt numbers), address, phone, active.
- Academic sessions: `2026-27`, start month (default April), one is current.
  Opening a new session copies the fee rate chart forward.
- Classes in order: Nursery, KG 1, KG 2, 1 to 12. Sections per class per branch.
- Subjects (used from phase 3).

**People**
- Students: admission number, name, father's name, mother's name, phone(s),
  address, date of birth, gender, photo (optional, later), branch, class, section,
  roll number (unique within branch + class + section + session), admission type
  (New/Old), status (Studying/Left with date). A student has one record per
  session (enrolment) so history is kept across years.
- Promotion tool: move a class to the next class for the new session in one step.
  Each student is marked Pass (next class), Fail (same class again) or Left (not moved).
  The result is saved on that year's enrolment, so the student page shows the history
  year by year. Rules in `docs/modules/core.md`.
- Staff: name, phone, designation, branch, joining date, teaching or non-teaching,
  linked user login (optional).
- Bulk import of students from CSV/Excel with a preview and error list.

**Platform**
- Audit log: who did what and when for every create/update/cancel (shown to admin).
- Settings: school name, logo, current session, modules on/off.
- Backup: admin downloads a full JSON backup; restore into an empty database.
- Import the v1 backup JSON (from `reference/` format) so existing data carries over.

## 6. Phase 1: Fees

### Rate chart (session 2026-27, seed exactly)

Columns: registration, admission, board fee/registration, annual charge,
practical, practical (higher option), TBDB etc., monthly fee. Amounts in ₹.

| Class group | Type | Reg. | Adm. | Board | Annual | Practical | Practical alt | TBDB | Monthly |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Nursery to KG 2 | New | 100 | 2500 | 0 | 0 | 0 | 0 | 500 | 700 |
| Nursery to KG 2 | Old | 0 | 0 | 0 | 1800 | 0 | 0 | 0 | 700 |
| Class 1 to 5 | New | 100 | 3000 | 0 | 0 | 0 | 0 | 500 | 800 |
| Class 1 to 5 | Old | 0 | 0 | 0 | 2000 | 0 | 0 | 0 | 800 |
| Class 6 to 8 | New | 100 | 3200 | 0 | 0 | 0 | 0 | 600 | 900 |
| Class 6 to 8 | Old | 0 | 0 | 0 | 2200 | 0 | 0 | 0 | 900 |
| Class 9 | New | 200 | 3500 | 1000 | 0 | 600 | 0 | 700 | 1200 |
| Class 9 | Old | 0 | 0 | 1000 | 2500 | 600 | 0 | 0 | 1200 |
| Class 10 | New | 200 | 4000 | 1200 | 0 | 600 | 0 | 800 | 1200 |
| Class 10 | Old | 0 | 0 | 1200 | 2800 | 600 | 0 | 0 | 1200 |
| Class 11 | New | 200 | 4500 | 1000 | 0 | 600 | 900 | 800 | 1400 |
| Class 11 | Old | 0 | 0 | 1000 | 3000 | 600 | 900 | 0 | 1400 |
| Class 12 | New | 200 | 5000 | 1500 | 0 | 600 | 900 | 800 | 1400 |
| Class 12 | Old | 0 | 0 | 1500 | 3500 | 600 | 900 | 0 | 1400 |

"At admission" total on the printed chart = all one-time charges + first month.
Admin can edit the chart per session. Editing it never changes students already
enrolled; their fees are copied at enrolment.

**Decided (owner left it to us):** the monthly fee is charged for 12 months by default,
editable per student. Each branch has its own rate chart per session, so Kannauj can
differ from Kamalganj; a new branch starts with a copy.

### Fee rules

- A student's fee for the session = each one-time charge + monthly fee × months.
  Class 11/12 choose practical 600 or 900 per student.
- **Discount per fee type.** Each of the 7 fee types can have its own discount,
  as **% off** or **₹ off**. The monthly discount applies to every month. Store the
  type and value per fee, and the resulting rupee discount per fee. Provide
  "same discount on all fees" and "clear discounts" shortcuts, and a discount
  reason (sibling, staff ward, merit...).
- Extra discount can also be given at the counter while collecting (₹ or % of
  amount due), recorded on the receipt.
- **Due as of today** = net one-time charges + net monthly fee × months started so
  far in the session (current month counts). **Pending for the year** = net fee −
  paid − counter discounts. **Overdue** = due as of today − settled, if positive.
- Payments clear the oldest charges first (one-time charges, then April, May, ...).
  The student page shows each month as Paid, Part paid, Due, Upcoming or Waived.
- Payment can't exceed pending. Receipt date can't be in the future.
- Receipt number = branch code + running number, e.g. `KMG-00163`, unique.
- Payment modes: Cash, UPI, Bank, Cheque, with reference number.
- Cancel receipt (admin/management only) with a reason; balance recalculates.
- A student marked Left owes nothing further; what they paid stays in collections.
- Late fee: not in v1; design so it can be added as another charge type later.

### Screens

- **Collect fee**: search by name, father, roll, phone; with no search, list
  students overdue today. Quick buttons: Due today, One month, Full. Save →
  printable receipt (A5/thermal-friendly) with amount in words (Indian system).
- **Student fee page**: summary (fee, discount, paid, pending, due today), month
  boxes, one-time charges with per-fee discount and balance, payment history,
  print statement, WhatsApp/share link to the receipt (text only for now).
- **Add/edit student fees**: per-fee rows showing fee, discount type/value, and
  what the student pays; totals; due at admission.
- **Rate chart** editor per session.
- **Dashboard** (for the school chosen at sign-in, or all schools for admin/management):
  collected vs total, overdue now, due later, today / last 7 days / this month,
  collection by month (session), last 14 days, payment mode split, branch
  comparison, class-wise position, largest dues with phone, latest receipts,
  total discounts.

### Reports (each with filters, CSV/Excel download, print)

Collection register (date range, branch, class, mode) · Day-wise collection by
mode (cash tally) · Pending dues (due today or whole year, minimum amount, class,
section) with phone numbers · Fee register (one line per student) · Class-wise
summary · Branch-wise summary · Discounts given (per fee type, with reason, plus
counter discounts) · Collected by staff member · Cancelled receipts.

## 7. Later phases (design for them now, build only when asked)

### Phase 2: Attendance
- Students: daily attendance per class-section by the class teacher: Present,
  Absent, Late, Half day, Leave. Default everyone Present; tap to change; a whole
  class in under 30 seconds on a phone. Lock after a set time; principal can edit.
- Holidays and working-days calendar per branch.
- Staff attendance: daily mark by principal or self check-in; approved leave
  (phase 4) marks automatically.
- Reports: today's absentees with parent phone, monthly register (grid like the
  paper register), attendance % per student and class, students below 75%,
  staff monthly attendance.
- Dashboard widgets: today's attendance % per branch and class.

### Phase 3: Lectures
- Subjects per class; teacher ↔ class-section ↔ subject assignments.
- Weekly timetable with periods per branch; clash checks (teacher, room).
- Substitution when a teacher is absent or on leave.
- Lecture log: teacher records topic taught and homework for each period.
- Syllabus plan per subject with chapters; progress % from the lecture log.
- Reports: teacher workload, missed lectures, syllabus progress by class.

### Phase 4: Leave
- Leave types (CL, SL, EL, unpaid...) with yearly quota per staff role.
- Staff apply (full or half day, date range, reason) → principal/admin approve or
  reject with comment → balance updates → staff attendance and timetable
  substitution use it.
- Leave calendar per branch; balances report.
- Student leave notes recorded by class teacher (and later by parents).

## 8. Quality bar

- Every money calculation lives in one pure function module with unit tests,
  including discounts, due-today, overdue, oldest-first allocation, cancellations.
- Server is the source of truth: the UI may preview totals but the API recomputes.
- Seed script creates two branches and ~45 sample students with discounts and
  receipts spread over April to today, for demos and screenshots.
- Accessible: labels on every input, visible focus, 44 px touch targets,
  works in light and dark mode, respects reduced motion.
- Plain-language UI copy in sentence case, written for school office staff.
  Prepare for Hindi: all UI strings go through a small i18n helper (English now).
- Errors say what went wrong and how to fix it.

## 9. Working rules for Claude Code

1. Before coding a phase, write a short plan (tables, routes, screens, tests) and
   ask the owner any open questions. Wait for a reply.
2. Work on a branch `phase-N-<module>`; small commits with clear messages; open a
   pull request to `main` when the phase is done and CI is green.
3. Run typecheck, lint and tests before each commit. Run the app with
   `wrangler dev`, click through the main flows, and fix what breaks.
4. Never run destructive commands against the remote D1 database. Remote
   migrations run only in the Cloudflare deploy step.
5. Update `README.md`, `docs/setup-guide.md`, `docs/modules/<module>.md` and this
   file's phase table when a phase ships.
6. If a free-plan limit blocks a requirement, stop and explain the trade-off
   instead of working around it silently.
