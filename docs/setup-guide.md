# Setup guide

For the school owner. No coding needed; about 20 minutes. You do this once.

You need:

- the GitHub account that owns this repository, and
- a free Cloudflare account (https://dash.cloudflare.com/sign-up).

## 1. Create the database

1. Sign in to the Cloudflare dashboard.
2. In the left menu open **Storage & Databases → D1 SQL Database**.
3. Select **Create Database**. Name it exactly `school_app`. Leave location on automatic.
   Select **Create**.
4. On the database page, copy the **Database ID** (a long code with dashes).

## 2. Put the database ID in the code

1. On GitHub, open this repository and the file `wrangler.jsonc`.
2. Select the pencil icon (Edit).
3. Find the line `"database_id": "00000000-0000-0000-0000-000000000000"` and replace the
   zeros with the ID you copied. Keep the quotation marks.
4. Select **Commit changes** (commit directly to `main`).

The database ID is not a secret; it is fine for it to be in the code.

## 3. Create an access token for deploys

Cloudflare's automatic token cannot update the database, so make your own:

1. In Cloudflare, select your profile picture (top right) → **My Profile → API Tokens**.
2. **Create Token** → use the template **Edit Cloudflare Workers**.
3. Under Permissions, select **Add more** and add **Account → D1 → Edit**.
4. Under Account Resources choose your account. Continue, then **Create Token**.
5. Copy the token now; it is shown only once. Do not put it in GitHub or share it.

## 4. Connect GitHub to Cloudflare

1. In Cloudflare open **Workers & Pages** → **Create application** → **GitHub**.
2. Approve access to this repository when GitHub asks.
3. Select the repository.
4. Fill in:
   - **Project name:** `school-app` (must be exactly this; it matches the code)
   - **Production branch:** `main`
   - **Build command:** `npm ci && npm run build`
   - **Deploy command:** `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`
   - **API token:** choose the token from step 3 (paste it if asked).
   - Switch **off** builds for non-production branches, so only `main` goes live.
5. Select **Save and Deploy** and wait a few minutes for the first build to finish.

From now on every change merged into `main` builds, updates the database and goes live by
itself.

## 5. First sign-in

1. Open the address Cloudflare shows for the Worker (it ends in `.workers.dev`).
2. You will see **Set up your school**. Fill in your name, a username and password, and
   the first branch with its short code (for example `KMG`). The short code is printed on
   receipt numbers later.
3. Select **Create school**. This screen never appears again.
4. Add the other branches under **More → Branches**, then logins for principals and
   office staff under **More → Logins**.

Write your owner password down somewhere safe. If the only admin forgets it, a developer
has to reset it in the database.

## 6. Day-to-day care

- **Weekly backup:** More → Backup → Download backup file. Keep it in a safe place.
- **Use your own web address (optional):** in Cloudflare, open the Worker → Settings →
  Domains & Routes → Add → Custom domain. The domain must be on Cloudflare.
- **New school year:** More → Sessions → Open session, then More → Promote to next session
  for each class, then make the new session current. See `docs/modules/core.md`.

## If something goes wrong

| What you see                                           | What to do                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Build fails with "Authentication error" on the D1 step | The token is missing the D1 Edit permission. Redo step 3 and select the new token in the Worker's Settings → Build. |
| Build fails with "Couldn't find a D1 DB"               | The database ID in `wrangler.jsonc` is wrong. Redo step 2.                                                          |
| Build fails saying the Worker name does not match      | The project name in Cloudflare must be `school-app`.                                                                |
| The page says "Something went wrong on the server"     | Open the Worker in Cloudflare → Logs to see the error, and share it with your developer.                            |
