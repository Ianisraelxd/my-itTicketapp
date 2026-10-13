# Campus HelpDesk

A role-based IT support desk for a campus, built with **React + Vite**, backed by a small **Express + MySQL** API. Students and staff can submit and track support requests, agents work their assigned queue, and admins manage users, tickets, and activity logs.

The project ships in two forms:

1. **Full app** — React frontend + Express API + MySQL database (real persistence).
2. **Presentation build** — a single self-contained `presentation/index.html` that runs the whole UI in the browser using `localStorage` instead of a database. No backend, no build step.

---

## Table of contents

- [Features](#features)
- [Screenshots](#screenshots)
- [HelpDesk Assistant (ticket chatbot)](#helpdesk-assistant-ticket-chatbot)
- [Security and governance](#security-and-governance)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Install dependencies](#1-install-dependencies)
  - [2. Create the database](#2-create-the-database)
  - [3. Configure environment](#3-configure-environment)
  - [4. Run the app](#4-run-the-app)
- [Demo accounts](#demo-accounts)
- [API reference](#api-reference)
- [Database schema](#database-schema)
- [Presentation build (no database)](#presentation-build-no-database)
- [Available scripts](#available-scripts)
- [Security notes](#security-notes)
- [License](#license)

---

## Features

**Everyone**
- **Role-based access** — Student, University Staff, Agent, Admin, Super Admin and a read-only Report Viewer, each with its own navigation and dashboard.
- **Secure sign-in** — hashed passwords, session tokens, account lockout after repeated failures and optional two-step verification (authenticator app).
- **Sign in / sign up** — login checked against the database, plus a signup and password-reset-request flow (prototype).
- **Notifications** — an in-app Notifications page with an unread badge and pop-up banners for everything that changes on your tickets and account.
- **Settings** — theme (light, dark or follow the device), animations (on, follow device, off), mute and volume, saved in the browser's localStorage, plus an About dialog (v1.0.2).
- **Sound effects** — login, signup, message sent, message received and notification sounds.
- **Works on every screen** — sidebar on desktop, icon rail on tablets, bottom tab bar on phones.

**Students and staff**
- Submit a request with a required category (Hardware, Software, Network / Internet, Account / Login, Printer, Others), priority, location and description.
- Track every request with a live progress tracker (Submitted → In progress → Resolved) and the assigned agent's name.
- Talk to the support team inside each ticket.
- Can't cancel directly: they send a **cancellation request** with a reason, which an admin accepts or rejects.
- If a resolved problem comes back, they can **reopen** the ticket (after a warning, with a reason, up to 3 times).

**Agents**
- A queue of tickets with **recommendations**: tickets matching the agent's skills come first with a "Recommended" badge.
- Tickets outside their skills still appear, but resolving one asks for confirmation with an "at your own risk" warning.
- Ticket conversations and a Facebook-style **chat dock** to message admins and other agents.

**Admins**
- **Manage requests**: review all tickets, assign an agent (skill matches are suggested first) and answer **cancellation requests**.
- **Users**: browse accounts, assign **agent skills**, and switch someone between University Staff and Agent.
- **Password requests**: approve or decline password-change requests.
- Ticket conversations and the admin/agent chat dock.

**Super admin**
- A **Super Admin Panel** for governance: archive old tickets (with a downloadable JSON/CSV backup, never a hard delete) and manage who is an admin or read-only Report Viewer, including lockout and two-step-verification overrides. See [Security and governance](#security-and-governance).
- A **dashboard** with a **Monthly KPI Scorecard**: 15 IT performance metrics (AHT, first response time, SLA compliance, first-time fix rate, reopen rate, backlog and more) of which the super admin picks the ones that matter each month, with their own targets. See [docs/KPI-METRICS.md](docs/KPI-METRICS.md).
- A **Report Manager** that shows the same chosen KPIs (health ring, sparklines, six-month trend with the target line) above the detailed charts (Recharts charts fed by SQL aggregation, skeleton loading, a campus location heat map, date / category / role filters that default to the last 30 days, CSV export) and **Activity Log Reports** of everything users did.

---

## Screenshots

All screenshots are generated from a demo database by [`scripts/capture-screenshots.mjs`](scripts/capture-screenshots.mjs) (see [Regenerating the screenshots](#regenerating-the-screenshots)).

### Sign in

<table>
  <tr>
    <td><img src="docs/screenshots/01-login.png" alt="Login screen, light theme"><br><sub>Login (light)</sub></td>
    <td><img src="docs/screenshots/02-login-dark.png" alt="Login screen, dark theme"><br><sub>Login (dark)</sub></td>
  </tr>
</table>

### Students and staff

<table>
  <tr>
    <td><img src="docs/screenshots/03-student-dashboard.png" alt="Student dashboard"><br><sub>Dashboard with request counts and latest requests</sub></td>
    <td><img src="docs/screenshots/04-submit-request.png" alt="Submit a request form"><br><sub>Submit a request (the category is required)</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/05-my-requests.png" alt="My requests list"><br><sub>My requests with agent and progress</sub></td>
    <td><img src="docs/screenshots/09-notifications.png" alt="Notifications page"><br><sub>Notifications</sub></td>
  </tr>
</table>

**Ticket details and conversation** — details and progress tracker on the left, the conversation with the support team on the right.

![Ticket details and chat](docs/screenshots/06-ticket-details-chat.png)

<table>
  <tr>
    <td><img src="docs/screenshots/07-cancellation-requested.png" alt="Cancellation requested"><br><sub>Cancellation is a request an admin decides on</sub></td>
    <td><img src="docs/screenshots/08-reopen-warning.png" alt="Reopen warning"><br><sub>Reopening a resolved ticket starts with a warning</sub></td>
  </tr>
</table>

### Agents

<table>
  <tr>
    <td><img src="docs/screenshots/18-agent-dashboard.png" alt="Agent dashboard"><br><sub>Dashboard</sub></td>
    <td><img src="docs/screenshots/19-agent-queue.png" alt="Agent queue with recommendations"><br><sub>Queue with skill-based recommendations</sub></td>
  </tr>
</table>

![Out-of-skill warning](docs/screenshots/20-out-of-skill-warning.png)

### Admins

<table>
  <tr>
    <td><img src="docs/screenshots/21-admin-manage-requests.png" alt="Admin request management"><br><sub>Request management with the cancellation queue</sub></td>
    <td><img src="docs/screenshots/22-assign-agent.png" alt="Assign an agent"><br><sub>Assigning an agent (skill matches first)</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/23-users-and-skills.png" alt="Users and agent skills"><br><sub>Users and agent skills</sub></td>
    <td><img src="docs/screenshots/24-password-requests.png" alt="Password requests"><br><sub>Password-change requests</sub></td>
  </tr>
</table>

**Admin / agent chat dock** — a Facebook-style chat in the bottom-right corner; every message shows the sender's name and role.

![Chat dock](docs/screenshots/25-chat-dock.png)

### Super admin

<table>
  <tr>
    <td><img src="docs/screenshots/28-activity-log.png" alt="Activity log reports"><br><sub>Activity log reports</sub></td>
  </tr>
</table>

**Report Manager** — the month's chosen KPIs sit on top (with a health ring, sparklines and a KPI trend chart), followed by the detail behind them: filters (last 30 days by default), volume, status, priority, category, role, a campus heat map and CSV export (which includes the KPI values).

![Report Manager](docs/screenshots/27-report-manager.png)

**Monthly KPI scorecard** — the dashboard shows the KPIs chosen for the month, each with its target, status and change versus last month. "Choose KPIs" picks the month's metrics and targets from the catalog of 15 (full definitions in [docs/KPI-METRICS.md](docs/KPI-METRICS.md)).

<table>
  <tr>
    <td><img src="docs/screenshots/26-superadmin-dashboard.png" alt="Super admin dashboard with the KPI scorecard"><br><sub>Dashboard with the scorecard</sub></td>
    <td><img src="docs/screenshots/30-kpi-picker.png" alt="Choosing the month's KPIs"><br><sub>Choosing the month's KPIs and targets</sub></td>
  </tr>
</table>

### Settings, themes and About

<table>
  <tr>
    <td><img src="docs/screenshots/10-settings.png" alt="Settings dialog"><br><sub>Settings</sub></td>
    <td><img src="docs/screenshots/11-about.png" alt="About dialog"><br><sub>About</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/12-student-dashboard-dark.png" alt="Student dashboard in dark mode"><br><sub>Dark mode dashboard</sub></td>
    <td><img src="docs/screenshots/13-ticket-details-dark.png" alt="Ticket popup in dark mode"><br><sub>Dark mode ticket popup</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td><img src="docs/screenshots/31-superadmin-dashboard-dark.png" alt="KPI scorecard in dark mode"><br><sub>Dark mode scorecard</sub></td>
  </tr>
</table>

![Report Manager in dark mode](docs/screenshots/29-report-manager-dark.png)

### On a phone

<table>
  <tr>
    <td><img src="docs/screenshots/14-mobile-dashboard.png" alt="Phone dashboard" width="240"><br><sub>Dashboard</sub></td>
    <td><img src="docs/screenshots/15-mobile-ticket-chat.png" alt="Phone ticket chat" width="240"><br><sub>Ticket chat</sub></td>
    <td><img src="docs/screenshots/16-mobile-ticket-details.png" alt="Phone ticket details" width="240"><br><sub>Ticket details</sub></td>
    <td><img src="docs/screenshots/17-mobile-notifications.png" alt="Phone notifications" width="240"><br><sub>Notifications</sub></td>
  </tr>
</table>

### Regenerating the screenshots

The screenshots come from a throwaway demo database, never your real one:

1. Make a copy of `server/schema.sql` with `helpdesk` renamed to `helpdesk_demo` (the `CREATE DATABASE` and `USE` lines) and run it in MySQL.
2. Start the API on that database and a dev server pointed at it:
   ```bash
   DB_NAME=helpdesk_demo PORT=3002 node server/index.js
   API_TARGET=http://localhost:3002 npx vite --port 5175
   ```
   (Git Bash syntax; in PowerShell set `$env:DB_NAME="helpdesk_demo"` first.)
3. Fill it with sample tickets and chats: `DB_NAME=helpdesk_demo node scripts/seed-demo-data.mjs http://localhost:3002`
4. Capture: `node scripts/capture-screenshots.mjs http://localhost:5175` (uses Chrome or Edge through `puppeteer-core`; set `CHROME_PATH` for another browser).

---
## HelpDesk Assistant (ticket chatbot)

Every ticket conversation starts with the **HelpDesk Assistant**, a guided chatbot that talks to the person who submitted the ticket. Instead of typing, the requester taps **multiple-choice buttons** and the assistant answers. It is rule-based (no external AI service, no cost) and everything it says is saved in the conversation, so staff can see what was already covered.

- **Greeting on submit** with quick-reply buttons, and a note on **who is available**: if an agent or admin is online it says they can chat now; if the whole team is offline it says so and keeps helping. A green/grey banner above the chat shows the same thing live.
- **Where is my ticket?** status, assigned agent, queue position and how long it has waited.
- **Quick fixes** for the ticket's category (Hardware, Software, Network, Account, Printer) with numbered steps and a "Did that fix it?" loop. If it worked, the assistant offers to send a cancellation request (an admin still approves it); if not, it passes **what was tried** to the agent so nobody repeats themselves.
- **How long will it take?** the target time for the ticket's priority.
- **It's urgent**: pick a reason and the admins/agent are notified (rate-limited, the priority is not changed automatically).
- **Talk to an agent**: when an agent or admin is online they are told and can chat in the same thread; when everyone is offline the requester is told, can leave a message, and the agents and admins are notified for when they return.
- **After resolution** the assistant asks for a 1-5 star rating (stored in `tickets.csat_rating`); a low rating alerts the admins and offers to reopen. It can also reopen the ticket with a reason.
- **Understands typed messages too**: if the requester types instead of tapping, the assistant matches keywords (urgent, how long, status, cancel, talk to an agent, thanks, or a problem such as printer, Wi-Fi, password) and answers automatically. It stays quiet while an agent or admin has replied in the last 10 minutes, so people never get talked over, and it only repeats its "I didn't understand" message once. It is keyword-based (no external AI service). It understands **Tagalog** as well: typed Tagalog (for example "ayaw mag-print", "gaano katagal po?", "nasaan na ang ticket ko") gets a Tagalog reply and Tagalog buttons; the step-by-step fix instructions stay in English.
- **Assistant notes** for agents and admins only (what the requester tried, urgency, low rating) appear to agents and admins but are hidden from the requester.

Design ideas taken from Intercom, Zendesk, ServiceNow and Freshdesk: guided buttons over free text, self-service before escalation, a clear human hand-off with context, actions as well as answers, and a satisfaction survey after resolution. The code is in `server/bot.js` (conversation tree and knowledge base: add new fixes to the `KNOWLEDGE` object) and the UI is in `src/TicketChat.jsx`. SQL for an existing database: `server/migrations/2026-10-chatbot.sql`.

## Smart intake and automatic priority

The ticket form no longer asks the requester to pick a priority or type a location.

- **Structured location**: a cascading **Campus zone > Building > Room** dropdown fed by the `locations` table (no free text). It shows a loading state while the list loads and a Try again link if it fails.
- **Two mandatory questions**: *Who is affected?* (Just me / My entire class / The whole building) and *When do you need this?* (Right now for a live class / Within 2 days / Next week).
- **Priority matrix** (`server/priority.js`, a pure function with unit tests): impact x urgency gives P1 to P4. Organization: High P1, Medium P1, Low P2. Department: High P1, Medium P2, Low P3. Individual: High P2, Medium P3, Low P4.
- **Escalation**: if the description contains *Exam*, *Graduation*, *Lecture* or *Dean*, or `IS_FINALS_WEEK` is on (start the API with `FINALS_WEEK=true`), the tier goes up by one (P1 stays P1, and it only ever goes up one step).
- The tier is stored in `tickets.priority_tier` with `impact_level`, `urgency_level` and `location_id`. The older High / Medium / Low label (P1 and P2 = High, P3 = Medium, P4 = Low) is still stored so reports, KPIs and SLA targets keep working.
- **Queue-safe cancellation**: `PUT /api/tickets/:id/cancel` (admin) sets the status to Cancelled only while the ticket is Open or In Progress, never deletes the row, and the agent's active load drops immediately. Requesters still use the approval-based cancellation request.

SQL for an existing database: `server/migrations/2026-10-priority-locations.sql`.

## Auto-assignment with a 30-minute expiry

Admins can still assign any ticket by hand. When they do not, the system takes over (`server/autoassign.js`, checked every minute):

- A ticket that stays **Open for 30 minutes** is assigned to an agent whose **skills match its category** (Hardware, Software, Network / Internet, Account / Login, Printer).
- An auto-assigned ticket that is **not resolved 30 minutes after assignment expires**: it moves to a different agent with the same specialty, and the conversation, the old agent, the new agent, the requester and the admins are told.
- Among matching agents it prefers one who is **online**, then the **lightest load**, then whoever has waited longest for work, and it rotates so the ticket does not bounce between the same two people.
- A ticket assigned **by an admin is pinned** and never moved automatically (an admin can reassign it at any time). Reopening a resolved ticket restarts the 30 minutes.
- If no agent has the skill (or the current agent is the only specialist), the ticket stays where it is, the timer restarts and the admins get a notification.
- Settings (environment variables): `AUTO_ASSIGN_MINUTES` (default 30), `AUTO_ASSIGN_CHECK_SECONDS` (60), `AUTO_ASSIGN=false` to switch it off. Assignment history is stored in `ticket_assignments`.
- The ticket details show when the next automatic move will happen. Unit tests: `npm test`. SQL for an existing database: `server/migrations/2026-10-autoassign.sql` (run `2026-10-roles.sql` too if you still have the old Employee / Technician roles).

## Photos, help articles, history, alerts and backups

- **Photo attachments**: add up to 3 pictures when submitting a request, and a 📎 button in the ticket chat (8 per ticket). Pictures are shrunk in the browser, checked by their real content on the server (PNG, JPEG, GIF, WebP only; SVG and web pages are refused), stored under random names and shown only to the people on the ticket.
- **Help articles**: a page for everyone with search and categories, written and edited by admins (drafts, views, "was this helpful" counts). The HelpDesk Assistant suggests the matching articles when someone types a question and from **More help**.
- **Ticket history**: the ticket details have a "History: who changed what" list (submitted, assigned by whom, automatic reassignments, status changes, cancellations, reopening, photos, rating, closing).
- **Auto-close**: a resolved ticket is closed for good after 3 days (`AUTO_CLOSE_DAYS`). It stays "Resolved" in every report, but cannot be reopened any more; the ticket shows "Reopen until ..." beforehand.
- **Live updates**: new notifications and chat messages appear at once (Server-Sent Events). If the live connection drops, the pages fall back to checking every few seconds.
- **Email and text alerts**: agents get an email when a ticket is assigned or reassigned, admins when a P1 (urgent) request arrives, requesters when their problem is resolved. Everyone can switch them off (and add a mobile number for urgent texts) under *Profile > Email and text alerts*. Turn emails on with the `SMTP_*` settings in `server/.env` (see `server/.env.example`); texts need a provider's URL in `SMS_WEBHOOK_URL`. `MAIL_MODE=log` prints the emails in the server window for testing.
- **Backups**: a compressed copy of the whole database is made every day (default 2 AM, the newest 14 kept) in `backups/daily/`, with no extra programs needed. The super admin can see, download and create one in the Super Admin Panel. Restore with `node scripts/restore-backup.mjs backups/daily/<file>.sql.gz`.
- **Satisfaction (CSAT)** is the 16th KPI: the average star rating requesters give the assistant after a resolution.
- **Sign-in safety**: after 5 wrong attempts the sign-in page locks for 10 seconds with a countdown; another wrong attempt afterwards shows **Forgot password?**, which for now only explains that email reset is coming in the next version. Ten wrong passwords in a row lock the account for 15 minutes.

Putting it on the internet (HTTPS, hosting, backups): [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). SQL for an existing database: `server/migrations/2026-10-features.sql` (applied automatically at startup).

## Security and governance

**Sign-in and sessions**
- Passwords are stored as **scrypt hashes**. Older plaintext rows from the seed data are upgraded to a hash the first time they are used.
- Logging in returns a **JWT session token** (8 hours). Every API call except login, signup and the health check must send it (`Authorization: Bearer ...`), and the user is re-read from the database on each request, so a revoked admin loses access immediately.
- The server stamps the caller's id on every "acting user" field (`userId`, `actorId`, `senderId`, `createdBy`, `reviewedBy`), so one user can't act as another by editing a request. Requesters only ever receive their own tickets and password requests.
- The session survives a page refresh (it lives in `sessionStorage`) and ends when the tab closes or you log out.
- **Account lockout**: 5 wrong passwords or codes in a row lock the account for 15 minutes. A super admin can clear it.
- **Two-step verification** (authenticator app, TOTP) for agents, admins, report viewers and the super admin: set it up from the profile. Lost phone? A super admin resets it.
- Sessions are signed with `JWT_SECRET` if you set it in the environment; otherwise a random secret is created on first start and kept in `server/.jwt-secret` (gitignored), so sessions survive restarts.

**Roles**
- `report_viewer` is a **read-only** role: it sees the dashboards, KPIs, Report Manager and activity log (so the super admin does not need to log in for daily reporting) and every write is refused by the server. `verifyReportViewer` allows Super Admin and Report Viewer on the analytics endpoints; `verifySuperAdmin` guards everything that writes governance data.

**Super Admin panel** (Super Admin only)

<table>
  <tr>
    <td><img src="docs/screenshots/32-super-admin-panel.png" alt="Super admin panel"><br><sub>Archiving and privileged accounts</sub></td>
  </tr>
</table>

- **Archiving**: pick a retention date (finished tickets last active before it; at least the last 30 days always stay), check how many tickets would move, then **Mass Export & Archive** (you type `ARCHIVE` to confirm). In one SQL transaction the tickets, their conversations and cancellation requests are copied into `tickets_archive`, `ticket_messages_archive` and `cancellation_requests_archive`, a **JSON and CSV backup** is written to `backups/archives/`, and only then are they removed from the live tables. Each run is recorded in `archive_runs` with download buttons. Nothing is permanently deleted, and new ticket numbers never reuse archived ones.
- **IT Ops Admins & Report Viewers**: a table of privileged accounts with **Revoke access**, **Override lockout** and **Reset MFA**, plus a form to grant Admin or Report Viewer access to a staff member or agent.

The SQL for all of this (only the new tables and columns) is in [`server/migrations/2026-10-enterprise.sql`](server/migrations/2026-10-enterprise.sql).

---

## Tech stack

| Layer      | Technology                          |
| ---------- | ----------------------------------- |
| Frontend   | React 19, Vite 8                    |
| Backend    | Node.js, Express 5                  |
| Database   | MySQL (via `mysql2`)                |
| Config     | dotenv                              |
| Linting    | oxlint                              |

---

## Project structure

```
my-react-app/
├─ docs/                   # KPI-METRICS.md and the screenshots used in this README
├─ public/                 # Static assets served as-is (sound effects in sounds/)
├─ scripts/                # DB backup, demo-data seeding and screenshot capture
├─ server/                 # Express + MySQL backend
│  ├─ auth.js              # JWT middleware: authenticate, verifyReportViewer, verifySuperAdmin
│  ├─ security.js          # Password hashing, JWT and two-step (TOTP) helpers
│  ├─ superadmin.js        # Archiving pipeline + privileged-account management
│  ├─ kpi.js, kpiCatalog.js # Monthly KPI calculation and the metric catalog
│  ├─ migrations/          # SQL for upgrading an existing database
│  ├─ db.js                # MySQL connection pool + query helper
│  ├─ index.js             # API server and the remaining routes
│  ├─ schema.sql           # Database schema + seed data
│  └─ .env                 # Your DB credentials (create it; gitignored)
├─ src/                    # React frontend
│  ├─ api.js               # Fetch client for the /api backend (attaches the session token)
│  ├─ hooks/               # Logic hooks for the super admin panel (useArchive, useAdminManagement)
│  ├─ SuperAdminPanel.jsx  # Super admin settings UI (ArchivePanel + AdminTable)
│  ├─ App.jsx              # Main application (all views/components)
│  ├─ App.css              # Application styles
│  ├─ index.css            # Base styles
│  └─ main.jsx             # React entry point
├─ presentation/index.html  # Standalone localStorage demo (no backend)
├─ vite.config.js          # Vite config incl. /api dev proxy
└─ package.json
```

---

## Getting started

### The easy way (Windows with XAMPP)

1. Install [Node.js](https://nodejs.org) (version 20 or newer) and XAMPP.
2. Double-click **`start.bat`** (or run `npm start` in a terminal).

That is all. The script installs the packages the first time, starts MySQL from XAMPP if it is not already running, builds the website, creates the `helpdesk` database with the demo accounts on the first run, starts the server and opens your browser at **http://localhost:3001**. Everything runs on one port. Press `Ctrl+C` to stop.

- **No setup files needed.** The defaults are `root` with no password on `localhost:3306`. Only if your MySQL is different, copy `server/.env.example` to `server/.env` and change the values.
- **Updating an older database is automatic.** When the server starts it applies any missing files from `server/migrations/` (they are never run twice). Nothing is dropped from a database that already has data.
- **Developing?** `npm run dev:all` runs the server and the live-reload website together (http://localhost:5173).
- **Another computer or macOS / Linux?** Install Node.js and any MySQL / MariaDB server, then run `npm start`. If MySQL is not on `localhost:3306`, put its address in `server/.env`.

### Doing it step by step

| Command | What it does |
| --- | --- |
| `npm install` | Installs the packages. |
| `npm run server` | Starts the API (creates / updates the database first). Also serves the website once `npm run build` has been run. |
| `npm run dev` | Live-reload website on http://localhost:5173 (needs the API running). |
| `npm run db:init` | Optional: wipes and recreates the database from `server/schema.sql` (asks for the MySQL password). |

### Checking that everything works

| Command | What it checks |
| --- | --- |
| `npm test` | Unit tests for the priority matrix and the auto-assign rules. |
| `API=http://localhost:3001/api npm run qa` | About 140 API checks: sign-in, access control, validation, parallel requests, speed. |
| `DB_NAME=helpdesk_demo API=http://localhost:3002/api node scripts/qa-deep.mjs` | Archiving, two-step verification, password requests, role changes. |
| `npm run qa:ui -- http://localhost:3001` | Opens every page for every role on desktop and phone sizes and reports errors and overflow. |

Run the checks on a demo database (they create test tickets and accounts), never on real data.

---

## Demo accounts

Most seed accounts share the ID `2404154`; select the matching role on the login screen. The two extran agents exist so skill recommendations can be tried out.

| Role                       | ID        | Password            |
| -------------------------- | --------- | ------------------- |
| Student                    | `2404154` | `123456student`     |
| University Staff        | `2404154` | `123456employee`    |
| Agent (Hardware, Printer) | `2404154` | `123456technician` |
| Software Agent (Software, Account / Login) | `2404155` | `123456technician` |
| Network Agent (Network / Internet) | `2404156` | `123456technician` |
| Student / Staff Admin   | `2404154` | `123456admin`       |
| Super Admin                | `2404154` | `123456superadmin`  |
| Report Viewer (read-only)  | `2404154` | `123456viewer`      |

---

## API reference

Base path: `/api` (proxied to `http://localhost:3001` in development).

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| GET | `/api/health` | Health check; verifies the DB connection. |
| POST | `/api/login` | Authenticate. Body: `{ id, password, role }`. Returns a session `token`, or `{ mfaRequired, mfaToken }` when two-step verification is on. All other routes (except signup and health) need `Authorization: Bearer <token>`. |
| POST | `/api/login/mfa` | Second step. Body: `{ mfaToken, code }`. |
| GET | `/api/me` | The signed-in user (used to restore a session after a refresh). |
| POST | `/api/mfa/setup`, `/api/mfa/enable`, `/api/mfa/disable` | Two-step verification for agent, admin and report viewer accounts. |
| GET | `/api/superadmin/overview` | Super admin only. Active / archived ticket counts. |
| POST | `/api/superadmin/archive` | Super admin only. Body: `{ before: "2023-10-08", dryRun?, confirm? }`. Exports then archives finished tickets older than the date, in one transaction. |
| GET | `/api/superadmin/archive/runs` | Super admin only. Archive history. |
| GET | `/api/superadmin/archive/runs/:id/download?format=json\|csv` | Super admin only. Download a backup file. |
| GET | `/api/superadmin/admins` | Super admin only. Admins, report viewers and people who could be given access. |
| PUT | `/api/superadmin/manage-admins/:id` | Super admin only. Body: `{ action: "revoke" \| "grant" \| "grant_viewer" \| "unlock" \| "reset_mfa" }`. |
| POST | `/api/signup` | Create a student or staff account. |
| GET | `/api/tickets` | List tickets (newest first); `?mine=1&userId=` limits to one requester. Includes `location` and `createdAt`. |
| POST | `/api/tickets` | Create a ticket. Body: `{ subject, category, locationId, impactLevel, urgencyLevel, description }`. The server calculates the P1-P4 tier (any `priority` sent is ignored) and returns `priorityTier`. |
| GET / POST | `/api/tickets/:id/attachments`, GET `/api/attachments/:id` | List / add photos (base64 JSON, 5 MB each) and fetch one. |
| GET | `/api/tickets/:id/history` | Who changed what on the ticket. |
| GET / POST / PUT / DELETE | `/api/kb`, `/api/kb/:id`, POST `/api/kb/:id/feedback` | Help articles (writing is admin only). |
| POST / GET | `/api/events/ticket`, `/api/events` | Live updates: single-use ticket, then the event stream. |
| GET / PATCH | `/api/me/alerts` | Email and text alert settings of the signed-in user. |
| GET / POST | `/api/superadmin/backups`, GET `/api/superadmin/backups/:name/download` | List, create and download database backups. |
| POST | `/api/forgot-password` | Accepts an email, changes nothing (announced for the next version). |
| GET | `/api/locations` | Rooms for the cascading Campus zone > Building > Room dropdown. |
| PUT | `/api/tickets/:id/cancel` | Admin only. Queue-safe cancel: `UPDATE ... WHERE status IN ('Open','In Progress')`; the row is kept, a second call gets 409. |
| GET | `/api/agents/workload` | Admin only. Active (Open / In Progress) tickets per agent. |
| PATCH | `/api/tickets/:id/status` | Set status to Open, In Progress or Resolved. |
| PATCH | `/api/tickets/:id/assign` | Admin only. Body: `{ actorId, agentId }`; sets the agent and moves the ticket to In Progress. |
| GET | `/api/tickets/:id/participants` | Who is in the ticket conversation: requester, assigned agent, admins. |
| POST | `/api/tickets/:id/bot` | Requester picks one of the assistant's options. Body: `{ choice }`. Returns the new messages. |
| GET | `/api/tickets/:id/availability` | Which agents/admins are online (used for the chat banner). |
| GET / POST | `/api/tickets/:id/messages` | Ticket conversation. POST body: `{ userId, text }`. |
| POST | `/api/tickets/:id/reopen` | Owner reopens a Resolved ticket. Body: `{ userId, reason }`; max 3 reopens. |
| POST / GET | `/api/tickets/:id/cancellation-requests` | Owner files a cancellation request (`{ userId, reason }`) / lists the ticket's requests. |
| GET | `/api/cancellation-requests?userId=` | Admin queue of all cancellation requests. |
| PATCH | `/api/cancellation-requests/:code/status` | Admin accepts (ticket becomes Cancelled) or rejects. Body: `{ actorId, status, note? }`. |
| GET | `/api/reports/summary?userId=&from=&to=&category=&role=` | Super admin only. SQL-aggregated data for the Report Manager. |
| GET | `/api/kpi/trend?userId=&month=2026-10&count=6` | Super admin only. The last N months of every KPI (sparklines and the trend chart). |
| GET | `/api/kpi?userId=&month=2026-10` | Super admin only. Every KPI value for the month and the previous one, the catalog, and the selected metrics. |
| PUT | `/api/kpi/selection` | Super admin only. Body: `{ userId, month, metrics: [{ key, target? }] }`. |
| GET | `/api/notifications?userId=` | Latest notifications and unread count. |
| POST | `/api/notifications/read` | Mark notifications read. Body: `{ userId, ids? }` (all when `ids` is omitted). |
| GET / POST | `/api/activities` | List or add activity log entries. |
| GET | `/api/users` | List users, including each agent's `skills`. |
| PATCH | `/api/users/:userId/skills` | Admin only. Body: `{ actorId, skills: [...] }`. |
| PATCH | `/api/users/:userId/role` | Admin only. Body: `{ actorId, role }` where role is `staff` or `agent`; clears skills when leaving agent. |
| GET | `/api/profile/:userId` | Account details for the profile panel. |
| GET / POST | `/api/password-requests` | List or file password-change requests. |
| PATCH | `/api/password-requests/:code/status` | Approve or reject a password-change request. |
| GET | `/api/messages/contacts?userId=` | Chat contacts with last message and unread count (admins and agents only). |
| GET | `/api/messages?userId=&withId=` | Conversation with one contact; marks their messages read. |
| POST | `/api/messages` | Send a message. Body: `{ senderId, recipientId, body }`. |

All queries use parameterized statements to guard against SQL injection.

---

## Database schema

The `helpdesk` database contains these tables (see `server/schema.sql` for full definitions):

- **`users`** — accounts with `id_number`, `password`, `name`, `role`, `role_name`, `email`, and `skills` (comma-separated ticket categories, used for agents).
- **`tickets`** — support requests with a unique `code` (e.g. `#HD001`), `subject`, `category`, `priority`, `status`, and optional `location`/`description`. Links back to `users` via `created_by`.
- **`activities`** — audit log of actor name, role, action, and timestamp.
- **`password_requests`** — password-change requests awaiting admin approval.
- **`ticket_messages`** — per-ticket conversation, including cancellation requests and the assistant's messages (`kind`: `bot`, `bot_choice`, `bot_note`; `meta` holds its quick-reply options).
- **`cancellation_requests`** — requester-initiated cancellation requests awaiting an admin decision.
- **`notifications`** — per-user in-app notifications with a read timestamp.
- **`tickets_archive`, `ticket_messages_archive`, `cancellation_requests_archive`** — same structure as the live tables; finished tickets (with their conversations) older than the retention date are moved here. **`archive_runs`** records each archive run. The **`tickets_all`** view (live + archived) feeds reports and KPIs so archiving never changes history.
- **`kpi_selections`** — which KPI metrics (and targets) the super admin chose for each month.
- **`messages`** — chat messages between admins and agents, with a read timestamp.

Re-running `schema.sql` drops and recreates the tables, restoring the seed data. If you already have a database from an earlier version, add the new pieces by hand instead (`ALTER TABLE users ADD COLUMN skills ...`, `ALTER TABLE tickets ADD COLUMN assigned_to ...` and `reopen_count INT NOT NULL DEFAULT 0`, the security columns on `users` (`failed_logins`, `locked_until`, `mfa_enabled`, `mfa_secret`, `last_login_at`), the archive tables and the `tickets_all` view (all in `server/migrations/2026-10-enterprise.sql`), the three KPI timestamps (`assigned_at`, `first_response_at`, `resolved_at`, all `TIMESTAMP NULL`) and the `kpi_selections` table, and the `messages`, `ticket_messages`, `cancellation_requests` and `notifications` tables from `schema.sql`) to avoid losing data.

---

## Presentation build (no database)

`presentation/index.html` is a single self-contained file that runs the entire app in the browser with **no backend and no build step**. It uses React and Babel from a CDN, and replaces the API with a `localStorage`-backed store seeded with the same demo data.

To use it:

1. Open `presentation/index.html` in any modern browser.
2. Log in with any [demo account](#demo-accounts).
3. Submit tickets and perform actions — everything persists in `localStorage` across page refreshes.

Because React and Babel load from a CDN, the machine needs internet access the first time it opens the file. This build is intended for demos and presentations, not production.

---

## Available scripts

| Script            | Description                                    |
| ----------------- | ---------------------------------------------- |
| `npm run dev`     | Start the Vite dev server (frontend).          |
| `npm run server`  | Start the Express API server.                  |
| `npm run db:init` | Import `server/schema.sql` into MySQL.         |
| `npm test`        | Unit tests for the priority matrix (`server/priority.test.js`). |
| `npm run build`   | Build the frontend for production (`dist/`).   |
| `npm run preview` | Preview the production build locally.          |
| `npm run lint`    | Run oxlint.                                    |

---

## Backup and recovery

`scripts/backup-database.bat` dumps the database with `mysqldump` to `backups/backup_YYYY-MM-DD_HH-mm-ss.sql` (gitignored), logs to `backups/backup.log`, and deletes backups older than 14 days. Edit the settings at the top of the script (`DB_NAME` is `helpdesk` by default; also `DB_USER`, `DB_PASS`, `MYSQL_BIN`, `KEEP_DAYS`).

**Run it daily at 2:00 AM with Task Scheduler**

1. Press Win, type *Task Scheduler*, open it, then choose **Create Task...** (not *Create Basic Task*).
2. **General**: name it `HelpDesk DB Backup`; tick *Run whether user is logged on or not* and *Run with highest privileges*.
3. **Triggers** > *New...*: *Daily*, start `2:00:00 AM`, recur every 1 day > OK.
4. **Actions** > *New...*: *Start a program*. Program/script: `C:\xampp\htdocs\my-react-app\scripts\backup-database.bat`. Start in: `C:\xampp\htdocs\my-react-app\scripts` > OK.
5. **Settings**: tick *Run task as soon as possible after a scheduled start is missed* (for a PC that is off at 2 AM) > OK, then enter your Windows password.
6. Right-click the task > *Run*, then check `backups\backup.log`.

One-line alternative (Command Prompt opened as Administrator):

```
schtasks /Create /TN "HelpDesk DB Backup" /SC DAILY /ST 02:00 /RL HIGHEST /TR "C:\xampp\htdocs\my-react-app\scripts\backup-database.bat"
```

MySQL (XAMPP) must be running at 2 AM, otherwise the backup fails and `backup.log` says FAILED.

**Restore** (use Command Prompt, because PowerShell does not support the `<` redirect; swap in your own file name):

```
C:\xampp\mysql\bin\mysql.exe -u root -e "CREATE DATABASE IF NOT EXISTS helpdesk CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
C:\xampp\mysql\bin\mysql.exe -u root -p helpdesk < C:\xampp\htdocs\my-react-app\backups\backup_2026-10-03_02-00-00.sql
```

The dump drops and recreates each table, so restoring overwrites the current data. From PowerShell, wrap the second command: `cmd /c "mysql.exe ... < file"`.

## Security notes

This is a prototype. Before any real deployment:

- **Passwords are stored in plaintext** to keep the demo simple. Hash them with bcrypt and compare hashes in the `/api/login` route.
- Add session/token-based authentication and authorization checks on protected endpoints.
- Never commit `server/.env` — it is gitignored by default.
- Agent assignments are stored in the browser (`localStorage`), not the database.
- The messaging and skills endpoints trust the user IDs sent by the client; they need real session checks before production.
- The presentation build does not include the skills or chat features.

---

## License

This project is provided as-is for educational and demonstration purposes.
