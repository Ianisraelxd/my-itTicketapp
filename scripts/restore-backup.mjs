// Restores a backup made by the HelpDesk (backups/daily/*.sql.gz) into the database named by DB_NAME.
//   node scripts/restore-backup.mjs backups/daily/helpdesk-2026-10-13.sql.gz
//   DB_NAME=helpdesk_test node scripts/restore-backup.mjs <file>     (restore into a different database)
// Everything in the target database is replaced by the backup. Stop the server first.
import fs from "node:fs";
import zlib from "node:zlib";

import mysql from "mysql2/promise";

import "../server/env.js";
import { dbSsl } from "../server/db.js";

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error("Usage: node scripts/restore-backup.mjs <backup file .sql or .sql.gz>");
  process.exit(1);
}
const name = process.env.DB_NAME || "helpdesk";
if (!/^[A-Za-z0-9_]+$/.test(name)) {
  console.error("DB_NAME may only contain letters, numbers and underscores.");
  process.exit(1);
}

const raw = fs.readFileSync(file);
const sql = (file.endsWith(".gz") ? zlib.gunzipSync(raw) : raw).toString("utf8");

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  multipleStatements: true,
  charset: "utf8mb4",
  ssl: dbSsl,
});
await connection.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await connection.query(`USE \`${name}\``);
await connection.query(sql);
const [[tables]] = await connection.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?", [name]);
await connection.end();
console.log(`Restored ${file} into "${name}" (${tables.n} tables and views).`);
