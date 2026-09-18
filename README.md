# Campus HelpDesk

A role-based IT support desk for a campus, built with **React + Vite**, backed by a small **Express + MySQL** API. Students and employees can submit and track support requests, technicians work their assigned queue, and admins manage users, tickets, and activity logs.

The project ships in two forms:

1. **Full app** — React frontend + Express API + MySQL database (real persistence).
2. **Presentation build** — a single self-contained `presentation.html` that runs the whole UI in the browser using `localStorage` instead of a database. No backend, no build step.

---

## Table of contents

- [Features](#features)
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

- **Role-based access** — Student, Employee, Technician, Admin, and Super Admin, each with its own navigation and dashboards.
- **Authentication** — login validated against the database, with a signup and password-reset flow (prototype).
- **Ticket management** — submit requests, auto-generated ticket IDs (`#HD001`), and live status tracking (Open / In Progress / Resolved).
- **Dashboards** — per-role overview cards summarizing ticket counts and activity.
- **User directory** — admins can view registered users pulled from the database.
- **Activity log** — records logins and ticket actions, persisted server-side.
- **Responsive layout** — adapts from desktop to mobile.

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
├─ public/                 # Static assets served as-is
├─ server/                 # Express + MySQL backend
│  ├─ db.js                # MySQL connection pool + query helper
│  ├─ index.js             # API server and routes
│  ├─ schema.sql           # Database schema + seed data
│  └─ .env.example         # Backend environment template
├─ src/                    # React frontend
│  ├─ api.js               # Fetch client for the /api backend
│  ├─ App.jsx              # Main application (all views/components)
│  ├─ App.css              # Application styles
│  ├─ index.css            # Base styles
│  └─ main.jsx             # React entry point
├─ presentation.html       # Standalone localStorage demo (no backend)
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

Copy the example env file and fill in your MySQL credentials:

```bash
cp server/.env.example server/.env
```

`server/.env` (gitignored):

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

All seed accounts share the ID `2404154`. Select the matching role on the login screen.

| Role                       | ID        | Password            |
| -------------------------- | --------- | ------------------- |
| Student                    | `2404154` | `123456student`     |
| Employee                   | `2404154` | `123456employee`    |
| Technician                 | `2404154` | `123456technician`  |
| Student / Employee Admin   | `2404154` | `123456admin`       |
| Super Admin                | `2404154` | `123456superadmin`  |

---

## API reference

Base path: `/api` (proxied to `http://localhost:3001` in development).

| Method | Endpoint          | Description                                   |
| ------ | ----------------- | --------------------------------------------- |
| GET    | `/api/health`     | Health check; verifies the DB connection.     |
| POST   | `/api/login`      | Authenticate. Body: `{ id, password, role }`. |
| GET    | `/api/tickets`    | List all tickets (newest first).              |
| POST   | `/api/tickets`    | Create a ticket. Body: `{ subject, category, priority, location?, description? }`. |
| GET    | `/api/activities` | List activity log entries (newest first).     |
| POST   | `/api/activities` | Add an activity. Body: `{ name, roleName, action }`. |
| GET    | `/api/users`      | List registered users.                        |

All queries use parameterized statements to guard against SQL injection.

---

## Database schema

The `helpdesk` database contains three tables (see `server/schema.sql` for full definitions):

- **`users`** — accounts with `id_number`, `password`, `name`, `role`, `role_name`, and `email`.
- **`tickets`** — support requests with a unique `code` (e.g. `#HD001`), `subject`, `category`, `priority`, `status`, and optional `location`/`description`. Links back to `users` via `created_by`.
- **`activities`** — audit log of actor name, role, action, and timestamp.

Re-running `schema.sql` drops and recreates the tables, restoring the seed data.

---

## Presentation build (no database)

`presentation.html` is a single self-contained file that runs the entire app in the browser with **no backend and no build step**. It uses React and Babel from a CDN, and replaces the API with a `localStorage`-backed store seeded with the same demo data.

To use it:

1. Open `presentation.html` in any modern browser.
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

## Security notes

This is a prototype. Before any real deployment:

- **Passwords are stored in plaintext** to keep the demo simple. Hash them with bcrypt and compare hashes in the `/api/login` route.
- Add session/token-based authentication and authorization checks on protected endpoints.
- Never commit `server/.env` — it is gitignored by default.
- Some views (technician queue, manage-requests table) still use static demo data and are not yet wired to the database.

---

## License

This project is provided as-is for educational and demonstration purposes.
