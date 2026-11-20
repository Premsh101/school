# Setup guide

For the school owner. No coding needed. It takes about 30 minutes and you do it once.

**What you will do, in short:**

1. Put the app's code on `main` (one click on GitHub).
2. Create the database on Cloudflare.
3. Paste the database's ID into one file on GitHub.
4. Make an access token on Cloudflare.
5. Connect GitHub to Cloudflare so the app goes live by itself.
6. Sign in as admin and set your own password.
7. Add logins for your people and your students.

**What you need before you start:**

- The GitHub account that owns this repository (`school`).
- A free Cloudflare account. If you do not have one: go to https://dash.cloudflare.com/sign-up, enter your email and a password, and confirm the email Cloudflare sends you. You do not need to add a card or a domain.
- A computer is easiest. A phone works too, but the screens are small.

Cloudflare sometimes renames a menu or button. If a name below does not match exactly, pick the closest one; the order of steps stays the same.

---

## Step 1. Put the code on `main`

The app was built on a work branch and is waiting in a pull request. Merging it is the only way the code gets onto `main`, which is where the live app is built from.

1. Open https://github.com/Premsh101/school/pulls in your browser. Sign in to GitHub if asked.
2. Click the pull request called **Phase 0 core and Phase 1 fees**.
3. Scroll down. You should see a green tick and the words **All checks have passed**. If you see a red cross, stop and tell your developer.
4. Click the green **Merge pull request** button, then click **Confirm merge**.
5. Do not delete the branch if GitHub offers to. It is harmless to keep it.

Nothing goes live yet. Cloudflare is not connected until Step 5.

---

## Step 2. Create the database on Cloudflare

1. Open https://dash.cloudflare.com and sign in.
2. If Cloudflare asks which account to use, click your account's name.
3. In the menu on the left, click **Storage & databases**, then click **D1 SQL database**.
4. Click the blue **Create Database** button.
5. In **Name**, type exactly: `school_app` (small letters, with an underscore, no spaces).
6. Leave the location on automatic.
7. Click **Create**.
8. You are now on the page of your new database. Find **Database ID**. It is a long code with dashes, like `3f2a9c1e-....`. Click the small copy icon next to it, or select the code and copy it.
9. Paste it into a note on your phone or computer for the next step. It is not a secret.

---

## Step 3. Paste the database ID into the code

1. Open https://github.com/Premsh101/school in your browser.
2. Make sure the branch picker (top left, above the file list) says **main**.
3. Click the file **wrangler.jsonc** in the list.
4. Click the **pencil icon** (Edit this file) at the top right of the file.
5. Find the line that says:

   `"database_id": "00000000-0000-0000-0000-000000000000",`

6. Select only the zeros and dashes between the quotation marks and paste your Database ID in their place. Keep the quotation marks and the comma. The line should end up like this (with your own ID):

   `"database_id": "3f2a9c1e-1111-2222-3333-444455556666",`

7. Do not change anything else in the file.
8. Click the green **Commit changes...** button at the top right.
9. In the box that opens, leave the message as it is, make sure **Commit directly to the main branch** is selected, and click **Commit changes**.

---

## Step 4. Make an access token on Cloudflare

Cloudflare's own automatic token cannot update the database, so you make one that can.

1. Open https://dash.cloudflare.com/profile/api-tokens. (Or click your profile picture at the top right, click **My Profile**, then **API Tokens** in the left menu.)
2. Click **Create Token**.
3. Find the template called **Edit Cloudflare Workers** and click **Use template** next to it.
4. In the **Token name** box, type: `school-app deploy`.
5. Look at the **Permissions** list. Click **+ Add more** at the bottom of the list, and set the three dropdowns on the new row to:
   - **Account**
   - **D1**
   - **Edit**
6. Under **Account Resources**, check that it says **Include** and your account's name. If it says **All accounts**, that is fine too.
7. Leave **Zone Resources** as the template set it.
8. Click **Continue to summary**. Check that **D1 - Edit** is in the list.
9. Click **Create Token**.
10. Cloudflare shows the token once. Click **Copy** and paste it into your note right away. If you lose it, you can make a new one.

