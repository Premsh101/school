# Decisions

Short, dated notes on technical choices. Newest first.

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
