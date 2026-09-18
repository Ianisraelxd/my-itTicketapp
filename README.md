# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## MySQL database + API backend

The app now stores users, tickets, and activity logs in MySQL, served through a small Express API (in `server/`). React talks to it over `/api`, which Vite proxies to the backend during development.

### 1. Prerequisites

- A running MySQL server (local install, Docker, XAMPP, etc.)
- The `mysql` CLI on your PATH (only needed for the `db:init` script; you can also use any MySQL GUI).

### 2. Create the database

Import the schema and seed data:

```bash
npm run db:init
```

This runs `mysql -u root -p < server/schema.sql`, which creates the `helpdesk` database, its tables, and seed rows. Enter your MySQL root password when prompted. If your MySQL user is not `root`, run the file manually with your preferred client instead.

### 3. Configure credentials

Copy the example env file and fill in your MySQL details:

```bash
cp server/.env.example server/.env
```

Edit `server/.env` (this file is gitignored):

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=helpdesk
PORT=3001
```

### 4. Run both processes

In one terminal, start the API:

```bash
npm run server
```

In another, start the frontend:

```bash
npm run dev
```

Open the Vite URL. Log in with any seeded account, e.g. ID `2404154`, password `123456student`, role `Student`.

### Security note

Passwords are stored in plaintext to keep this prototype simple. Before any real use, hash them with bcrypt and compare hashes in the `/api/login` route.
