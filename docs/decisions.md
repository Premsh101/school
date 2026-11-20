# Decisions

Short, dated notes on technical choices. Newest first.

## 2026-11-20 — Three roles, school chosen at sign-in, shipped admin login

**Owner's decisions:** roles are admin, management and accountant; there is sign-in only, no
sign-up; the sign-in screen asks for the school; the first admin is `admin@sps.com` with
password `admin@123`.

- **The admin password is in the repository** as a PBKDF2 hash inside migration 0003. This
  goes against the brief's "no secrets in the repo" rule, so it is made safe: the login is
  marked `must_change_password`, and the server refuses every request except "set a new
  password" until the admin has chosen their own. `admin@123` stops working at that moment.
  Until then, anyone who knows `admin@123` and the app's address could take the admin login,
  so the owner should sign in and change it right after the first deploy.
- **The same first-password rule applies to every login the admin makes** and to passwords
  the admin resets, so the admin never knows anyone's real password.
- **The school is part of the sign-in session** (`auth_sessions.branch_id`). Every query is
  limited through `scopeSql()`/`assertBranch()` exactly as before, now to the chosen school.
  `null` means all schools and is allowed only for admin and management. If an accountant
  loses access to the school (or it is closed), their session stops counting.
- **Roles are checked in code**, not by a database `CHECK`, so later phases can add teacher
  or staff without rebuilding the `users` table.
- **Migrations 0001 and 0003 were edited, not added to**, because nothing had been applied to
  a production database yet (the pull request was not merged). From the first deploy on, any
  change is a new numbered migration.
- **Restore** used to need a database with no logins. With the shipped admin there is always a
  login, so the rule is now: only the signed-in admin, and only before any students exist. It
  replaces everything, including logins. If a restore is started and not finished, there is
  no login left and the app shows only "finish restoring", never a sign-up.

## 2026-11-20 — The school ships with the first release

**Migration `0003_initial_school.sql`** loads the school name and address, the branches
Kamalganj (`KMG`) and Kannauj (`KNJ`), the session 2026-27 (current), section A in every
class, and the printed 2026-27 fee chart for both branches. It deploys with the first
release through the normal "apply migrations, then deploy" step, with nothing to do by hand.

- Every statement is `INSERT OR IGNORE` and guarded by "no login exists yet", so it never
  overwrites or adds to a school that was already set up, and running it twice changes
  nothing. It is a new numbered file; no applied migration was edited.
- (Superseded the same day: the admin login now ships too, and the setup screen is gone.
  See the entry above.)
- **Restore** clears the loaded school when it starts (only possible while there is no login),
  so a backup replaces it completely instead of mixing with it.
- The fee amounts are written out in the migration and a test compares every row with
  `DEFAULT_RATE_CHART` in `src/shared/fees.ts`, so the two cannot drift apart.
- The Kannauj code `KNJ` is a guess. It can be changed under Branches; receipts already made
  keep their old numbers, so change it before the first receipt.
- The normal tests leave this migration out so they start from an empty school; two test
  files apply it on purpose and check the first visit, the fee chart and restore.

## 2026-11-19 — Phase 1 (fees)

**One pure money module.** Every calculation (discounts, due today, overdue, oldest-first
allocation, receipt wording, amount in words) is in `src/shared/fees.ts` and unit-tested.
Lists and reports need the same position for thousands of students, so the rules are also
written once in SQL (`positionSql`); an API test compares the two.

**Student fees are stored as a JSON list plus totals** in `student_fees`, one row per
enrolment. The list keeps the type and value of each discount; the totals let SQL add up
a whole school without unpacking JSON. `paid` and `counter_discount` are recalculated from
the receipts table in the same batch as every receipt save or cancel, so they cannot drift.

**Receipt numbers** are taken inside the `INSERT` (`MAX(seq) + 1` for the branch) with a
unique index behind it, and the same statement refuses a payment that would exceed
pending, so two phones saving at once cannot clash or over-collect.

**Fees are copied at enrolment through a module hook** (`onEnrolmentsAdded`), in the same
batch that adds the student, so core code never writes to fees tables. Students who
arrive another way (a restored backup) get fees on first view or from "Set up their fees"
on the dashboard.

**Rate chart is per branch.** The owner has branches in different towns; one row per
session + branch + class + new/old.

**Rows read.** A collect search or dashboard reads one session's students (a few thousand
rows). At about 3,000 students that allows well over a thousand such requests a day
inside the free 5 million rows; the search waits for typing to pause to keep it low.

**Reports return at most 3,000 rows** and say so when cut; "Download for Excel" is a CSV
file made in the browser.

