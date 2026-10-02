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
      "SELECT t.code AS id, t.subject, t.category, t.priority, t.status, t.created_by, u.name AS userName, u.role_name AS userRole FROM tickets t LEFT JOIN users u ON u.user_pk = t.created_by WHERE t.created_by = ? ORDER BY t.ticket_pk DESC",
      [userId],
    );
    return res.json(rows);
  }

  const rows = await query(
    "SELECT t.code AS id, t.subject, t.category, t.priority, t.status, t.created_by, u.name AS userName, u.role_name AS userRole, u.role AS userRoleKey FROM tickets t LEFT JOIN users u ON u.user_pk = t.created_by ORDER BY t.ticket_pk DESC",
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
app.get("/api/users", wrap(async (_req, res) => {
  const rows = await query(
    "SELECT id_number AS id, name, role_name AS role, email FROM users ORDER BY user_pk",
  );
  res.json(rows);
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
