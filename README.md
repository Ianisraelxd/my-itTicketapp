# Campus HelpDesk

A role-based IT support desk for a campus, built with **React + Vite**, backed by a small **Express + MySQL** API. Students and employees can submit and track support requests, technicians work their assigned queue, and admins manage users, tickets, and activity logs.

The project ships in two forms:

1. **Full app** — React frontend + Express API + MySQL database (real persistence).
2. **Presentation build** — a single self-contained `presentation/index.html` that runs the whole UI in the browser using `localStorage` instead of a database. No backend, no build step.

---

## Table of contents

- [Features](#features)
- [Screenshots](#screenshots)
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
- **Role-based access** — Student, Employee, Technician, Admin and Super Admin, each with its own navigation and dashboard.
- **Sign in / sign up** — login checked against the database, plus a signup and password-reset-request flow (prototype).
- **Notifications** — an in-app Notifications page with an unread badge and pop-up banners for everything that changes on your tickets and account.
- **Settings** — theme (light, dark or follow the device), animations (on, follow device, off), mute and volume, saved in the browser's localStorage, plus an About dialog (v1.0.2).
- **Sound effects** — login, signup, message sent, message received and notification sounds.
- **Works on every screen** — sidebar on desktop, icon rail on tablets, bottom tab bar on phones.

**Students and employees**
- Submit a request with a required category (Hardware, Software, Network / Internet, Account / Login, Printer, Others), priority, location and description.
- Track every request with a live progress tracker (Submitted → In progress → Resolved) and the assigned technician's name.
- Talk to the support team inside each ticket.
- Can't cancel directly: they send a **cancellation request** with a reason, which an admin accepts or rejects.
- If a resolved problem comes back, they can **reopen** the ticket (after a warning, with a reason, up to 3 times).

**Technicians**
- A queue of tickets with **recommendations**: tickets matching the technician's skills come first with a "Recommended" badge.
- Tickets outside their skills still appear, but resolving one asks for confirmation with an "at your own risk" warning.
- Ticket conversations and a Facebook-style **chat dock** to message admins and other technicians.

**Admins**
- **Manage requests**: review all tickets, assign a technician (skill matches are suggested first) and answer **cancellation requests**.
- **Users**: browse accounts, assign **technician skills**, and switch someone between Employee and Technician.
- **Password requests**: approve or decline password-change requests.
- Ticket conversations and the admin/technician chat dock.

**Super admin**
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

### Students and employees

<table>
  <tr>
    <td><img src="docs/screenshots/03-student-dashboard.png" alt="Student dashboard"><br><sub>Dashboard with request counts and latest requests</sub></td>
    <td><img src="docs/screenshots/04-submit-request.png" alt="Submit a request form"><br><sub>Submit a request (the category is required)</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/05-my-requests.png" alt="My requests list"><br><sub>My requests with technician and progress</sub></td>
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

### Technicians

<table>
  <tr>
    <td><img src="docs/screenshots/18-technician-dashboard.png" alt="Technician dashboard"><br><sub>Dashboard</sub></td>
    <td><img src="docs/screenshots/19-technician-queue.png" alt="Technician queue with recommendations"><br><sub>Queue with skill-based recommendations</sub></td>
  </tr>
</table>

![Out-of-skill warning](docs/screenshots/20-out-of-skill-warning.png)

### Admins

<table>
  <tr>
    <td><img src="docs/screenshots/21-admin-manage-requests.png" alt="Admin request management"><br><sub>Request management with the cancellation queue</sub></td>
    <td><img src="docs/screenshots/22-assign-technician.png" alt="Assign a technician"><br><sub>Assigning a technician (skill matches first)</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/23-users-and-skills.png" alt="Users and technician skills"><br><sub>Users and technician skills</sub></td>
    <td><img src="docs/screenshots/24-password-requests.png" alt="Password requests"><br><sub>Password-change requests</sub></td>
  </tr>
</table>

**Admin / technician chat dock** — a Facebook-style chat in the bottom-right corner; every message shows the sender's name and role.

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
│  ├─ db.js                # MySQL connection pool + query helper
│  ├─ index.js             # API server and routes
│  ├─ schema.sql           # Database schema + seed data
│  └─ .env                 # Your DB credentials (create it; gitignored)
├─ src/                    # React frontend
│  ├─ api.js               # Fetch client for the /api backend
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

### Prerequisites

- **Node.js** 18+ and npm
- **MySQL** server (local install, Docker, XAMPP, etc.)
- The `mysql` CLI on your PATH (only needed for the `db:init` script — you can use any MySQL client instead)

### 1. Install dependencies

```bash
npm install
```

### 2. Create the database

Import the schema and seed data:

```bash
npm run db:init
```

This runs `mysql -u root -p < server/schema.sql`, which creates the `helpdesk` database, its tables, and seed rows. Enter your MySQL password when prompted. If your MySQL user is not `root`, run `server/schema.sql` manually with your preferred client.

### 3. Configure environment

Create `server/.env` (gitignored) with your MySQL credentials:

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=helpdesk
PORT=3001
```

### 4. Run the app

Start the API in one terminal:

```bash
npm run server
```

Start the frontend in another:

```bash
npm run dev
```

Open the Vite URL shown in the terminal (default `http://localhost:5173`). API requests to `/api` are proxied to the backend on port `3001`.

---

## Demo accounts

Most seed accounts share the ID `2404154`; select the matching role on the login screen. The two extra technicians exist so skill recommendations can be tried out.

| Role                       | ID        | Password            |
| -------------------------- | --------- | ------------------- |
| Student                    | `2404154` | `123456student`     |
| Employee                   | `2404154` | `123456employee`    |
| Technician (Hardware, Printer) | `2404154` | `123456technician` |
| Software Technician (Software, Account / Login) | `2404155` | `123456technician` |
| Network Technician (Network / Internet) | `2404156` | `123456technician` |
| Student / Employee Admin   | `2404154` | `123456admin`       |
| Super Admin                | `2404154` | `123456superadmin`  |

---

## API reference

Base path: `/api` (proxied to `http://localhost:3001` in development).

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| GET | `/api/health` | Health check; verifies the DB connection. |
| POST | `/api/login` | Authenticate. Body: `{ id, password, role }`. |
| POST | `/api/signup` | Create a student or employee account. |
| GET | `/api/tickets` | List tickets (newest first); `?mine=1&userId=` limits to one requester. Includes `location` and `createdAt`. |
| POST | `/api/tickets` | Create a ticket. Body: `{ subject, category, priority, location?, description?, createdBy? }`. |
| PATCH | `/api/tickets/:id/status` | Set status to Open, In Progress or Resolved. |
| PATCH | `/api/tickets/:id/assign` | Admin only. Body: `{ actorId, technicianId }`; sets the technician and moves the ticket to In Progress. |
| GET | `/api/tickets/:id/participants` | Who is in the ticket conversation: requester, assigned technician, admins. |
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
| GET | `/api/users` | List users, including each technician's `skills`. |
| PATCH | `/api/users/:userId/skills` | Admin only. Body: `{ actorId, skills: [...] }`. |
| PATCH | `/api/users/:userId/role` | Admin only. Body: `{ actorId, role }` where role is `employee` or `technician`; clears skills when leaving technician. |
| GET | `/api/profile/:userId` | Account details for the profile panel. |
| GET / POST | `/api/password-requests` | List or file password-change requests. |
| PATCH | `/api/password-requests/:code/status` | Approve or reject a password-change request. |
| GET | `/api/messages/contacts?userId=` | Chat contacts with last message and unread count (admins and technicians only). |
| GET | `/api/messages?userId=&withId=` | Conversation with one contact; marks their messages read. |
| POST | `/api/messages` | Send a message. Body: `{ senderId, recipientId, body }`. |

All queries use parameterized statements to guard against SQL injection.

---

## Database schema

The `helpdesk` database contains nine tables (see `server/schema.sql` for full definitions):

- **`users`** — accounts with `id_number`, `password`, `name`, `role`, `role_name`, `email`, and `skills` (comma-separated ticket categories, used for technicians).
- **`tickets`** — support requests with a unique `code` (e.g. `#HD001`), `subject`, `category`, `priority`, `status`, and optional `location`/`description`. Links back to `users` via `created_by`.
- **`activities`** — audit log of actor name, role, action, and timestamp.
- **`password_requests`** — password-change requests awaiting admin approval.
- **`ticket_messages`** — per-ticket conversation, including cancellation requests (`kind`).
- **`cancellation_requests`** — requester-initiated cancellation requests awaiting an admin decision.
- **`notifications`** — per-user in-app notifications with a read timestamp.
- **`kpi_selections`** — which KPI metrics (and targets) the super admin chose for each month.
- **`messages`** — chat messages between admins and technicians, with a read timestamp.

Re-running `schema.sql` drops and recreates the tables, restoring the seed data. If you already have a database from an earlier version, add the new pieces by hand instead (`ALTER TABLE users ADD COLUMN skills ...`, `ALTER TABLE tickets ADD COLUMN assigned_to ...` and `reopen_count INT NOT NULL DEFAULT 0`, the three KPI timestamps (`assigned_at`, `first_response_at`, `resolved_at`, all `TIMESTAMP NULL`) and the `kpi_selections` table, and the `messages`, `ticket_messages`, `cancellation_requests` and `notifications` tables from `schema.sql`) to avoid losing data.

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
- Technician assignments are stored in the browser (`localStorage`), not the database.
- The messaging and skills endpoints trust the user IDs sent by the client; they need real session checks before production.
- The presentation build does not include the skills or chat features.

---

## License

This project is provided as-is for educational and demonstration purposes.
