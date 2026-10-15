// Accounts for a new installation, and the one-time clean-up of the old shared demo passwords.
//
//   - A brand new database gets realistic accounts: one unique ID, name and email per person, and a random
//     16-character password for each (hashed with scrypt). Nothing is hard-coded in the repository.
//     Every seeded account must choose its own password at the first sign-in.
//   - The passwords are shown ONCE: in the server window and in server/initial-credentials.txt (gitignored).
//   - An older database whose accounts still use the shared demo passwords (123456student ...) is cleaned up the
//     same way when the server starts: those accounts get a new random password and must change it.
//
// Settings (all optional):
//   SEED_DEMO=false         create only one administrator (ADMIN_ID, ADMIN_NAME, ADMIN_EMAIL) instead of the eight demo accounts
//   SEED_PASSWORD=...       use this one password for every seeded account (for tests and demos; it must pass the password policy)
//   SEED_MUST_CHANGE=false  do not force a password change at the first sign-in
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { evaluatePassword, generatePassword } from "../shared/passwordPolicy.js";
import { hashPassword, verifyPassword } from "./security.js";

// The order matters: the ids 1 to 8 are what the demo-data and screenshot scripts expect.
export const DEMO_ACCOUNTS = [
  { key: "student", id: "2024-00417", role: "student", roleName: "Student", name: "Maria Santos", email: "maria.santos@campus.edu", skills: "" },
  { key: "staff", id: "EMP-2031", role: "staff", roleName: "University Staff", name: "Jose Reyes", email: "jose.reyes@campus.edu", skills: "" },
  { key: "agent", id: "AGT-1001", role: "agent", roleName: "Agent", name: "Carlo Mendoza", email: "carlo.mendoza@campus.edu", skills: "Hardware,Printer" },
  { key: "admin", id: "ADM-0001", role: "admin", roleName: "Student / Staff Admin", name: "Patricia Lim", email: "patricia.lim@campus.edu", skills: "" },
  { key: "superadmin", id: "SUP-0001", role: "superadmin", roleName: "Super Admin", name: "Ricardo Villanueva", email: "ricardo.villanueva@campus.edu", skills: "" },
  { key: "agent2", id: "AGT-1002", role: "agent", roleName: "Agent", name: "Angela Cruz", email: "angela.cruz@campus.edu", skills: "Software,Account / Login" },
  { key: "agent3", id: "AGT-1003", role: "agent", roleName: "Agent", name: "Miguel Ramos", email: "miguel.ramos@campus.edu", skills: "Network / Internet" },
  { key: "viewer", id: "RPT-0001", role: "report_viewer", roleName: "Report Viewer", name: "Elena Garcia", email: "elena.garcia@campus.edu", skills: "" },
];

// The shared passwords of the old demo data, by role (used only to find and replace them).
const OLD_DEFAULTS = {
  student: "123456student",
  staff: "123456employee",
  agent: "123456technician",
  admin: "123456admin",
  superadmin: "123456superadmin",
  report_viewer: "123456viewer",
};

export const CREDENTIALS_FILE = fileURLToPath(new URL("./initial-credentials.txt", import.meta.url));

const randomPassword = () => generatePassword((n) => crypto.randomInt(n));

function chosenPassword(account) {
  const fixed = process.env.SEED_PASSWORD;
  if (!fixed) return randomPassword();
  const check = evaluatePassword(fixed, { id: account.id, name: account.name, email: account.email });
  if (!check.ok) throw new Error(`SEED_PASSWORD does not pass the password policy: ${check.problems.join("; ")}`);
  return fixed;
}

const mustChange = () => (process.env.SEED_MUST_CHANGE === "false" ? 0 : 1);