**Keep the token private.** Anyone who has it can change your Cloudflare setup. Never paste it into GitHub, a chat or an email.

---

## Step 5. Connect GitHub to Cloudflare

1. Go back to https://dash.cloudflare.com.
2. In the left menu, click **Workers & Pages**.
3. Click **Create application** (or **Create**).
4. Choose the option to start from a Git repository, named **Import a repository** or **Connect to Git** or **GitHub**.
5. If Cloudflare asks you to sign in to GitHub, click **Connect GitHub** and approve. When GitHub asks which repositories to allow, choose **Only select repositories**, pick **school**, and click **Install & Authorize**.
6. Back in Cloudflare, click the **school** repository, then **Next** or **Begin setup**.
7. Fill in the form exactly like this:

   | Field                            | What to type                                                          |
   | -------------------------------- | --------------------------------------------------------------------- |
   | **Project name**                 | `school-app` (must be exactly this)                                   |
   | **Production branch**            | `main`                                                                |
   | **Build command**                | `npm ci && npm run build`                                             |
   | **Deploy command**               | `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy` |
   | **Root directory**               | leave empty                                                           |
   | **Non-production branch builds** | switch **off**, so only `main` goes live                              |

8. Look for **API token** (it may be under **Advanced settings**). The default is an automatic token, which cannot update the database. Change it to your own: choose **Create new token** or **Use existing token**, and paste the token from Step 4.
9. Click **Save and Deploy**.
10. Wait about 2 to 5 minutes. A log scrolls past. At the end you should see **Success** and an address ending in `.workers.dev`, like `school-app.yourname.workers.dev`.

If the build fails, do not worry. Nothing is damaged. Look at the table in "If something goes wrong" at the end, fix the cause, then open the Worker, go to **Deployments** (or **Builds**) and click **Retry build**.

If you cannot find the token field in step 8 on the first screen, finish with **Save and Deploy** anyway, then open the Worker, click **Settings**, then **Build**, then **API token**, choose your token, and click **Retry build**.

---

## Step 6. Sign in for the first time

Everything is already loaded with the app, so you do not type it in:

- the school name and address
- the schools **Kamalganj** (code `KMG`) and **Kannauj** (code `KNJ`), each with section A in every class
- the session **2026-27**, set as the current one
- the printed 2026-27 fee chart, for both schools
- the first admin login: **admin@sps.com**, password **admin@123**
- a management login to try the app: **manager@sps.com**, password **manager@123** (whoever signs in
  with it first must choose a new password; you can switch it off under **Logins**)
- a **Demo School** with 45 sample students, fees and receipts, for trying the app: choose
  **Demo School** at sign-in or in the school list at the top. It is never counted in
  **All schools**. Close it under **Branches** when you no longer need it.

**Do this step straight after the first deploy.** Until you set your own password, anyone who
knows `admin@123` could sign in as the admin. The same goes for `manager@123`: sign in with it
(or give it to the person who will use it) soon, or switch it off under **Logins**.

1. Open the `.workers.dev` address from Step 5 in your browser. You see **Sign in to continue**.
2. In **School**, choose **All schools (admin and management)**.
3. In **Username** type `admin@sps.com`. In **Password** type `admin@123`. Tap **Sign in**.
4. You see **Set your own password**. Type `admin@123` in **Password you just used**, then your own new password twice (at least 8 characters). Write it down in a safe place. Tap **Save and continue**.
5. You are signed in. From now on `admin@123` no longer works; only your new password does.

---

## Step 7. Set up the school for daily use

1. **Check the schools.** Tap **More**, then **Branches**. Tap a school to add its address and phone (they print on receipts). The short code is printed on receipt numbers (`KMG-00001`, `KNJ-00001`).
2. **Check the fees.** Tap **More**, then **Fee rate chart**. Use the **Branch** box to switch between Kamalganj and Kannauj. Tap **Edit** on a class group to change any amount for that school.
3. **Make logins for your people.** Tap **More**, then **Logins**, then **Add login**:
   - **Name** and **Username** (an email like `sunita@sps.com` is fine).
   - **Role**:
     - **Management**: students, staff and fees in every school.
     - **Accountant**: fees in the schools you tick. Tick Kamalganj, Kannauj, or both.
     - **Admin**: everything, including logins and settings. Give this only to the owner.
   - **First password**: tell it to the person. When they sign in the first time, they must choose their own password, so you never know it.
   - Tap **Save**.
