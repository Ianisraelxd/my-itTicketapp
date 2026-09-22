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

// --- Error handler ----------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`HelpDesk API listening on http://localhost:${PORT}`);
});
