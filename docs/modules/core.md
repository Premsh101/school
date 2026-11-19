# Core (phase 0)

Everything the other modules stand on: who can sign in, how the school is organised, and
the students and staff themselves.

## Roles

| Role          | Can do                                                                                      | Branches  |
| ------------- | ------------------------------------------------------------------------------------------- | --------- |
| Owner / Admin | Everything, including branches, sessions, settings, activity log, backup                    | All       |
| Principal     | Students (add, edit, import, promote), staff, sections, logins for accountant/teacher/staff | Their own |
| Accountant    | See students (fees arrive in phase 1)                                                       | Their own |
| Teacher       | See students (attendance and lectures arrive in phases 2–3)                                 | Their own |
| Staff         | Own account only (leave and attendance arrive later)                                        | Their own |

Every API route checks the permission and the branch on the server; the screens only hide
what a person cannot use.

## Rules

- **First run:** an empty database shows the setup screen once. It creates the owner, the
  first branch (with section A in every class) and the first session.
- **Sign-in:** 5 wrong passwords for a username within 15 minutes locks that username for
  the rest of the 15 minutes. Changing a password signs the person out on other devices;
  an admin resetting someone's password signs them out everywhere.
- **Sessions:** named like `2026-27`, starting in April. One is current. The session picker
  in the top bar lets anyone look at another year.
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
- **Backup:** admin downloads one JSON file. Restore works only into an empty database.

## Screens

Setup · Sign in · Home · Students (search and filters) · Add / edit student · Student page
with class history · Import students · Promote to next session · Staff · Classes and
sections (with subjects) · Logins · Branches · Sessions · Settings · Activity log · Backup ·
My account (password, light/dark, sign out) · More (full menu on phones).

## API (all under `/api`)

| Route                                                                                                       | Permission                                 |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `GET /bootstrap`, `POST /setup`, `POST /auth/login`, `POST /auth/logout`                                    | open                                       |
| `POST /auth/password`, `GET /home`, `GET /subjects`                                                         | signed in                                  |
| `GET /students`, `GET /students/:id`                                                                        | `students.view`                            |
| `POST /students`, `PUT /students/:id`, `POST /students/:id/enrolments`, `PUT /enrolments/:id`               | `students.edit`                            |
| `POST /students/import` (`?commit=1` to save)                                                               | `students.import`                          |
| `GET /promotion/candidates`, `POST /promotion`                                                              | `students.promote`                         |
| `GET /staff`                                                                                                | `staff.view`                               |
| `POST /staff`, `PUT /staff/:id`                                                                             | `staff.edit`                               |
| `POST /sections`, `PUT /sections/:id/active`                                                                | `structure.edit`                           |
| `GET/POST /users`, `PUT /users/:id`                                                                         | `users.manage`                             |
| `POST/PUT /branches`, `POST /sessions`, `POST /sessions/:id/current`, `POST/PUT /subjects`, `PUT /settings` | `school.manage`                            |
| `GET /audit`                                                                                                | `audit.view`                               |
| `GET /backup`, `GET /backup/:table`                                                                         | `backup.manage`                            |
| `POST /restore/begin`, `/restore/chunk`, `/restore/finish`                                                  | open, only while the database has no users |

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
