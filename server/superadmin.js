// Super Admin governance: data archiving and privileged-account management.
// Everything here is Super Admin only (verifySuperAdmin) and the audit trail
// goes to the activity log.
import fs from "node:fs";
import path from "node:path";

import { verifySuperAdmin } from "./auth.js";
import { pool, query } from "./db.js";

const ARCHIVE_DIR = path.resolve("backups/archives");
const FINISHED_STATUSES = ["Resolved", "Cancelled", "Closed", "Done"];
const MIN_RETENTION_DAYS = 30;
const CHUNK = 500;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function chunks(list, size = CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
const marks = (list) => list.map(() => "?").join(", ");

// --- CSV for the downloadable backup (tickets) ---------------------------------
const FORMULA_START = /^[=+\-@\t\r]/;
function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function toCsv(rows) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(","));
  return lines.join("\r\n");
}

// What can be archived: finished tickets whose last activity is before the cut-off.
const ELIGIBLE = `status IN (${marks(FINISHED_STATUSES)}) AND COALESCE(resolved_at, created_at) < ?`;

function validateCutoff(before) {
  if (!ISO_DATE.test(String(before ?? ""))) return "Pick a retention date.";
  const date = new Date(`${before}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "That date is not valid.";
  const limit = new Date();
  limit.setDate(limit.getDate() - MIN_RETENTION_DAYS);
  if (date > limit) {
    return `Keep at least the last ${MIN_RETENTION_DAYS} days of tickets: choose an earlier date.`;
  }
  return null;
}

export function registerSuperAdminRoutes(app, { wrap, notify }) {
  // ---- Overview numbers for the panel header ------------------------------------
  app.get("/api/superadmin/overview", verifySuperAdmin, wrap(async (_req, res) => {
    const [active] = await query("SELECT COUNT(*) AS n FROM tickets");
    const [archived] = await query("SELECT COUNT(*) AS n FROM tickets_archive");
    const [runs] = await query("SELECT COUNT(*) AS n, MAX(created_at) AS lastAt FROM archive_runs");
    res.json({
      activeTickets: Number(active.n),
      archivedTickets: Number(archived.n),
      archiveRuns: Number(runs.n),
      lastArchiveAt: runs.lastAt,
      minRetentionDays: MIN_RETENTION_DAYS,
    });
  }));

  // ---- Archiving pipeline ---------------------------------------------------------
  // body: { before: "2023-10-08", dryRun?: true, confirm: true }
  app.post("/api/superadmin/archive", verifySuperAdmin, wrap(async (req, res) => {
    const { before, dryRun = false, confirm = false } = req.body ?? {};
    const problem = validateCutoff(before);
    if (problem) return res.status(400).json({ error: problem });
    const cutoff = `${before} 00:00:00`;

    if (dryRun) {
      const [found] = await query(
        `SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM tickets WHERE ${ELIGIBLE}`,
        [...FINISHED_STATUSES, cutoff],
      );
      const [msgs] = await query(
        `SELECT COUNT(*) AS n FROM ticket_messages WHERE ticket_pk IN (SELECT ticket_pk FROM tickets WHERE ${ELIGIBLE})`,
        [...FINISHED_STATUSES, cutoff],
      );
      return res.json({ dryRun: true, before, tickets: Number(found.n), messages: Number(msgs.n), oldest: found.oldest });
    }
    if (confirm !== true) {
      return res.status(400).json({ error: "Please confirm the archive before it runs." });
    }

    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    const conn = await pool.getConnection();
    let files = null;
    try {
      await conn.beginTransaction();

      // Lock the candidates so nothing changes under us while we copy them.
      const [pkRows] = await conn.execute(
        `SELECT ticket_pk FROM tickets WHERE ${ELIGIBLE} ORDER BY ticket_pk FOR UPDATE`,
        [...FINISHED_STATUSES, cutoff],
      );
      const pks = pkRows.map((row) => row.ticket_pk);
      if (pks.length === 0) {
        await conn.rollback();
        return res.json({ archived: 0, messages: 0, requests: 0, before });
      }

      // 1. Read everything that will move, for the export.
      const tickets = [];
      const messages = [];
      const requests = [];
      for (const group of chunks(pks)) {
        const [t] = await conn.execute(`SELECT * FROM tickets WHERE ticket_pk IN (${marks(group)})`, group);
        const [m] = await conn.execute(`SELECT * FROM ticket_messages WHERE ticket_pk IN (${marks(group)})`, group);
        const [r] = await conn.execute(`SELECT * FROM cancellation_requests WHERE ticket_pk IN (${marks(group)})`, group);
        tickets.push(...t);
        messages.push(...m);
        requests.push(...r);
      }

      // 2. Write the downloadable backups first: if this fails nothing is deleted.
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const base = `archive_${before}_run_${stamp}`;
      files = { json: `${base}.json`, csv: `${base}.csv` };
      fs.writeFileSync(
        path.join(ARCHIVE_DIR, files.json),
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            exportedBy: req.user.name,
            retentionCutoff: before,
            counts: { tickets: tickets.length, ticket_messages: messages.length, cancellation_requests: requests.length },
            tickets,
            ticket_messages: messages,
            cancellation_requests: requests,
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(path.join(ARCHIVE_DIR, files.csv), `﻿${toCsv(tickets)}`);

      // 3. Copy into the archive tables, then remove from the live ones.
      let copiedTickets = 0;
      let copiedMessages = 0;
      let copiedRequests = 0;
      for (const group of chunks(pks)) {
        const [a] = await conn.execute(
          `INSERT INTO tickets_archive SELECT * FROM tickets WHERE ticket_pk IN (${marks(group)})`,
          group,
        );
        const [b] = await conn.execute(
          `INSERT INTO ticket_messages_archive SELECT * FROM ticket_messages WHERE ticket_pk IN (${marks(group)})`,
          group,
        );
        const [c] = await conn.execute(
          `INSERT INTO cancellation_requests_archive SELECT * FROM cancellation_requests WHERE ticket_pk IN (${marks(group)})`,
          group,
        );
        copiedTickets += a.affectedRows;
        copiedMessages += b.affectedRows;
        copiedRequests += c.affectedRows;
      }
      if (copiedTickets !== pks.length || copiedMessages !== messages.length || copiedRequests !== requests.length) {
        throw new Error("Archive copy did not match what was read; nothing was deleted.");
      }

      for (const group of chunks(pks)) {
        // ticket_messages and cancellation_requests go with the ticket (ON DELETE CASCADE).
        await conn.execute(`DELETE FROM tickets WHERE ticket_pk IN (${marks(group)})`, group);
      }

      const [run] = await conn.execute(
        `INSERT INTO archive_runs (run_by, before_date, ticket_count, message_count, request_count, json_file, csv_file)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [req.user.userId, before, pks.length, messages.length, requests.length, files.json, files.csv],
      );
      await conn.commit();

      await query(
        "INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)",
        [req.user.name, req.user.roleName, `Archived ${pks.length} tickets older than ${before} (export ${files.json})`],
      );
      res.status(201).json({
        runId: run.insertId,
        archived: pks.length,
        messages: messages.length,
        requests: requests.length,
        before,
        files,
      });
    } catch (error) {
      await conn.rollback().catch(() => {});
      if (files) {
        for (const name of Object.values(files)) fs.rmSync(path.join(ARCHIVE_DIR, name), { force: true });
      }
      throw error;
    } finally {
      conn.release();
    }
  }));

  app.get("/api/superadmin/archive/runs", verifySuperAdmin, wrap(async (_req, res) => {
    const rows = await query(
      `SELECT r.run_pk AS id, r.before_date AS beforeDate, r.ticket_count AS tickets, r.message_count AS messages,
         r.request_count AS requests, r.json_file AS jsonFile, r.csv_file AS csvFile, r.created_at AS createdAt,
         u.name AS runBy
       FROM archive_runs r LEFT JOIN users u ON u.user_pk = r.run_by
       ORDER BY r.run_pk DESC LIMIT 20`,
    );
    res.json(
      rows.map((row) => ({
        ...row,
        beforeDate: row.beforeDate instanceof Date ? row.beforeDate.toISOString().slice(0, 10) : row.beforeDate,
        jsonAvailable: fs.existsSync(path.join(ARCHIVE_DIR, path.basename(row.jsonFile))),
        csvAvailable: fs.existsSync(path.join(ARCHIVE_DIR, path.basename(row.csvFile))),
      })),
    );
  }));

  app.get("/api/superadmin/archive/runs/:id/download", verifySuperAdmin, wrap(async (req, res) => {
    const format = req.query.format === "csv" ? "csv" : "json";
    const rows = await query("SELECT json_file, csv_file FROM archive_runs WHERE run_pk = ?", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Archive run not found." });
    const name = path.basename(format === "csv" ? rows[0].csv_file : rows[0].json_file);
    const file = path.join(ARCHIVE_DIR, name);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "The export file is no longer on the server." });
    res.setHeader("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    fs.createReadStream(file).pipe(res);
  }));

  // ---- Privileged account management -----------------------------------------------
  const lockedNow = (row) => Boolean(row.locked_until && new Date(row.locked_until) > new Date());

  // Admins and report viewers, plus the people who could be given access.
  app.get("/api/superadmin/admins", verifySuperAdmin, wrap(async (_req, res) => {
    const rows = await query(
      `SELECT user_pk AS userId, id_number AS id, name, email, role, role_name AS roleName,
         mfa_enabled, failed_logins, locked_until, last_login_at AS lastLoginAt
       FROM users WHERE role IN ('admin', 'report_viewer') ORDER BY role, name`,
    );
    const candidates = await query(
      "SELECT user_pk AS userId, id_number AS id, name, role_name AS roleName FROM users WHERE role IN ('employee', 'technician') ORDER BY name",
    );
    res.json({
      admins: rows.map((row) => ({
        userId: row.userId,
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        roleName: row.roleName,
        mfaEnabled: Boolean(row.mfa_enabled),
        locked: lockedNow(row),
        failedLogins: Number(row.failed_logins),
        lastLoginAt: row.lastLoginAt,
      })),
      candidates,
    });
  }));

  // body: { action: "revoke" | "grant" | "grant_viewer" | "unlock" | "reset_mfa" }
  app.put("/api/superadmin/manage-admins/:id", verifySuperAdmin, wrap(async (req, res) => {
    const action = String(req.body?.action ?? "");
    const rows = await query(
      "SELECT user_pk, id_number, name, role FROM users WHERE user_pk = ? LIMIT 1",
      [req.params.id],
    );
    const target = rows[0];
    if (!target) return res.status(404).json({ error: "Account not found." });
    if (target.role === "superadmin") {
      return res.status(403).json({ error: "The super admin account cannot be changed here." });
    }
    if (target.user_pk === req.user.userId) {
      return res.status(403).json({ error: "You cannot change your own account." });
    }

    const log = (text) =>
      query("INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)", [
        req.user.name,
        req.user.roleName,
        text,
      ]);

    async function changeRole(newRole, newRoleName, allowedFrom, summary, messageBody) {
      if (!allowedFrom.includes(target.role)) {
        return res.status(409).json({ error: `${target.name} cannot be changed this way (current role: ${target.role}).` });
      }
      const clash = await query(
        "SELECT user_pk FROM users WHERE id_number = ? AND role = ? LIMIT 1",
        [target.id_number, newRole],
      );
      if (clash.length > 0) {
        return res.status(409).json({ error: `A ${newRole.replace("_", " ")} account with ID ${target.id_number} already exists.` });
      }
      await query("UPDATE users SET role = ?, role_name = ?, skills = '' WHERE user_pk = ?", [newRole, newRoleName, target.user_pk]);
      await log(`${summary} ${target.name}`);
      await notify([target.user_pk], { type: "role", title: "Your access changed", body: messageBody });
      return res.json({ ok: true, action, role: newRole });
    }

    switch (action) {
      case "revoke":
        return changeRole(
          "employee",
          "Employee",
          ["admin", "report_viewer"],
          "Revoked admin access for",
          "Your admin access was revoked. Log in again as an Employee.",
        );
      case "grant":
        return changeRole(
          "admin",
          "Student / Employee Admin",
          ["employee", "technician"],
          "Granted admin access to",
          "You were given admin access. Log in again as an Admin.",
        );
      case "grant_viewer":
        return changeRole(
          "report_viewer",
          "Report Viewer",
          ["employee", "technician"],
          "Granted report viewer access to",
          "You were given read-only access to the dashboards. Log in again as a Report Viewer.",
        );
      case "unlock":
        await query("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE user_pk = ?", [target.user_pk]);
        await log(`Overrode the lockout on ${target.name}`);
        return res.json({ ok: true, action });
      case "reset_mfa":
        await query("UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE user_pk = ?", [target.user_pk]);
        await log(`Reset two-step verification for ${target.name}`);
        await notify([target.user_pk], {
          type: "role",
          title: "Two-step verification was reset",
          body: "A super admin reset your two-step verification. Set it up again from your profile.",
        });
        return res.json({ ok: true, action });
      default:
        return res.status(400).json({ error: "action must be revoke, grant, grant_viewer, unlock or reset_mfa." });
    }
  }));
}
