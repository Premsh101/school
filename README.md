# School app — Soni Pariya Public School

A web app for running the school's branches from a phone: students, staff, classes and
(module by module) fees, attendance, lectures and leave. It runs on Cloudflare's free plan:
one Worker serves both the API and the web pages, and data lives in a D1 database.

| Phase | Module                                                                     | Status |
| ----- | -------------------------------------------------------------------------- | ------ |
| 0     | Core: sign-in, roles, branches, sessions, classes, students, staff, backup | built  |
| 1     | Fees: rate chart, discounts, collection, receipts, dashboard, reports      | built  |
| 2–4   | Attendance, lectures, leave                                                | later  |

- **Setting it up for the first time (no coding needed):** [docs/setup-guide.md](docs/setup-guide.md)
- **What the core module does:** [docs/modules/core.md](docs/modules/core.md)
- **Fees and the rate chart:** [docs/modules/fees.md](docs/modules/fees.md)
- **Why things are built the way they are:** [docs/decisions.md](docs/decisions.md)
- **Full project brief:** [CLAUDE.md](CLAUDE.md)

## Run it on your computer

You need Node.js 22 or newer.

```bash
npm ci
npm run dev        # API on :8787, web pages on http://localhost:5173
```

Open http://localhost:5173. The first visit shows the one-time setup screen.

To start with demo data instead (2 branches, 45 students, staff, logins), run this on an
empty local database before opening the app:

```bash
npm run db:migrate
npm run seed       # sign in as admin / principal / accountant / teacher, password demo12345
npm run dev        # then, in a second terminal:
npm run seed:fees  # discounts and receipts from April to today
```

Other commands:

| Command             | What it does                                                              |
| ------------------- | ------------------------------------------------------------------------- |
| `npm run typecheck` | TypeScript checks for the Worker and the web app                          |
| `npm run lint`      | ESLint and Prettier checks                                                |
| `npm test`          | Unit and API tests, run inside the Workers runtime with a local D1        |
| `npm run build`     | Builds the web app into `dist/`                                           |
| `npm run preview`   | Builds, then serves everything from the Worker on :8787, as in production |

## How it is laid out

```
migrations/        numbered SQL files; the only way the database schema changes
seed/              demo data for local use
src/shared/        types, validation, dates, permissions used by both sides
src/worker/        the API (Hono). core/ = phase 0, modules/ = fees, attendance, ...
src/web/           the web app (React). pages/ = core screens, modules/ = module screens
tests/             Vitest tests
```

## Deploying

Every push to `main` is built and deployed by Cloudflare Workers Builds:

- Build command: `npm ci && npm run build`
- Deploy command: `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`

Nobody runs migrations or deploys by hand. See the setup guide for the one-time connection.

## Backup and restore

- **Backup:** sign in as admin → More → Backup → Download backup file. Do it weekly and
  keep the file somewhere safe; it contains personal details.
- **Restore:** a backup can only be loaded into an empty database. On a fresh installation
  the first screen offers "I have a backup file to restore".
- Cloudflare also keeps 7 days of point-in-time history for D1 on the free plan
  ("Time Travel"), which a developer can use in an emergency.