**Charts** are single-colour bars and meters with the numbers always written beside them,
so nothing depends on telling colours apart.

**Fee demo data goes through the API** (`npm run seed:fees`) instead of raw SQL, so the
demo follows exactly the rules of the fee counter.

## 2026-11-19 — Phase 0

**Free-plan limits checked (Cloudflare docs, 19 Nov 2026).** Workers: 10 ms CPU per
request, 100,000 requests a day. D1: 50 queries per request (a `batch()` counts as one),
500 MB per database, 5 million rows read and 100,000 rows written a day, 100 bound
parameters per query, 2 MB per string. How the app stays inside them:

- Each request makes 1 query to find the signed-in user plus 1–3 batches.
- Bulk work (import, promotion, restore) sends rows as one JSON parameter and unpacks it
  in SQL with `json_each`, so 100 students cost one statement, not 100.
- Import, backup and restore are driven by the browser in chunks (100–500 rows per
  request), so no single request does heavy work.
- Lists are paginated (30 students, 50 log entries per page). Only small tables
  (branches, sessions, classes, sections) are loaded whole.
- Student search uses `LIKE` over one session's students. At a few thousand students that
  is a few thousand rows read per search — fine against 5 million a day. If the school
  grows past roughly 20,000 students, add a search index.

**Password hashing: PBKDF2-SHA256, 20,000 iterations.** Measured in the Workers runtime
(workerd, the engine behind `wrangler dev`) on a 2.1 GHz Xeon:

| Iterations | Time per hash |
| ---------- | ------------- |
| 10,000     | 1.6 ms        |
| 20,000     | 2.9 ms        |
| 50,000     | 7.5 ms        |
| 100,000    | 15.3 ms       |

Changing a password needs two hashes in one request (check the old, store the new), so
20,000 (about 6 ms for that request) is the highest round number that stays safely under
10 ms. This is well below the usual recommendation for PBKDF2 (hundreds of thousands of
iterations) — that is the price of the free plan. What makes up for it: sign-in is limited
to 5 wrong tries per username and 30 per network address in 15 minutes, passwords need 8+
characters, and hashes never leave the database except inside an admin's backup file. The
iteration count is stored in each hash, so on a paid plan it can be raised by changing one
number; old hashes are upgraded at the next sign-in.

**Sign-in sessions.** A random 32-byte token in an httpOnly, Secure, SameSite=Lax cookie;
only its SHA-256 is stored in D1. Sessions last 30 days. Changing a password removes all of
the user's sessions and starts a new one for the device in use.

**Roles are fixed in code** (`src/shared/permissions.ts`), not editable tables: five roles
are enough, and code is easier to test. Modules add their own permissions to roles through
their manifest.

**One student, one enrolment per session.** Personal details live in `students`; class,
section, roll number, new/old, studying/left and the year-end result live in `enrolments`.
The promotion tool writes the result on this year's enrolment and creates next year's, so
history is never overwritten.

**Classes are school-wide, sections are per branch.** A new branch gets section A for every
class automatically.

**Typed raw SQL instead of Drizzle.** The queries are few and use SQLite features
(`json_each`, partial unique index, `UPDATE … FROM`) that are simpler written directly.
Keeps the Worker bundle small.

**Plain CSS with design tokens** instead of Tailwind. One stylesheet, light and dark mode
from the same tokens.

**i18n helper uses the English text as the key** (`t('Add student')`), so Hindi can be added
by filling one dictionary without touching screens.

**Backup format.** `{ format: "school-app-backup", version: 1, tables: { name: rows[] } }`.
Restore is open without sign-in only while the database has no users, and needs a one-hour
token issued by `/api/restore/begin`.

**`compatibility_date` is 2026-08-01**, the newest date the test runner's bundled runtime
accepts. Raise it when `@cloudflare/vitest-pool-workers` is updated.

**Test runner.** `@cloudflare/vitest-pool-workers` 0.23 with Vitest 4 prints a notice that
it will be renamed `@cloudflare/vitest-plugin`. Nothing to do now; switch when convenient.

**Lockfile.** npm 10 crashed while resolving the test tooling ("Cannot read properties of
null"), so `package-lock.json` was written with npm 11. `npm ci` works with both.

### Not done in phase 0, on purpose

- **Import of the v1 fees backup.** `reference/school-fees-v1/` is not in the repository,
  so the old format is unknown. To be built with phase 1 once the folder (and a sample
  backup file) is added.
- **Student photos.** Needs file storage (R2); the `photo_key` column is ready.
- **Teacher sees only own classes.** Teachers currently see all students of their branch;
  class-level scoping arrives with the timetable in phase 3.
