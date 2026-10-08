import "dotenv/config";
import express from "express";
import { authenticate, verifyReportViewer } from "./auth.js";
import { createBot, shapeMessage } from "./bot.js";
import { pool, query } from "./db.js";
import { registerKpiRoutes } from "./kpi.js";
import {
  hashPassword,
  isHashed,
  newTotpSecret,
  otpauthUrl,
  signMfaChallenge,
  signSession,
  verifyPassword,
  verifyToken,
  verifyTotp,
} from "./security.js";
import { registerSuperAdminRoutes } from "./superadmin.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

// Basic hardening headers; API responses are never cached.
app.use("/api", (_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
  });
  next();
});

// Everything under /api needs a signed-in user except login, signup and the health check.
app.use("/api", authenticate);

const PORT = Number(process.env.PORT) || 3001;

// Wrap async route handlers so thrown errors reach the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Next sequential code such as #HD007. `table` and `prefix` are fixed strings
// from this file. Run inside the same transaction as the INSERT.
async function nextCode(conn, table, prefix, archiveTable = null) {
  const position = prefix.length + 1;
  const [rows] = await conn.execute(
    archiveTable
      ? `SELECT GREATEST(
           COALESCE((SELECT MAX(CAST(SUBSTRING(code, ?) AS UNSIGNED)) FROM ${table}), 0),
           COALESCE((SELECT MAX(CAST(SUBSTRING(code, ?) AS UNSIGNED)) FROM ${archiveTable}), 0)
         ) + 1 AS n`
      : `SELECT COALESCE(MAX(CAST(SUBSTRING(code, ?) AS UNSIGNED)), 0) + 1 AS n FROM ${table}`,
    archiveTable ? [position, position] : [position],
  );
  return `${prefix}${String(rows[0].n).padStart(3, "0")}`;
}

// Notifications never break the action that triggered them.
async function notify(userIds, { type, title, body, ticketCode = null }) {
  const targets = [...new Set((userIds || []).filter(Boolean))];
  for (const userId of targets) {
    try {
      await query(
        "INSERT INTO notifications (user_pk, type, title, body, ticket_code) VALUES (?, ?, ?, ?, ?)",
        [userId, type, title, body, ticketCode],
      );
    } catch (err) {
      console.error("notify failed", err.message);
    }
  }
}

async function adminIds() {
  const rows = await query("SELECT user_pk FROM users WHERE role = 'admin'");
  return rows.map((row) => row.user_pk);
}

// --- Health check ----------------------------------------------------------
app.get("/api/health", wrap(async (_req, res) => {
  await query("SELECT 1");
  res.json({ ok: true });
}));

// --- Auth -------------------------------------------------------------------
// NOTE: plaintext password compare to match the prototype. For production,
// store bcrypt hashes and compare with bcrypt.compare() instead.
app.post("/api/signup", wrap(async (req, res) => {
  const { fullName, id, email, userType, password } = req.body ?? {};
  const trimmedName = fullName?.trim();
  const trimmedId = id?.trim();
  const trimmedEmail = email?.trim();
  const selectedRole = String(userType || "Student").toLowerCase();

  if (!trimmedName || !trimmedId || !trimmedEmail || !password) {
    return res.status(400).json({
      error: "full name, ID, email, user type, and password are required.",
    });
  }

  const role = selectedRole === "employee" ? "employee" : "student";
  const roleName = role === "employee" ? "Employee" : "Student";

  const existing = await query(
    "SELECT user_pk FROM users WHERE id_number = ? AND role = ? LIMIT 1",
    [trimmedId, role],
  );
  if (existing.length > 0) {
    return res.status(409).json({
      error: "An account with this ID and role already exists.",
    });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }
  await query(
    "INSERT INTO users (id_number, password, name, role, role_name, email) VALUES (?, ?, ?, ?, ?, ?)",
    [trimmedId, await hashPassword(password), trimmedName, role, roleName, trimmedEmail],
  );

  res.status(201).json({
    ok: true,
    message: "Account created successfully.",
  });
}));

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

// Everything a client needs after signing in.
async function sessionFor(account) {
  await query(
    "UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW() WHERE user_pk = ?",
    [account.user_pk],
  );
  await query(
    "INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)",
    [account.name, account.role_name, "Logged into the HelpDesk system"],
  );
  return {
    token: signSession(account),
    userId: account.user_pk,
    id: account.id_number,
    name: account.name,
    role: account.role,
    roleName: account.role_name,
    mfaEnabled: Boolean(account.mfa_enabled),
  };
}

// Counts a wrong password / code and locks the account after too many.
async function recordFailure(account) {
  const failed = Number(account.failed_logins) + 1;
  if (failed >= MAX_FAILED_LOGINS) {
    await query(
      "UPDATE users SET failed_logins = 0, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE user_pk = ?",
      [LOCK_MINUTES, account.user_pk],
    );
    await query(
      "INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)",
      [account.name, account.role_name, `Account locked for ${LOCK_MINUTES} minutes after ${MAX_FAILED_LOGINS} failed sign-ins`],
    );
    return true;
  }
  await query("UPDATE users SET failed_logins = ? WHERE user_pk = ?", [failed, account.user_pk]);
  return false;
}

const lockMessage = (account) => {
  const minutes = Math.max(1, Math.ceil((new Date(account.locked_until) - new Date()) / 60000));
  return `This account is locked. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask the super admin to unlock it.`;
};

const isLocked = (account) => Boolean(account.locked_until && new Date(account.locked_until) > new Date());

const ACCOUNT_COLUMNS =
  "user_pk, id_number, password, name, role, role_name, failed_logins, locked_until, mfa_enabled, mfa_secret";

app.post("/api/login", wrap(async (req, res) => {
  const { id, password, role } = req.body ?? {};
  if (!id || !password || !role) {
    return res.status(400).json({ error: "id, password, and role are required." });
  }
  const rows = await query(
    `SELECT ${ACCOUNT_COLUMNS} FROM users WHERE id_number = ? AND role = ? LIMIT 1`,
    [id, role],
  );
  const account = rows[0];
  if (account && isLocked(account)) {
    return res.status(423).json({ error: lockMessage(account) });
  }
  if (!account || !(await verifyPassword(password, account.password))) {
    if (account && (await recordFailure(account))) {
      return res.status(423).json({ error: `Too many failed attempts. The account is locked for ${LOCK_MINUTES} minutes.` });
    }
    return res.status(401).json({ error: "Incorrect ID, password, or selected role." });
  }

  // Upgrade an old plaintext password to a hash the first time it is used.
  if (!isHashed(account.password)) {
    await query("UPDATE users SET password = ? WHERE user_pk = ?", [await hashPassword(password), account.user_pk]);
  }

  if (account.mfa_enabled) {
    return res.json({ mfaRequired: true, mfaToken: signMfaChallenge(account) });
  }
  res.json(await sessionFor(account));
}));

