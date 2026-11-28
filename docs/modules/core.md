# Core (phase 0)

Everything the other modules stand on: who can sign in, how the school is organised, and
the students and staff themselves.

## Roles

| Role       | Can do                                                                                                     | Schools                |
| ---------- | ---------------------------------------------------------------------------------------------------------- | ---------------------- |
| Admin      | Everything: logins, branches, sessions, settings, fee rate chart, activity log, backup, and all daily work | All                    |
| Management | Students (add, edit, import, promote), staff, sections, fees (collect, edit, cancel receipts)              | All                    |
| Accountant | Fees (collect, edit a student's fees); can look students up                                                | Only the ones assigned |

Every API route checks the permission and the school on the server; the screens only hide
what a person cannot use.

## Rules

- **First release:** migration `0003_initial_school.sql` loads the school name and address,
  the schools Kamalganj (`KMG`) and Kannauj (`KNJ`) with section A in every class, the
  session 2026-27 as current, the printed 2026-27 fee chart for both schools, and the first
  admin login `admin@sps.com` / `admin@123` (stored only as a hash).
- **No sign-up.** Only the admin creates logins (More → Logins). A new login, or a password
  the admin resets, is only a first password: at the first sign-in the person must choose
  their own before anything else works. The admin's own `admin@123` works only until then.
- **Sign-in asks for the school.** The person sees only that school's students, fees,
  sections and reports. Admin and management may choose "All schools" and can switch school
  from the top bar without signing in again. An accountant can choose only a school assigned
  to them; if the admin moves them off that school, they are signed out.
- **Sign-in limits:** 5 wrong passwords for a username within 15 minutes locks that username
  for the rest of the 15 minutes. Changing a password signs the person out on other devices;
  an admin resetting someone's password signs them out everywhere.
- **Sessions:** named like `2026-27`, starting in April. One is current. The session picker
  in the top bar lets anyone look at another year.
- **Gender** is Male or Female (or not set). A student saved as "Other" by the first release is read as not set, so they can still be edited.
- **Cancelling a registration** (admin and management, More → a student → Cancel registration):
  needs a reason and a date. The student's class record for that session is marked as left
  (so they owe nothing further and what they paid stays in collections) and keeps the reason,
  who cancelled it and when; the student page says "Registration cancelled" and the leavers
  report shows the reason. Setting the student back to Studying undoes it.
- **Students:** one record per person, plus one class record (enrolment) per session.
  - Admission number is unique across the school. Leave it empty to get the next number.
  - Roll number is unique within branch + class + section + session.
  - A student marked Left keeps their record; they are simply no longer counted as studying.
- **Promotion (year end):**
  1. Admin opens the next session (Sessions → Open session).
  2. For each class: Promote to next session → mark each student Pass, Fail or Left
     (everyone starts as Pass) → Move class.
     - Pass → next class in the new session. Class 12 passes out (no new record).
     - Fail → same class again in the new session.
     - Left → marked as left today, not moved.
     - Students keep their section; roll numbers continue after the highest one already in
       the target section and can be edited afterwards.
     - This year's record keeps its result, so the student page shows the full history.
     - Running it twice is safe: students already moved are skipped.
  3. Admin makes the new session current.
  - A wrong result can be corrected on the student page (Class history → Edit).
- **Import:** Excel (.xlsx) or CSV with headings in the first row. Needed columns: Name,
  Class. The whole file is checked first and nothing is saved unless every row is correct;
  each problem is listed with its line number.
- **Activity log:** every create, update, import, promotion, backup download and restore is
  recorded with the person and time. Admin only. Entries cannot be changed.
- **Backup:** admin downloads one JSON file. Restore (Backup page) works only before any
  students are added; it replaces everything, including logins, with what is in the file.

## Screens

Setup · Sign in · Home · Students (search and filters) · Add / edit student · Student page
with class history · Import students · Promote to next session · Staff · Classes and
sections (with subjects) · Logins · Branches · Sessions · Settings · Activity log · Backup ·
My account (password, light/dark, sign out) · More (full menu on phones) · Home dashboard
(students, staff, new and old, left, students by class, and the fee snapshot) · Reports
(student list, class strength, students who left, plus every module's reports, with filters,
search, sorting, totals, Excel download and print).

## API (all under `/api`)

| Route                                                                                                                                     | Permission                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `GET /bootstrap`, `POST /setup`, `POST /auth/login`, `POST /auth/logout`                                                                  | open                                       |
| `POST /auth/password`, `GET /home`, `GET /subjects`                                                                                       | signed in                                  |
| `GET /students`, `GET /students/:id`                                                                                                      | `students.view`                            |
| `POST /students`, `PUT /students/:id`, `POST /students/:id/enrolments`, `PUT /enrolments/:id`, `POST /enrolments/:id/cancel-registration` | `students.edit`                            |
| `POST /students/import` (`?commit=1` to save)                                                                                             | `students.import`                          |
| `GET /promotion/candidates`, `POST /promotion`                                                                                            | `students.promote`                         |
| `GET /staff`                                                                                                                              | `staff.view`                               |
| `POST /staff`, `PUT /staff/:id`                                                                                                           | `staff.edit`                               |
| `POST /sections`, `PUT /sections/:id/active`                                                                                              | `structure.edit`                           |
| `GET/POST /users`, `PUT /users/:id`                                                                                                       | `users.manage`                             |
| `POST/PUT /branches`, `POST /sessions`, `POST /sessions/:id/current`, `POST/PUT /subjects`, `PUT /settings`                               | `school.manage`                            |
| `GET /audit`                                                                                                                              | `audit.view`                               |
| `GET /backup`, `GET /backup/:table`                                                                                                       | `backup.manage`                            |
| `POST /restore/begin`, `/restore/chunk`, `/restore/finish`                                                                                | open, only while the database has no users |

## Adding a module

1. Add `migrations/000N_<module>.sql`.
2. Create `src/worker/modules/<id>/index.ts` exporting a `WorkerModule` (routes,
   permissions, which roles get them, tables for backup, optional `onSessionOpened`) and add
   it to the list in `src/worker/modules/index.ts`.
3. Create `src/web/modules/<id>/index.ts` exporting a `WebModule` (routes, nav items, home
   widgets) and add it to the list in `src/web/modules/index.ts`.

The shell then mounts `/api/<id>/*`, shows the navigation and home widgets, includes the
tables in backups, and offers an on/off switch in Settings. A module reads core tables
freely but never writes to another module's tables.