function report(rows, { log, title }) {
  if (rows.length === 0) return;
  const width = Math.max(...rows.map((row) => row.role.length), 4);
  const idWidth = Math.max(...rows.map((row) => row.id.length), 2);
  const lines = rows.map((row) => `  ${row.role.padEnd(width)}   ${row.id.padEnd(idWidth)}   ${row.password}`);
  log(`\n${title}\n  ${"Role".padEnd(width)}   ${"ID".padEnd(idWidth)}   Password\n${lines.join("\n")}\n`);
  if (!process.env.SEED_PASSWORD) {
    try {
      fs.writeFileSync(
        CREDENTIALS_FILE,
        `${title}\nWritten ${new Date().toISOString()}. Keep this file private and delete it once everyone has signed in and changed their password.\n\n${lines.join("\n")}\n`,
        { mode: 0o600 },
      );
      log(`  (also saved in ${CREDENTIALS_FILE}, which git ignores)\n`);
    } catch {
      log("  (the server folder is read-only, so only this window has the list: copy it now)\n");
    }
  }
}

async function addAccount(conn, account, password) {
  const hash = await hashPassword(password);
  const [result] = await conn.query(
    "INSERT INTO users (id_number, password, name, role, role_name, email, skills, must_change_password, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
    [account.id, hash, account.name, account.role, account.roleName, account.email, account.skills, mustChange()],
  );
  await conn.query("INSERT INTO password_history (user_pk, password_hash) VALUES (?, ?)", [result.insertId, hash]);
  return { role: account.roleName, id: account.id, password };
}

/** Fills an empty users table. */
export async function seedAccounts(conn, { log = console.log } = {}) {
  const rows = [];
  if (process.env.SEED_DEMO === "false") {
    const admin = {
      id: process.env.ADMIN_ID || "SUP-0001",
      role: "superadmin",
      roleName: "Super Admin",
      name: process.env.ADMIN_NAME || "System Administrator",
      email: process.env.ADMIN_EMAIL || "admin@campus.edu",
      skills: "",
    };
    rows.push(await addAccount(conn, admin, process.env.ADMIN_PASSWORD || chosenPassword(admin)));
    report(rows, { log, title: "Your administrator account (shown once)" });
    return rows;
  }
  for (const account of DEMO_ACCOUNTS) rows.push(await addAccount(conn, account, chosenPassword(account)));
  report(rows, { log, title: "Sign-in details for the new accounts (shown once)" });
  return rows;
}

/**
 * Finds accounts that still use the old shared demo passwords and gives them a new random one.
 * Only accounts that were never changed since the seed (password_changed_at is empty) are looked at, so this
 * costs nothing on later starts.
 */
export async function replaceOldDefaultPasswords(conn, { log = console.log } = {}) {
  const [candidates] = await conn.query(
    "SELECT user_pk, id_number, name, email, role, role_name, password FROM users WHERE role <> 'bot' AND password_changed_at IS NULL",
  );
  const replaced = [];
  for (const user of candidates) {
    const old = OLD_DEFAULTS[user.role];
    const isDefault = old && (await verifyPassword(old, user.password));
    if (isDefault) {
      const password = chosenPassword({ id: user.id_number, name: user.name, email: user.email });
      const hash = await hashPassword(password);
      await conn.query(
        "UPDATE users SET password = ?, must_change_password = ?, password_changed_at = NOW(), token_version = token_version + 1, failed_logins = 0, locked_until = NULL, lock_level = 0 WHERE user_pk = ?",
        [hash, mustChange(), user.user_pk],
      );
      await conn.query("INSERT INTO password_history (user_pk, password_hash) VALUES (?, ?)", [user.user_pk, hash]);
      replaced.push({ role: user.role_name, id: user.id_number, password });
    } else {
      // the owner chose this password themselves: leave it, and do not look at it again
      await conn.query("UPDATE users SET password_changed_at = NOW() WHERE user_pk = ?", [user.user_pk]);
    }
  }
  report(replaced, { log, title: "These accounts still used the shared demo passwords, so they were given new ones (shown once)" });
  return replaced;
}