// Second step when two-step verification is on.
app.post("/api/login/mfa", wrap(async (req, res) => {
  const { mfaToken, code } = req.body ?? {};
  const payload = verifyToken(mfaToken, "mfa");
  if (!payload) return res.status(401).json({ error: "That sign-in expired. Start again." });
  const rows = await query(`SELECT ${ACCOUNT_COLUMNS} FROM users WHERE user_pk = ? LIMIT 1`, [payload.sub]);
  const account = rows[0];
  if (!account || !account.mfa_enabled) return res.status(401).json({ error: "Start the sign-in again." });
  if (isLocked(account)) return res.status(423).json({ error: lockMessage(account) });

  if (!verifyTotp(account.mfa_secret, code)) {
    if (await recordFailure(account)) {
      return res.status(423).json({ error: `Too many failed attempts. The account is locked for ${LOCK_MINUTES} minutes.` });
    }
    return res.status(401).json({ error: "That code is not correct. Check the app and try again." });
  }
  res.json(await sessionFor(account));
}));

// Who am I? Lets the app restore a session after a page refresh.
app.get("/api/me", wrap(async (req, res) => {
  const rows = await query(
    "SELECT user_pk AS userId, id_number AS id, name, role, role_name AS roleName, email, mfa_enabled FROM users WHERE user_pk = ?",
    [req.user.userId],
  );
  const me = rows[0];
  res.json({ ...me, mfaEnabled: Boolean(me.mfa_enabled), mfa_enabled: undefined });
}));

// --- Two-step verification (TOTP authenticator app) ----------------------------------
const MFA_ROLES = ["technician", "admin", "superadmin", "report_viewer"];

app.post("/api/mfa/setup", wrap(async (req, res) => {
  if (!MFA_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: "Two-step verification is for staff accounts." });
  }
  const rows = await query("SELECT mfa_enabled, id_number FROM users WHERE user_pk = ?", [req.user.userId]);
  if (rows[0].mfa_enabled) return res.status(409).json({ error: "Two-step verification is already on." });
  const secret = newTotpSecret();
  await query("UPDATE users SET mfa_secret = ?, mfa_enabled = 0 WHERE user_pk = ?", [secret, req.user.userId]);
  res.json({ secret, otpauthUrl: otpauthUrl(secret, rows[0].id_number) });
}));

app.post("/api/mfa/enable", wrap(async (req, res) => {
  const rows = await query("SELECT mfa_secret, mfa_enabled FROM users WHERE user_pk = ?", [req.user.userId]);
  if (!rows[0].mfa_secret) return res.status(409).json({ error: "Start the setup first." });
  if (!verifyTotp(rows[0].mfa_secret, req.body?.code)) {
    return res.status(400).json({ error: "That code is not correct. Check the app and try again." });
  }
  await query("UPDATE users SET mfa_enabled = 1 WHERE user_pk = ?", [req.user.userId]);
  await query("INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)", [
    req.user.name,
    req.user.roleName,
    "Turned on two-step verification",
  ]);
  res.json({ ok: true });
}));

app.post("/api/mfa/disable", wrap(async (req, res) => {
  const rows = await query("SELECT mfa_secret, mfa_enabled FROM users WHERE user_pk = ?", [req.user.userId]);
  if (!rows[0].mfa_enabled) return res.json({ ok: true });
  if (!verifyTotp(rows[0].mfa_secret, req.body?.code)) {
    return res.status(400).json({ error: "That code is not correct." });
  }
  await query("UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE user_pk = ?", [req.user.userId]);
  await query("INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)", [
    req.user.name,
    req.user.roleName,
    "Turned off two-step verification",
  ]);
  res.json({ ok: true });
}));

// --- Tickets ----------------------------------------------------------------
app.get("/api/tickets", wrap(async (req, res) => {
  const { mine, userId } = req.query ?? {};

  if (mine === "1" && userId) {
    const rows = await query(
      "SELECT t.code AS id, t.subject, t.category, t.priority, t.status, t.location, t.description, t.created_at AS createdAt, t.created_by, t.assigned_to AS assignedTo, t.reopen_count AS reopenCount, a.name AS assignedName, (SELECT COUNT(*) FROM cancellation_requests c WHERE c.ticket_pk = t.ticket_pk AND c.status = 'Pending') AS cancelPending, u.name AS userName, u.role_name AS userRole FROM tickets t LEFT JOIN users u ON u.user_pk = t.created_by LEFT JOIN users a ON a.user_pk = t.assigned_to WHERE t.created_by = ? ORDER BY t.ticket_pk DESC",
      [userId],
    );
    return res.json(rows);
  }

  const rows = await query(
    "SELECT t.code AS id, t.subject, t.category, t.priority, t.status, t.location, t.description, t.created_at AS createdAt, t.created_by, t.assigned_to AS assignedTo, t.reopen_count AS reopenCount, a.name AS assignedName, (SELECT COUNT(*) FROM cancellation_requests c WHERE c.ticket_pk = t.ticket_pk AND c.status = 'Pending') AS cancelPending, u.name AS userName, u.role_name AS userRole, u.role AS userRoleKey FROM tickets t LEFT JOIN users u ON u.user_pk = t.created_by LEFT JOIN users a ON a.user_pk = t.assigned_to ORDER BY t.ticket_pk DESC",
  );
  res.json(rows);
}));

