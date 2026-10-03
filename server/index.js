import "dotenv/config";
import express from "express";
import { pool, query } from "./db.js";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 3001;

// Wrap async route handlers so thrown errors reach the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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

  await query(
    "INSERT INTO users (id_number, password, name, role, role_name, email) VALUES (?, ?, ?, ?, ?, ?)",
    [trimmedId, password, trimmedName, role, roleName, trimmedEmail],
  );

  res.status(201).json({
    ok: true,
    message: "Account created successfully.",
  });
}));

app.post("/api/login", wrap(async (req, res) => {
  const { id, password, role } = req.body ?? {};
  if (!id || !password || !role) {
    return res.status(400).json({ error: "id, password, and role are required." });
  }
  const rows = await query(
    "SELECT user_pk, id_number, password, name, role, role_name FROM users WHERE id_number = ? AND role = ? LIMIT 1",
    [id, role],
  );
  const account = rows[0];
  if (!account || account.password !== password) {
    return res.status(401).json({ error: "Incorrect ID, password, or selected role." });
  }
  await query(
    "INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)",
    [account.name, account.role_name, "Logged into the HelpDesk system"],
  );
  res.json({
    userId: account.user_pk,
    id: account.id_number,
    name: account.name,
    role: account.role,
    roleName: account.role_name,
  });
}));

// --- Tickets ----------------------------------------------------------------
app.get("/api/tickets", wrap(async (req, res) => {
  const { mine, userId } = req.query ?? {};

  if (mine === "1" && userId) {
    const rows = await query(
      "SELECT t.code AS id, t.subject, t.category, t.priority, t.status, t.location, t.created_at AS createdAt, t.created_by, u.name AS userName, u.role_name AS userRole FROM tickets t LEFT JOIN users u ON u.user_pk = t.created_by WHERE t.created_by = ? ORDER BY t.ticket_pk DESC",
      [userId],
    );
    return res.json(rows);
  }

  const rows = await query(
    "SELECT t.code AS id, t.subject, t.category, t.priority, t.status, t.location, t.created_at AS createdAt, t.created_by, u.name AS userName, u.role_name AS userRole, u.role AS userRoleKey FROM tickets t LEFT JOIN users u ON u.user_pk = t.created_by ORDER BY t.ticket_pk DESC",
  );
  res.json(rows);
}));

app.patch("/api/tickets/:id/status", wrap(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body ?? {};
  if (!status) {
    return res.status(400).json({ error: "status is required." });
  }

  const valid = ["Open", "In Progress", "Resolved"];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: "status must be Open, In Progress, or Resolved." });
  }

  await query("UPDATE tickets SET status = ? WHERE code = ?", [status, id]);
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
    const [countRows] = await conn.execute("SELECT COUNT(*) AS n FROM tickets");
    const code = `#HD${String(countRows[0].n + 1).padStart(3, "0")}`;
    await conn.execute(
      "INSERT INTO tickets (code, subject, category, priority, status, location, description, created_by) VALUES (?, ?, ?, ?, 'Open', ?, ?, ?)",
      [code, subject, category, priority, location ?? null, description ?? null, createdBy ?? null],
    );
    await conn.commit();
    res.status(201).json({ id: code, subject, category, priority, status: "Open" });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
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
    "SELECT user_pk AS userId, id_number AS id, name, role_name AS role, role AS roleKey, email, skills FROM users ORDER BY user_pk",
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
    "SELECT user_pk AS userId, id_number AS id, name, role, role_name AS roleName, email, password FROM users WHERE user_pk = ? LIMIT 1",
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
    const [countRows] = await conn.execute("SELECT COUNT(*) AS n FROM password_requests");
    const code = `#PW${String(countRows[0].n + 1).padStart(3, "0")}`;
    await conn.execute(
      "INSERT INTO password_requests (code, user_pk, new_password, reason) VALUES (?, ?, ?, ?)",
      [code, userId, String(newPassword), reason?.trim() || null],
    );
    await conn.commit();
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

  res.json({ ok: true, id, status });
}));

// --- Error handler ----------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`HelpDesk API listening on http://localhost:${PORT}`);
});
