// Automatic database backups, with no extra programs needed (it does not use mysqldump).
// A compressed SQL file per day goes to backups/daily/; the newest few are kept.
//   BACKUP_HOUR=2 (hour of the day it runs, 0-23), BACKUP_KEEP=14, BACKUP=false to switch it off.
// Restore with:  node scripts/restore-backup.mjs backups/daily/<file>.sql.gz
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import mysql from "mysql2";

import { pool } from "./db.js";

export const BACKUP_DIR = fileURLToPath(new URL("../backups/daily", import.meta.url));
const KEEP = Number(process.env.BACKUP_KEEP) || 14;
const HOUR = process.env.BACKUP_HOUR === undefined ? 2 : Number(process.env.BACKUP_HOUR);
const ENABLED = process.env.BACKUP !== "false";
const NAME = /^helpdesk-\d{4}-\d{2}-\d{2}(?:_\d{6})?\.sql\.gz$/;

/** The whole database as SQL text: tables, rows and views. */
export async function dumpDatabase() {
  const [tableRows] = await pool.query("SHOW FULL TABLES");
  const names = tableRows.map((row) => ({ name: Object.values(row)[0], type: Object.values(row)[1] }));
  const out = [
    `-- Campus HelpDesk backup ${new Date().toISOString()}`,
    "SET NAMES utf8mb4;",
    "SET FOREIGN_KEY_CHECKS = 0;",
    "SET UNIQUE_CHECKS = 0;",
    "SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';",
  ];
  for (const { name } of names.filter((table) => table.type === "BASE TABLE")) {
    const [[create]] = await pool.query(`SHOW CREATE TABLE \`${name}\``);
    out.push(`\nDROP TABLE IF EXISTS \`${name}\`;`, `${create["Create Table"]};`);
    const [rows] = await pool.query(`SELECT * FROM \`${name}\``);
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const columns = Object.keys(batch[0]).map((c) => `\`${c}\``).join(", ");
      const values = batch.map((row) => `(${Object.values(row).map((value) => mysql.escape(value)).join(", ")})`).join(",\n  ");
      out.push(`INSERT INTO \`${name}\` (${columns}) VALUES\n  ${values};`);
    }
  }
  for (const { name } of names.filter((table) => table.type === "VIEW")) {
    const [[create]] = await pool.query(`SHOW CREATE VIEW \`${name}\``);
    const view = create["Create View"].replace(/ALGORITHM=\w+ /, "").replace(/DEFINER=`[^`]*`@`[^`]*` /, "").replace(/SQL SECURITY \w+ /, "");
    out.push(`\nDROP VIEW IF EXISTS \`${name}\`;`, `${view};`);
  }
  out.push("\nSET FOREIGN_KEY_CHECKS = 1;", "");
  return out.join("\n");
}

const stamp = (date) => date.toISOString().slice(0, 10);

/** Writes a backup file now and removes the oldest ones beyond BACKUP_KEEP. */
export async function createBackup({ label = null } = {}) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const now = new Date();
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const name = `helpdesk-${stamp(now)}${label ? `_${time}` : ""}.sql.gz`;
  const file = path.join(BACKUP_DIR, name);
  const temporary = `${file}.part`;
  fs.writeFileSync(temporary, zlib.gzipSync(Buffer.from(await dumpDatabase(), "utf8")));
  fs.renameSync(temporary, file);
  const kept = listBackups();
  for (const old of kept.slice(KEEP)) fs.rmSync(path.join(BACKUP_DIR, old.name), { force: true });
  return { name, size: fs.statSync(file).size };
}

export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => NAME.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size: stat.size, createdAt: stat.mtime };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export const isBackupName = (name) => NAME.test(String(name));

/** Checks every hour; the first check at or after BACKUP_HOUR creates the day's backup if it is missing. */
export function startBackupSchedule() {
  if (!ENABLED) return null;
  const tick = async () => {
    const now = new Date();
    if (now.getHours() < HOUR) return;
    if (listBackups().some((backup) => backup.name.startsWith(`helpdesk-${stamp(now)}`))) return;
    try {
      const made = await createBackup();
      console.log(`backup: ${made.name} (${Math.round(made.size / 1024)} KB)`);
    } catch (error) {
      console.error("backup failed:", error.message);
    }
  };
  const timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref?.();
  setTimeout(tick, 15000).unref?.();
  return { tick, timer };
}

export function registerBackupRoutes(app, { wrap, verifySuperAdmin }) {
  app.get("/api/superadmin/backups", verifySuperAdmin, wrap(async (_req, res) => {
    res.json({ enabled: ENABLED, hour: HOUR, keep: KEEP, files: listBackups() });
  }));

  app.post("/api/superadmin/backups", verifySuperAdmin, wrap(async (req, res) => {
    const made = await createBackup({ label: "manual" });
    await pool.query("INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)", [req.user.name, req.user.roleName, `Created database backup ${made.name}`]);
    res.status(201).json(made);
  }));

  app.get("/api/superadmin/backups/:name/download", verifySuperAdmin, wrap(async (req, res) => {
    if (!isBackupName(req.params.name)) return res.status(400).json({ error: "Not a backup file name." });
    const file = path.join(BACKUP_DIR, req.params.name);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "Backup not found." });
    res.set({ "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${req.params.name}"` });
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  }));
}