app.patch("/api/tickets/:id/status", wrap(async (req, res) => {
  const { id } = req.params;
  const { status, actorId } = req.body ?? {};
  if (!status) {
    return res.status(400).json({ error: "status is required." });
  }

  const valid = ["Open", "In Progress", "Resolved"];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: "status must be Open, In Progress, or Resolved." });
  }

  const actors = await query("SELECT role FROM users WHERE user_pk = ? LIMIT 1", [actorId ?? 0]);
  if (!actors[0] || !["technician", "admin"].includes(actors[0].role)) {
    return res.status(403).json({ error: "Only technicians and admins can change a ticket's status." });
  }

  const tickets = await query(
    "SELECT ticket_pk, code, subject, status, created_by FROM tickets WHERE code = ? LIMIT 1",
    [id],
  );
  const ticket = tickets[0];
  if (!ticket) return res.status(404).json({ error: "Ticket not found." });
  if (ticket.status === "Cancelled") {
    return res.status(409).json({ error: "This ticket was cancelled and cannot be changed." });
  }

  // resolved_at feeds the KPI times (AHT, ART, SLA); clear it if the ticket is worked on again.
  await query(
    "UPDATE tickets SET status = ?, resolved_at = IF(? = 'Resolved', COALESCE(resolved_at, NOW()), NULL) WHERE ticket_pk = ?",
    [status, status, ticket.ticket_pk],
  );

  // Keep the requester in the loop.
  if (ticket.status !== status && ticket.created_by !== actorId) {
    if (status === "Resolved") {
      await notify([ticket.created_by], {
        type: "resolved",
        title: "Your problem has been fixed",
        body: `${ticket.code}: ${ticket.subject} was marked as resolved.`,
        ticketCode: ticket.code,
      });
      try {
        const [who] = await query(
          "SELECT u.name AS requester, a.name AS tech FROM users u LEFT JOIN users a ON a.user_pk = ? WHERE u.user_pk = ?",
          [actorId, ticket.created_by],
        );
        if (who) {
          await bot.postResolvedPrompt({
            ticketPk: ticket.ticket_pk, code: ticket.code, requesterName: who.requester, techName: who.tech,
          });
        }
      } catch (err) {
        console.error("assistant resolved prompt failed", err.message);
      }
    } else {
      await notify([ticket.created_by], {
        type: "status",
        title: `Request is now ${status}`,
        body: `${ticket.code}: ${ticket.subject}`,
        ticketCode: ticket.code,
      });
    }
  }
  res.json({ ok: true, id, status });
}));

