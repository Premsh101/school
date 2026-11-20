# Setup guide

For the school owner. No coding needed. It takes about 30 minutes and you do it once.

**What you will do, in short:**

1. Put the app's code on `main` (one click on GitHub).
2. Create the database on Cloudflare.
3. Paste the database's ID into one file on GitHub.
4. Make an access token on Cloudflare.
5. Connect GitHub to Cloudflare so the app goes live by itself.
6. Open the app and set up the school.

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

## Step 6. Open the app and create your login

The school is already loaded with the app, so you do not type it in:

- the school name and address
- the branches **Kamalganj** (code `KMG`) and **Kannauj** (code `KNJ`), each with section A in every class
- the session **2026-27**, set as the current one
- the printed 2026-27 fee chart, for both branches

Only your own login is missing, because a password must never be kept in the code.

1. Open the `.workers.dev` address from Step 5 in your browser. You should see **Soni Pariya Public School** and the words **Your school is ready**.
2. Fill in **Your name**, a **Username** (small letters, for example `prem`) and a **Password** of at least 8 characters. Write the password down in a safe place.
3. Click **Create my login**. You are signed in as the owner. This screen never appears again.
4. Check the branches. Tap **More**, then **Branches**. Tap a branch to change its address, phone or short code. **The short code is printed on receipt numbers** (`KMG-00001`), so if you want a different code for Kannauj than `KNJ`, change it now, before the first receipt is made.
5. Check the fees. Tap **More**, then **Fee rate chart**. Use the **Branch** box to switch between Kamalganj and Kannauj. Tap **Edit** on a class group to change any amount for that branch.
6. Add the people who will use the app. Tap **More**, then **Logins**, then **Add login**. Choose a role (Principal, Accountant, Teacher or Staff), tick their branch, set a password, and tell it to the person.
7. Add your students. Either tap **Students**, then **Add student** one by one, or tap **More**, then **Import students** to upload an Excel or CSV list. The page has a **Download sample file** button that shows the columns.

Each student gets their fees copied from their branch's chart as soon as they are added.

**If you have a backup file from before:** on the first screen, tap **I have a backup file to restore** instead of creating a login. The school that came with the app is replaced completely by what is in your backup.

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

| What you see                                                                     | What to do                                                                                                                                                |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build fails with "Authentication error" or "not authorized" at the database step | The token is missing **D1 - Edit**. Redo Step 4, then in the Worker open **Settings**, **Build**, **API token**, pick the new token, and **Retry build**. |
| Build fails with "Couldn't find a D1 DB" or "database_id"                        | The ID in `wrangler.jsonc` is wrong or still zeros. Redo Step 3 carefully, then **Retry build**.                                                          |
| Build fails saying the name does not match                                       | The project name in Cloudflare must be exactly `school-app`.                                                                                              |
| The page shows "Something went wrong on the server"                              | Open the Worker in Cloudflare, click **Logs**, and send what you see to your developer.                                                                   |
| You forgot the only admin password                                               | There is no reset button. Your developer must reset it in the database. Keep the password written down.                                                   |
| You can sign in but a screen says you have no permission                         | Ask the owner to check your role under **More**, **Logins**.                                                                                              |