4. **Add your students.** Either tap **Students**, then **Add student** one by one, or tap **More**, then **Import students** to upload an Excel or CSV list. The page has a **Download sample file** button that shows the columns.

Each student gets their fees copied from their school's chart as soon as they are added.

There is no sign-up button anywhere: only the admin can make logins. If someone forgets their password, open **Logins**, tap their name, type a new first password and save.

### How signing in works for everyone

- The sign-in screen asks for the **School**, then username and password.
- People see **only the school they chose**: its students, fees, receipts and reports.
- **Admin and management** can choose **All schools**, and can change school any time from the box at the top of the screen.
- **Accountants** can only choose a school you ticked for them. If they pick another school, the app says they are not assigned to it.

**If you have a backup file from before:** sign in as admin, then tap **More**, **Backup**, and use **Restore a backup** before adding any students. Everything that came with the app, including logins, is replaced by what is in the backup.

---

## Use it on a phone like an app

1. Open the app's address in Chrome on an Android phone.
2. Tap the three dots at the top right, then **Add to Home screen**, then **Add**.
3. On an iPhone, open the address in Safari, tap the Share button, then **Add to Home Screen**.

---

## Day-to-day care

- **Weekly backup:** tap **More**, then **Backup**, then **Download backup file**. Save the file somewhere safe, for example your Google Drive. It contains phone numbers and addresses, so do not share it.
- **New school year:** tap **More**, then **Sessions**, then **Open session** for the new year. Then tap **More**, then **Promote to next session** for each class: mark each student **Pass**, **Fail** or **Left**, and tap **Move class**. Finally tap **Sessions** again and **Make current** on the new session. The old year stays in each student's history. Details are in `docs/modules/core.md`.
- **Change the fees for a new year:** open **Fee rate chart**, switch to the new session with the box at the top of the screen, and edit.
- **Your own web address (optional):** in Cloudflare open the Worker, click **Settings**, **Domains & Routes**, **Add**, **Custom domain**. The domain must be added to Cloudflare first.
- **Updates:** when your developer merges a change into `main`, Cloudflare builds it and updates the database and the app by itself. You do nothing.

---

## If something goes wrong

| What you see                                                                     | What to do                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build fails with "Authentication error" or "not authorized" at the database step | The token is missing **D1 - Edit**. Redo Step 4, then in the Worker open **Settings**, **Build**, **API token**, pick the new token, and **Retry build**.                       |
| Build fails with "Couldn't find a D1 DB" or "database_id"                        | The ID in `wrangler.jsonc` is wrong or still zeros. Redo Step 3 carefully, then **Retry build**.                                                                                |
| Build fails saying the name does not match                                       | The project name in Cloudflare must be exactly `school-app`.                                                                                                                    |
| The page shows "Something went wrong on the server"                              | Open the Worker in Cloudflare, click **Logs**, and send what you see to your developer.                                                                                         |
| "Wrong username or password"                                                     | Check the username (an email like `admin@sps.com`) and the password. After 5 wrong tries the username is locked for 15 minutes.                                                 |
| "You are not assigned to this school" at sign-in                                 | Choose your own school, or ask the admin to tick that school for you under **Logins**.                                                                                          |
| You can sign in but a screen says you have no permission                         | Ask the admin to check your role under **More**, **Logins**.                                                                                                                    |
| Someone forgot their password                                                    | The admin opens **Logins**, taps the person, types a new first password and saves. The person then chooses their own at the next sign-in.                                       |
| The admin forgot their own password                                              | There is no reset button. Your developer must reset it in the database. To be safe, make a second admin login for another trusted person, and keep both passwords written down. |
