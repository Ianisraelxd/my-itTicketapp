// First-run setup, so nobody has to import SQL by hand:
//   - creates the database when it does not exist and loads schema.sql into an empty one
//   - brings an older database up to date by running the files in server/migrations that it is missing
// Nothing is ever dropped from a database that already has data.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import mysql from "mysql2/promise";

import { dbSsl } from "./db.js";
import { replaceOldDefaultPasswords, seedAccounts } from "./seed.js";

const DB_NAME = process.env.DB_NAME || "helpdesk";
const here = (file) => fileURLToPath(new URL(file, import.meta.url));

function connect(database) {
  return mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database,
    multipleStatements: true,
    charset: "utf8mb4",
    ssl: dbSsl,
  });
}

const tableExists = async (conn, table) =>
  (await conn.query("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [table]))[0].length > 0;
const columnExists = async (conn, table, column) =>
  (await conn.query("SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?", [table, column]))[0].length > 0;
const indexExists = async (conn, table, index) =>
  (await conn.query("SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?", [table, index]))[0].length > 0;

// Oldest first. `done` says whether a database already has the change, so a migration is never run twice.
export const MIGRATIONS = [
  { file: "2026-10-enterprise.sql", done: (c) => tableExists(c, "tickets_archive") },
  { file: "2026-10-chatbot.sql", done: (c) => columnExists(c, "ticket_messages", "meta") },
  {
    file: "2026-10-roles.sql",
    done: async (c) => (await c.query("SELECT 1 FROM users WHERE role IN ('employee', 'technician') LIMIT 1"))[0].length === 0,
  },
  { file: "2026-10-priority-locations.sql", done: (c) => tableExists(c, "locations") },
  { file: "2026-10-autoassign.sql", done: (c) => columnExists(c, "tickets", "assignment_started_at") },
  { file: "2026-10-performance.sql", done: (c) => indexExists(c, "tickets", "idx_ticket_status") },
  { file: "2026-10-features.sql", done: (c) => tableExists(c, "kb_articles") },
  { file: "2026-10-idempotency.sql", done: (c) => columnExists(c, "tickets", "client_token") },
  { file: "2026-10-security.sql", done: (c) => columnExists(c, "users", "token_version") },
];

export async function ensureSchema({ log = console.log } = {}) {
  if (!/^[A-Za-z0-9_]+$/.test(DB_NAME)) throw new Error("DB_NAME may only contain letters, numbers and underscores.");

  let server;
  try {
    server = await connect(undefined);
  } catch (error) {
    throw new Error(
      `Cannot reach MySQL at ${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || 3306} (${error.code || error.message}). ` +
        "Start MySQL (XAMPP Control Panel > MySQL > Start) and try again.",
    );
  }
  await server.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await server.end();

  const conn = await connect(DB_NAME);
  try {
    if (!(await tableExists(conn, "users"))) {
      log(`Setting up the "${DB_NAME}" database for the first time...`);
      const sql = fs
        .readFileSync(here("./schema.sql"), "utf8")
        .replace(/CREATE DATABASE IF NOT EXISTS helpdesk/, `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``)
        .replace(/USE helpdesk;/, `USE \`${DB_NAME}\`;`);
      await conn.query(sql);
      log("Database ready.");
      await seedAccounts(conn, { log });
      return { created: true, migrated: [] };
    }

    const migrated = [];
    for (const migration of MIGRATIONS) {
      if (await migration.done(conn)) continue;
      log(`Updating the database: ${migration.file}`);
      await conn.query(fs.readFileSync(here(`./migrations/${migration.file}`), "utf8"));
      migrated.push(migration.file);
    }
    // Accounts that still use the old shared demo passwords get new random ones (only looked at once).
    await replaceOldDefaultPasswords(conn, { log });
    return { created: false, migrated };
  } finally {
    await conn.end();
  }
}

/** Wipes everything and starts again from schema.sql with fresh accounts (npm run db:init --yes). */
export async function resetDatabase({ log = console.log } = {}) {
  const server = await connect(undefined);
  await server.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await server.end();
  const conn = await connect(DB_NAME);
  try {
    const sql = fs
      .readFileSync(here("./schema.sql"), "utf8")
      .replace(/CREATE DATABASE IF NOT EXISTS helpdesk/, `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``)
      .replace(/USE helpdesk;/, `USE \`${DB_NAME}\`;`);
    await conn.query(sql);
    await seedAccounts(conn, { log });
  } finally {
    await conn.end();
  }
}