app.post("/api/tickets", wrap(async (req, res) => {
  const { subject, category, priority, location, description, createdBy } = req.body ?? {};
  if (!subject?.trim() || !category?.trim() || !priority?.trim()) {
    return res.status(400).json({ error: "subject, category, and priority are required." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const code = await nextCode(conn, "tickets", "#HD", "tickets_archive");
    await conn.execute(
      "INSERT INTO tickets (code, subject, category, priority, status, location, description, created_by) VALUES (?, ?, ?, ?, 'Open', ?, ?, ?)",
      [code, subject, category, priority, location ?? null, description ?? null, createdBy ?? null],
    );
    await conn.commit();
    const submitters = await query("SELECT name FROM users WHERE user_pk = ?", [createdBy ?? 0]);
    await notify(await adminIds(), {
      type: "new_ticket",
      title: "New request submitted",
      body: `${submitters[0]?.name || "A user"} filed ${code} (${category}): ${subject}`,
      ticketCode: code,
    });
    try {
      const [created] = await query("SELECT ticket_pk FROM tickets WHERE code = ?", [code]);
      if (created && createdBy) {
        await bot.postGreeting({
          ticketPk: created.ticket_pk, code, subject, category, requesterName: submitters[0]?.name,
        });
      }
    } catch (err) {
      console.error("assistant greeting failed", err.message);
    }
    res.status(201).json({ id: code, subject, category, priority, status: "Open" });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// --- Ticket assignment, messaging, and cancellation requests -------------------
const CLOSED_STATUSES = ["Resolved", "Done", "Closed", "Cancelled"];
const TICKET_STAFF_ROLES = ["technician", "admin", "superadmin"];

async function ticketAccess(code, userId) {
  const tickets = await query(
    "SELECT ticket_pk, code, subject, status, created_by, assigned_to FROM tickets WHERE code = ? LIMIT 1",
    [code],
  );
  const users = await query(
    "SELECT user_pk, name, role, role_name FROM users WHERE user_pk = ? LIMIT 1",
    [userId ?? 0],
  );
  const ticket = tickets[0];
  const user = users[0];
  if (!ticket) return { error: [404, "Ticket not found."] };
  if (!user) return { error: [403, "Unknown user."] };
  const isOwner = ticket.created_by === user.user_pk;
  if (!isOwner && !TICKET_STAFF_ROLES.includes(user.role)) {
    return { error: [403, "You do not have access to this ticket."] };
  }
  return { ticket, user, isOwner };
}

async function requireAdmin(userId) {
  const rows = await query(
    "SELECT user_pk, name, role, role_name FROM users WHERE user_pk = ? LIMIT 1",
    [userId ?? 0],
  );
  return rows[0] && rows[0].role === "admin" ? rows[0] : null;
}

// Admin assigns a technician: records who, and moves the ticket to In Progress.
app.patch("/api/tickets/:id/assign", wrap(async (req, res) => {
  const { actorId, technicianId } = req.body ?? {};
  const admin = await requireAdmin(actorId);
  if (!admin) return res.status(403).json({ error: "Only admins can assign tickets." });
  const technicians = await query(
    "SELECT user_pk, name FROM users WHERE user_pk = ? AND role = 'technician' LIMIT 1",
    [technicianId ?? 0],
  );
  const technician = technicians[0];
  if (!technician) return res.status(404).json({ error: "Technician not found." });
  const tickets = await query(
    "SELECT ticket_pk, code, subject, created_by FROM tickets WHERE code = ? LIMIT 1",
    [req.params.id],
  );
  const ticket = tickets[0];
  if (!ticket) return res.status(404).json({ error: "Ticket not found." });

  const placeholders = CLOSED_STATUSES.map(() => "?").join(", ");
  const [result] = await pool.execute(
    `UPDATE tickets SET assigned_to = ?, status = 'In Progress', assigned_at = COALESCE(assigned_at, NOW()), first_response_at = COALESCE(first_response_at, NOW()) WHERE ticket_pk = ? AND status NOT IN (${placeholders})`,
    [technician.user_pk, ticket.ticket_pk, ...CLOSED_STATUSES],
  );
  if (result.affectedRows === 0) {
    return res.status(409).json({ error: "This ticket is already finished and cannot be assigned." });
  }
  await notify([technician.user_pk], {
    type: "assigned",
    title: "New ticket assigned to you",
    body: `${ticket.code}: ${ticket.subject}`,
    ticketCode: ticket.code,
  });
  await notify([ticket.created_by], {
    type: "in_progress",
    title: "A technician is on your request",
    body: `${technician.name} was assigned to ${ticket.code}: ${ticket.subject}`,
    ticketCode: ticket.code,
  });
  await query(
    "INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)",
    [admin.name, admin.role_name, `Assigned ${ticket.code} to ${technician.name}`],
  );
  res.json({ ok: true, id: ticket.code, status: "In Progress", assignedTo: technician.user_pk });
}));

// Everyone who can see this ticket's conversation: the requester, the assigned
// technician, and the admins.
app.get("/api/tickets/:id/participants", wrap(async (req, res) => {
  const access = await ticketAccess(req.params.id, req.query.userId);
  if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
  const { ticket } = access;
  const rows = await query(
    `SELECT user_pk AS userId, name, role_name AS roleName,
       CASE WHEN user_pk = ? THEN 'Requester' WHEN user_pk = ? THEN 'Technician' ELSE 'Admin' END AS part
     FROM users
     WHERE user_pk = ? OR user_pk = ? OR role = 'admin'
     ORDER BY FIELD(CASE WHEN user_pk = ? THEN 'Requester' WHEN user_pk = ? THEN 'Technician' ELSE 'Admin' END, 'Requester', 'Technician', 'Admin'), name`,
    [
      ticket.created_by ?? 0, ticket.assigned_to ?? 0,
      ticket.created_by ?? 0, ticket.assigned_to ?? 0,
      ticket.created_by ?? 0, ticket.assigned_to ?? 0,
    ],
  );
  res.json(rows);
}));

app.get("/api/tickets/:id/messages", wrap(async (req, res) => {
  const access = await ticketAccess(req.params.id, req.query.userId);
  if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
  // Staff-only assistant notes (what the requester already tried) are hidden from the requester.
  const rows = await query(
    `SELECT m.message_pk AS id, m.sender_pk AS senderId, u.name AS senderName, u.role_name AS senderRole,
       m.message_text AS text, m.kind, m.meta, m.created_at AS createdAt
     FROM ticket_messages m JOIN users u ON u.user_pk = m.sender_pk
     WHERE m.ticket_pk = ? ${access.isOwner ? "AND m.kind <> 'bot_note'" : ""} ORDER BY m.message_pk ASC LIMIT 500`,
    [access.ticket.ticket_pk],
  );
  res.json(rows.map(shapeMessage));
}));

app.post("/api/tickets/:id/messages", wrap(async (req, res) => {
  const access = await ticketAccess(req.params.id, req.body?.userId);
  if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
  const { ticket, user } = access;
  const body = String(req.body?.text ?? "").trim().slice(0, 1000);
  if (!body) return res.status(400).json({ error: "Message cannot be empty." });
  if (CLOSED_STATUSES.includes(ticket.status)) {
    return res.status(409).json({ error: `This ticket is ${ticket.status}; the chat is closed.` });
  }
  const [result] = await pool.execute(
    "INSERT INTO ticket_messages (ticket_pk, sender_pk, message_text, kind) VALUES (?, ?, ?, 'chat')",
    [ticket.ticket_pk, user.user_pk, body],
  );
  // The first reply from technician/admin counts as the first response (KPI: FRT).
  if (user.role === "technician" || user.role === "admin") {
    await query(
      "UPDATE tickets SET first_response_at = COALESCE(first_response_at, NOW()) WHERE ticket_pk = ?",
      [ticket.ticket_pk],
    );
  }

  // Group-chat style: everyone on the ticket except the sender hears about it.
  const everyone = [ticket.created_by, ticket.assigned_to, ...(await adminIds())];
  await notify(everyone.filter((id) => id && id !== user.user_pk), {
    type: "message",
    title: `New message on ${ticket.code}`,
    body: `${user.name}: ${body.slice(0, 90)}`,
    ticketCode: ticket.code,
  });
  res.status(201).json({ ok: true, id: result.insertId });
}));

// Requesters never cancel directly: they file a request and an admin decides.
async function fileCancellationRequest({ ticket, user, reason }) {
  if (!reason) return { error: [400, "Please give a reason."] };
  if (CLOSED_STATUSES.includes(ticket.status)) {
    return { error: [409, `This ticket is ${ticket.status} and can no longer be cancelled.`] };
  }
  const pending = await query(
    "SELECT code FROM cancellation_requests WHERE ticket_pk = ? AND status = 'Pending' LIMIT 1",
    [ticket.ticket_pk],
  );
  if (pending.length > 0) {
    return { error: [409, `A cancellation request (${pending[0].code}) is already waiting for an admin.`] };
  }

  const conn = await pool.getConnection();
  let code;
  try {
    await conn.beginTransaction();
    code = await nextCode(conn, "cancellation_requests", "#CR");
    await conn.execute(
      "INSERT INTO cancellation_requests (code, ticket_pk, requested_by, reason) VALUES (?, ?, ?, ?)",
      [code, ticket.ticket_pk, user.user_pk, reason],
    );
    await conn.execute(
      "INSERT INTO ticket_messages (ticket_pk, sender_pk, message_text, kind) VALUES (?, ?, ?, 'cancellation_request')",
      [ticket.ticket_pk, user.user_pk, `Cancellation Requested: ${reason}`],
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await notify(await adminIds(), {
    type: "cancellation_requested",
    title: "Cancellation request needs review",
    body: `${user.name} asked to cancel ${ticket.code}: ${reason.slice(0, 80)}`,
    ticketCode: ticket.code,
  });
  await notify([ticket.assigned_to], {
    type: "cancellation_requested",
    title: "Requester asked to cancel",
    body: `${ticket.code} has a cancellation request awaiting an admin decision.`,
    ticketCode: ticket.code,
  });
  await query(
    "INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)",
    [user.name, user.role_name, `Requested cancellation of ticket ${ticket.code}`],
  );
  return { code };
}

app.post("/api/tickets/:id/cancellation-requests", wrap(async (req, res) => {
  const access = await ticketAccess(req.params.id, req.body?.userId);
  if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
  const { ticket, user, isOwner } = access;
  if (!isOwner) {
    return res.status(403).json({ error: "Only the person who submitted the ticket can request cancellation." });
  }
  const reason = String(req.body?.reason ?? "").trim().slice(0, 500);
  const result = await fileCancellationRequest({ ticket, user, reason });
  if (result.error) return res.status(result.error[0]).json({ error: result.error[1] });
  res.status(201).json({ ok: true, id: result.code, status: "Pending" });
}));

app.get("/api/tickets/:id/cancellation-requests", wrap(async (req, res) => {
  const access = await ticketAccess(req.params.id, req.query.userId);
  if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
  const rows = await query(
    `SELECT code AS id, status, reason, review_note AS reviewNote, created_at AS createdAt
     FROM cancellation_requests WHERE ticket_pk = ? ORDER BY request_pk DESC`,
    [access.ticket.ticket_pk],
  );
  res.json(rows);
}));

// A requester can reopen a ticket that was marked Resolved when the problem is
// still there. The status guard sits in the UPDATE so a double click cannot
// reopen it twice, and the number of reopens is capped.
const MAX_REOPENS = 3;

async function reopenTicketFor({ ticket, user, reason }) {
  if (!reason) return { error: [400, "Please explain what is still wrong."] };

  const counts = await query("SELECT reopen_count FROM tickets WHERE ticket_pk = ?", [ticket.ticket_pk]);
  if (Number(counts[0]?.reopen_count) >= MAX_REOPENS) {
    return { error: [409, `This ticket was already reopened ${MAX_REOPENS} times. Please submit a new request instead.`] };
  }

  const nextStatus = ticket.assigned_to ? "In Progress" : "Open";
  const [result] = await pool.execute(
    "UPDATE tickets SET status = ?, reopen_count = reopen_count + 1, resolved_at = NULL WHERE ticket_pk = ? AND status = 'Resolved' AND reopen_count < ?",
    [nextStatus, ticket.ticket_pk, MAX_REOPENS],
  );
  if (result.affectedRows === 0) {
    return { error: [409, "Only a resolved ticket can be reopened."] };
  }

  await query(
    "INSERT INTO ticket_messages (ticket_pk, sender_pk, message_text, kind) VALUES (?, ?, ?, 'reopen')",
    [ticket.ticket_pk, user.user_pk, `Ticket reopened, the problem is still happening: ${reason}`],
  );
  const recipients = [ticket.assigned_to, ...(await adminIds())].filter((id) => id && id !== user.user_pk);
  await notify(recipients, {
    type: "reopened",
    title: "Ticket reopened: issue still persists",
    body: `${user.name} reopened ${ticket.code}: ${reason.slice(0, 90)}`,
    ticketCode: ticket.code,
  });
  await query(
    "INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)",
    [user.name, user.role_name, `Reopened ticket ${ticket.code}`],
  );
  return { status: nextStatus };
}

app.post("/api/tickets/:id/reopen", wrap(async (req, res) => {
  const access = await ticketAccess(req.params.id, req.body?.userId);
  if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
  const { ticket, user, isOwner } = access;
  if (!isOwner) {
    return res.status(403).json({ error: "Only the person who submitted the ticket can reopen it." });
  }
  const reason = String(req.body?.reason ?? "").trim().slice(0, 500);
  const result = await reopenTicketFor({ ticket, user, reason });
  if (result.error) return res.status(result.error[0]).json({ error: result.error[1] });
  res.json({ ok: true, id: ticket.code, status: result.status });
}));

// HelpDesk Assistant: guided multiple-choice chatbot in the ticket conversation (server/bot.js).
const bot = createBot({
  ticketAccess,
  adminIds,
  notify,
  fileCancellationRequest: async (args) => {
    const result = await fileCancellationRequest(args);
    return result.error ? { error: result.error[1] } : result;
  },
  reopenTicketFor: async (args) => {
    const result = await reopenTicketFor(args);
    return result.error ? { error: result.error[1] } : result;
  },
});
bot.registerBotRoutes(app, { wrap });

// Admin queue of all cancellation requests (pending first).
app.get("/api/cancellation-requests", wrap(async (req, res) => {
  const admin = await requireAdmin(req.query.userId);
  if (!admin) return res.status(403).json({ error: "Only admins can review cancellation requests." });
  const rows = await query(
    `SELECT c.code AS id, c.status, c.reason, c.review_note AS reviewNote, c.created_at AS createdAt,
       t.code AS ticketId, t.subject, t.status AS ticketStatus,
       u.name AS requesterName, u.role_name AS requesterRole
     FROM cancellation_requests c
     JOIN tickets t ON t.ticket_pk = c.ticket_pk
     JOIN users u ON u.user_pk = c.requested_by
     ORDER BY c.status = 'Pending' DESC, c.request_pk DESC LIMIT 100`,
  );
  res.json(rows);
}));

app.patch("/api/cancellation-requests/:code/status", wrap(async (req, res) => {
  const { actorId, status, note } = req.body ?? {};
  const admin = await requireAdmin(actorId);
  if (!admin) return res.status(403).json({ error: "Only admins can review cancellation requests." });
  if (!["Approved", "Rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be Approved or Rejected." });
  }
  const rows = await query(
    `SELECT c.request_pk, c.status, c.requested_by, t.ticket_pk, t.code AS ticketCode, t.subject, t.assigned_to
     FROM cancellation_requests c JOIN tickets t ON t.ticket_pk = c.ticket_pk
     WHERE c.code = ? LIMIT 1`,
    [req.params.code],
  );
  const request = rows[0];
  if (!request) return res.status(404).json({ error: "Cancellation request not found." });
  if (request.status !== "Pending") {
    return res.status(409).json({ error: `This request was already ${request.status.toLowerCase()}.` });
  }
  const cleanNote = String(note ?? "").trim().slice(0, 500) || null;

  let finalStatus = status;
  let finalNote = cleanNote;
  let blocked = false;
  if (status === "Approved") {
    const placeholders = CLOSED_STATUSES.map(() => "?").join(", ");
    const [result] = await pool.execute(
      `UPDATE tickets SET status = 'Cancelled' WHERE ticket_pk = ? AND status NOT IN (${placeholders})`,
      [request.ticket_pk, ...CLOSED_STATUSES],
    );
    if (result.affectedRows === 0) {
      // The ticket finished while the request was waiting; nothing left to cancel.
      finalStatus = "Rejected";
      finalNote = "The ticket was already finished.";
      blocked = true;
    }
  }
  await query(
    "UPDATE cancellation_requests SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE request_pk = ?",
    [finalStatus, finalNote, admin.user_pk, request.request_pk],
  );
  const approved = finalStatus === "Approved";
  await query(
    "INSERT INTO ticket_messages (ticket_pk, sender_pk, message_text, kind) VALUES (?, ?, ?, 'cancellation_decision')",
    [
      request.ticket_pk,
      admin.user_pk,
      `Cancellation request ${approved ? "approved" : "declined"} by ${admin.name}${finalNote ? `: ${finalNote}` : "."}`,
    ],
  );
  await notify([request.requested_by], {
    type: approved ? "cancellation_approved" : "cancellation_rejected",
    title: approved ? "Cancellation approved" : "Cancellation declined",
    body: approved
      ? `${request.ticketCode} has been cancelled.`
      : `${request.ticketCode} stays open.${finalNote ? ` Admin note: ${finalNote}` : ""}`,
    ticketCode: request.ticketCode,
  });
  await notify([request.assigned_to], {
    type: approved ? "cancellation_approved" : "cancellation_rejected",
    title: approved ? "Ticket cancelled" : "Cancellation declined",
    body: approved
      ? `${request.ticketCode} was cancelled at the requester's request. You can stop working on it.`
      : `${request.ticketCode} was not cancelled. Please continue working on it.`,
    ticketCode: request.ticketCode,
  });
  await query(
    "INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)",
    [admin.name, admin.role_name, `${finalStatus} cancellation request ${req.params.code} for ${request.ticketCode}`],
  );
  if (blocked) {
    return res.status(409).json({ error: "That ticket was already finished, so the request was closed.", status: finalStatus });
  }
  res.json({ ok: true, id: req.params.code, status: finalStatus });
}));

// --- Reports (Super Admin) -----------------------------------------------------
// One round trip returns every aggregation the Report Manager charts need. All
// breakdowns respect the same filters: date range, ticket category, requester role.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

app.get("/api/reports/summary", verifyReportViewer, wrap(async (req, res) => {

  const from = ISO_DATE.test(req.query.from ?? "") ? req.query.from : null;
  const to = ISO_DATE.test(req.query.to ?? "") ? req.query.to : null;
  const category = req.query.category && req.query.category !== "All" ? String(req.query.category) : null;
  const role = req.query.role && req.query.role !== "All" ? String(req.query.role) : null;

  const where = ["1 = 1"];
  const params = [];
  if (from) { where.push("t.created_at >= ?"); params.push(`${from} 00:00:00`); }
  if (to) { where.push("t.created_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(to); }
  if (category) { where.push("t.category = ?"); params.push(category); }
  if (role) { where.push("u.role = ?"); params.push(role); }
  const filter = `FROM tickets_all t LEFT JOIN users u ON u.user_pk = t.created_by LEFT JOIN users a ON a.user_pk = t.assigned_to WHERE ${where.join(" AND ")}`;

  // `expression` and `order` are fixed strings from this file, never user input.
  const grouped = async (expression, { order = "value DESC", limit = 50 } = {}) => {
    const rows = await query(
      `SELECT COALESCE(${expression}, 'Unspecified') AS label, COUNT(*) AS value ${filter} GROUP BY label ORDER BY ${order} LIMIT ${limit}`,
      params,
    );
    return rows.map((row) => ({ label: row.label, value: Number(row.value) }));
  };

  const [totalsRow] = await query(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(t.status = 'Resolved'), 0) AS resolved,
       COALESCE(SUM(t.status IN ('Open', 'In Progress')), 0) AS backlog,
       COALESCE(SUM(t.status = 'Cancelled'), 0) AS cancelled,
       COALESCE(SUM(t.priority = 'High'), 0) AS high ${filter}`,
    params,
  );

  const [byStatus, byCategory, byPriority, byRole, byLocation, dayRows, usersByRole] = await Promise.all([
    grouped("t.status", { order: "FIELD(label, 'Open', 'In Progress', 'Resolved', 'Cancelled')" }),
    grouped("t.category"),
    grouped("t.priority", { order: "FIELD(label, 'High', 'Medium', 'Low')" }),
    grouped("u.role_name"),
    grouped("NULLIF(TRIM(t.location), '')", { limit: 12 }),
    query(
      `SELECT DATE_FORMAT(t.created_at, '%Y-%m-%d') AS day, COUNT(*) AS value ${filter} GROUP BY day ORDER BY day`,
      params,
    ),
    query("SELECT role_name AS label, COUNT(*) AS value FROM users WHERE role <> 'bot' GROUP BY role_name ORDER BY value DESC"),
  ]);

  // Fill quiet days with zero so the line chart has no gaps (kept to a sane span).
  const counts = new Map(dayRows.map((row) => [row.day, Number(row.value)]));
  let byDay = dayRows.map((row) => ({ label: row.day, value: Number(row.value) }));
  if (from && to) {
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    const span = Math.round((end - start) / 86400000) + 1;
    if (span > 0 && span <= 120) {
      byDay = Array.from({ length: span }, (_, i) => {
        const key = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
        return { label: key, value: counts.get(key) || 0 };
      });
    }
  }

  res.json({
    filters: { from, to, category: category || "All", role: role || "All" },
    totals: {
      total: Number(totalsRow.total),
      resolved: Number(totalsRow.resolved),
      backlog: Number(totalsRow.backlog),
      cancelled: Number(totalsRow.cancelled),
      high: Number(totalsRow.high),
    },
    byStatus,
    byCategory,
    byPriority,
    byRole,
    byLocation,
    byDay,
    usersByRole: usersByRole.map((row) => ({ label: row.label, value: Number(row.value) })),
  });
}));

// --- Notifications -----------------------------------------------------------
app.get("/api/notifications", wrap(async (req, res) => {
  const userId = Number(req.query.userId);
  if (!userId) return res.status(400).json({ error: "userId is required." });
  const items = await query(
    `SELECT notification_pk AS id, type, title, body, ticket_code AS ticketCode,
       created_at AS createdAt, read_at IS NOT NULL AS \`read\`
     FROM notifications WHERE user_pk = ? ORDER BY notification_pk DESC LIMIT 50`,
    [userId],
  );
  const counts = await query(
    "SELECT COUNT(*) AS n FROM notifications WHERE user_pk = ? AND read_at IS NULL",
    [userId],
  );
  res.json({
    unread: Number(counts[0].n),
    items: items.map((item) => ({ ...item, read: Boolean(item.read) })),
  });
}));

// Marks the given notifications (or all of them when ids is omitted) as read.
app.post("/api/notifications/read", wrap(async (req, res) => {
  const userId = Number(req.body?.userId);
  if (!userId) return res.status(400).json({ error: "userId is required." });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : null;
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => "?").join(", ");
    await pool.execute(
      `UPDATE notifications SET read_at = NOW() WHERE user_pk = ? AND read_at IS NULL AND notification_pk IN (${placeholders})`,
      [userId, ...ids],
    );
  } else if (!ids) {
    await query("UPDATE notifications SET read_at = NOW() WHERE user_pk = ? AND read_at IS NULL", [userId]);
  }
  res.json({ ok: true });
}));

// --- Activities -------------------------------------------------------------
app.get("/api/activities", wrap(async (_req, res) => {
  const rows = await query(
    "SELECT actor_name, actor_role, action, created_at FROM activities ORDER BY activity_pk DESC",
  );
  // Shape into the [timestamp, name, role, action] tuple the UI expects.
  res.json(
    rows.map((r) => [
      new Date(r.created_at).toLocaleString(),
      r.actor_name,
      r.actor_role,
      r.action,
    ]),
  );
}));

app.post("/api/activities", wrap(async (req, res) => {
  const { name, roleName, action } = req.body ?? {};
  if (!name || !roleName || !action) {
    return res.status(400).json({ error: "name, roleName, and action are required." });
  }
  await query(
    "INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)",
    [name, roleName, action],
  );
  res.status(201).json({ ok: true });
}));

// --- Users ------------------------------------------------------------------
const parseSkills = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

app.get("/api/users", wrap(async (_req, res) => {
  const rows = await query(
    "SELECT user_pk AS userId, id_number AS id, name, role_name AS role, role AS roleKey, email, skills FROM users WHERE role <> 'bot' ORDER BY user_pk",
  );
  res.json(rows.map((row) => ({ ...row, skills: parseSkills(row.skills) })));
}));

// Admins assign the skills a technician is recommended for.
app.patch("/api/users/:userId/skills", wrap(async (req, res) => {
  const { actorId, skills } = req.body ?? {};
  const actors = await query("SELECT role FROM users WHERE user_pk = ? LIMIT 1", [actorId ?? 0]);
  if (!actors[0] || !["admin", "superadmin"].includes(actors[0].role)) {
    return res.status(403).json({ error: "Only admins can assign technician skills." });
  }
  if (!Array.isArray(skills)) {
    return res.status(400).json({ error: "skills must be a list." });
  }
  const targets = await query(
    "SELECT user_pk, name FROM users WHERE user_pk = ? AND role = 'technician' LIMIT 1",
    [req.params.userId],
  );
  if (!targets[0]) {
    return res.status(404).json({ error: "Technician not found." });
  }
  const clean = [...new Set(skills.map((s) => String(s).trim()).filter(Boolean))];
  await query("UPDATE users SET skills = ? WHERE user_pk = ?", [clean.join(","), targets[0].user_pk]);
  const actorRows = await query("SELECT name, role_name FROM users WHERE user_pk = ?", [actorId]);
  await query(
    "INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)",
    [
      actorRows[0].name,
      actorRows[0].role_name,
      `Set skills for ${targets[0].name}: ${clean.join(", ") || "none"}`,
    ],
  );
  await notify([targets[0].user_pk], {
    type: "skills",
    title: "Your skills were updated",
    body: clean.length ? `You are now matched to: ${clean.join(", ")}.` : "You currently have no skills assigned.",
  });
  res.json({ ok: true, skills: clean });
}));

// Admins can switch an account between Employee and Technician.
app.patch("/api/users/:userId/role", wrap(async (req, res) => {
  const { actorId, role } = req.body ?? {};
  const actors = await query(
    "SELECT name, role, role_name FROM users WHERE user_pk = ? LIMIT 1",
    [actorId ?? 0],
  );
  const actor = actors[0];
  if (!actor || actor.role !== "admin") {
    return res.status(403).json({ error: "Only admins can change a user's type." });
  }
  if (!["employee", "technician"].includes(role)) {
    return res.status(400).json({ error: "Type must be employee or technician." });
  }
  const targets = await query(
    "SELECT user_pk, id_number, name, role FROM users WHERE user_pk = ? LIMIT 1",
    [req.params.userId],
  );
  const target = targets[0];
  if (!target || !["employee", "technician"].includes(target.role)) {
    return res.status(404).json({ error: "Only employees and technicians can be changed." });
  }
  if (target.role === role) {
    return res.json({ ok: true, role, roleName: role === "employee" ? "Employee" : "Technician" });
  }
  const clash = await query(
    "SELECT user_pk FROM users WHERE id_number = ? AND role = ? LIMIT 1",
    [target.id_number, role],
  );
  if (clash.length > 0) {
    return res.status(409).json({
      error: `A ${role} account with ID ${target.id_number} already exists.`,
    });
  }
  const roleName = role === "employee" ? "Employee" : "Technician";
  // Skills only apply to technicians, so clear them when leaving that role.
  await query(
    "UPDATE users SET role = ?, role_name = ?, skills = IF(? = 'technician', skills, '') WHERE user_pk = ?",
    [role, roleName, role, target.user_pk],
  );
  await query(
    "INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)",
    [actor.name, actor.role_name, `Changed ${target.name} from ${target.role} to ${role}`],
  );
  await notify([target.user_pk], {
    type: "role",
    title: "Your account type changed",
    body: `An admin changed your account to ${roleName}. Log in again as a ${roleName} to continue.`,
  });
  res.json({ ok: true, role, roleName });
}));

// --- Messaging (admins <-> technicians only) -----------------------------------
const CHAT_ROLES = ["admin", "technician"];

async function chatUser(userId) {
  const rows = await query(
    "SELECT user_pk, name, role, role_name FROM users WHERE user_pk = ? LIMIT 1",
    [userId ?? 0],
  );
  return rows[0] && CHAT_ROLES.includes(rows[0].role) ? rows[0] : null;
}

// Contacts for the chat dock, with last message + unread count per contact.
app.get("/api/messages/contacts", wrap(async (req, res) => {
  const me = await chatUser(req.query.userId);
  if (!me) return res.status(403).json({ error: "Messaging is limited to admins and technicians." });
  const rows = await query(
    `SELECT u.user_pk AS userId, u.name, u.role_name AS roleName,
       (SELECT body FROM messages m WHERE (m.sender_pk = u.user_pk AND m.recipient_pk = ?) OR (m.sender_pk = ? AND m.recipient_pk = u.user_pk) ORDER BY m.message_pk DESC LIMIT 1) AS lastBody,
       (SELECT created_at FROM messages m WHERE (m.sender_pk = u.user_pk AND m.recipient_pk = ?) OR (m.sender_pk = ? AND m.recipient_pk = u.user_pk) ORDER BY m.message_pk DESC LIMIT 1) AS lastAt,
       (SELECT COUNT(*) FROM messages m WHERE m.sender_pk = u.user_pk AND m.recipient_pk = ? AND m.read_at IS NULL) AS unread
     FROM users u WHERE u.role IN ('admin','technician') AND u.user_pk <> ?
     ORDER BY lastAt IS NULL, lastAt DESC, u.name`,
    [me.user_pk, me.user_pk, me.user_pk, me.user_pk, me.user_pk, me.user_pk],
  );
  res.json(rows.map((r) => ({ ...r, unread: Number(r.unread) })));
}));

// Conversation with one contact. Fetching marks their messages as read.
app.get("/api/messages", wrap(async (req, res) => {
  const me = await chatUser(req.query.userId);
  const other = await chatUser(req.query.withId);
  if (!me || !other) return res.status(403).json({ error: "Messaging is limited to admins and technicians." });
  await query(
    "UPDATE messages SET read_at = NOW() WHERE sender_pk = ? AND recipient_pk = ? AND read_at IS NULL",
    [other.user_pk, me.user_pk],
  );
  const rows = await query(
    `SELECT m.message_pk AS id, m.sender_pk AS senderId, s.name AS senderName, s.role_name AS senderRole,
       m.body, m.created_at AS createdAt
     FROM messages m JOIN users s ON s.user_pk = m.sender_pk
     WHERE (m.sender_pk = ? AND m.recipient_pk = ?) OR (m.sender_pk = ? AND m.recipient_pk = ?)
     ORDER BY m.message_pk ASC LIMIT 200`,
    [me.user_pk, other.user_pk, other.user_pk, me.user_pk],
  );
  res.json(rows);
}));

app.post("/api/messages", wrap(async (req, res) => {
  const { senderId, recipientId, body } = req.body ?? {};
  const sender = await chatUser(senderId);
  const recipient = await chatUser(recipientId);
  if (!sender || !recipient || sender.user_pk === recipient.user_pk) {
    return res.status(403).json({ error: "Messaging is limited to admins and technicians." });
  }
  const text = String(body ?? "").trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: "Message cannot be empty." });
  const result = await pool.execute(
    "INSERT INTO messages (sender_pk, recipient_pk, body) VALUES (?, ?, ?)",
    [sender.user_pk, recipient.user_pk, text],
  );
  res.status(201).json({ id: result[0].insertId, ok: true });
}));

// --- Profile ----------------------------------------------------------------
// The profile panel shows the signed-in account details. Password is included
// so the eye toggle can reveal it; this matches the plaintext prototype (see
// the login NOTE above) and must be hashed before any real deployment.
app.get("/api/profile/:userId", wrap(async (req, res) => {
  const rows = await query(
    "SELECT user_pk AS userId, id_number AS id, name, role, role_name AS roleName, email, mfa_enabled AS mfaEnabled FROM users WHERE user_pk = ? LIMIT 1",
    [req.params.userId],
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: "Account not found." });
  }
  res.json(rows[0]);
}));

// --- Password change requests ----------------------------------------------
// Users file a change-password request (like a ticket) and wait; an admin
// approves or declines it. Approval writes the new password to the account.
app.get("/api/password-requests", wrap(async (req, res) => {
  const { userId } = req.query ?? {};
  const base = `
    SELECT pr.code AS id, pr.status, pr.reason, pr.review_note AS reviewNote,
           pr.created_at AS requestedAt, pr.reviewed_at AS reviewedAt,
           u.user_pk AS userId, u.id_number AS userNumber, u.name AS userName,
           u.role_name AS userRole, reviewer.name AS reviewedBy
    FROM password_requests pr
    JOIN users u ON u.user_pk = pr.user_pk
    LEFT JOIN users reviewer ON reviewer.user_pk = pr.reviewed_by`;
  const rows = userId
    ? await query(`${base} WHERE pr.user_pk = ? ORDER BY pr.request_pk DESC`, [userId])
    : await query(`${base} ORDER BY pr.request_pk DESC`);

  res.json(
    rows.map((row) => ({
      ...row,
      requestedAt: row.requestedAt ? new Date(row.requestedAt).toLocaleString() : "",
      reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toLocaleString() : null,
    })),
  );
}));

app.post("/api/password-requests", wrap(async (req, res) => {
  const { userId, newPassword, reason } = req.body ?? {};
  if (!userId || !newPassword) {
    return res.status(400).json({ error: "userId and newPassword are required." });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters." });
  }

  const accounts = await query(
    "SELECT user_pk, name FROM users WHERE user_pk = ? LIMIT 1",
    [userId],
  );
  if (accounts.length === 0) {
    return res.status(404).json({ error: "Account not found." });
  }

  const pending = await query(
    "SELECT code FROM password_requests WHERE user_pk = ? AND status = 'Pending' LIMIT 1",
    [userId],
  );
  if (pending.length > 0) {
    return res.status(409).json({
      error: `You already have a pending request (${pending[0].code}). Wait for the admin to review it first.`,
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const code = await nextCode(conn, "password_requests", "#PW");
    await conn.execute(
      "INSERT INTO password_requests (code, user_pk, new_password, reason) VALUES (?, ?, ?, ?)",
      [code, userId, await hashPassword(newPassword), reason?.trim() || null],
    );
    await conn.commit();
    await notify(await adminIds(), {
      type: "password_request",
      title: "Password change request",
      body: `${accounts[0].name} asked to change their password (${code}).`,
    });
    res.status(201).json({
      id: code,
      status: "Pending",
      message: "Password change request sent to the admin for review.",
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

app.patch("/api/password-requests/:id/status", wrap(async (req, res) => {
  const { id } = req.params;
  const { status, note, reviewedBy } = req.body ?? {};
  if (!["Approved", "Rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be Approved or Rejected." });
  }

  const rows = await query(
    "SELECT pr.request_pk, pr.status, pr.user_pk, pr.new_password, u.name AS userName FROM password_requests pr JOIN users u ON u.user_pk = pr.user_pk WHERE pr.code = ? LIMIT 1",
    [id],
  );
  const requestRow = rows[0];
  if (!requestRow) {
    return res.status(404).json({ error: "Password change request not found." });
  }
  if (requestRow.status !== "Pending") {
    return res.status(409).json({ error: `This request was already ${requestRow.status.toLowerCase()}.` });
  }

  let reviewer = null;
  if (reviewedBy) {
    const reviewers = await query(
      "SELECT name, role_name FROM users WHERE user_pk = ? LIMIT 1",
      [reviewedBy],
    );
    reviewer = reviewers[0] || null;
  }

  // Approving applies the requested password to the account.
  if (status === "Approved") {
    await query("UPDATE users SET password = ? WHERE user_pk = ?", [
      requestRow.new_password,
      requestRow.user_pk,
    ]);
  }

  await query(
    "UPDATE password_requests SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE code = ?",
    [status, note?.trim() || null, reviewer ? reviewedBy : null, id],
  );

  await query(
    "INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)",
    [
      reviewer?.name || "Admin",
      reviewer?.role_name || "Admin",
      `${status} password change request ${id} for ${requestRow.userName}`,
    ],
  );

  await notify([requestRow.user_pk], {
    type: status === "Approved" ? "password_approved" : "password_rejected",
    title: status === "Approved" ? "Password change approved" : "Password change declined",
    body:
      status === "Approved"
        ? "Your new password is active. Use it the next time you log in."
        : `Your password change request was declined.${note?.trim() ? ` Admin note: ${note.trim()}` : ""}`,
  });

  res.json({ ok: true, id, status });
}));

// --- Monthly KPI scorecard -------------------------------------------------------
registerKpiRoutes(app, wrap);
registerSuperAdminRoutes(app, { wrap, notify });

// --- Error handler ----------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`HelpDesk API listening on http://localhost:${PORT}`);
});
