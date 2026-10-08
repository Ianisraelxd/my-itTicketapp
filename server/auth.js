// Authentication + authorization for the whole API.
//
//   authenticate        every /api request except login/signup/health must carry a valid
//                       "Authorization: Bearer <token>" session token. The user is reloaded
//                       from the database on each request, so a revoked admin loses access
//                       immediately. It also stamps the caller's id onto the request fields
//                       that name "the acting user" (userId, actorId, senderId, createdBy,
//                       reviewedBy), so a client can no longer act as someone else.
//   requireRoles(...)   guard for individual routes.
//   verifyReportViewer  Super Admin and Report Viewer (read-only dashboards / analytics).
//   verifySuperAdmin    Super Admin only (every write / delete on governance data).
import { query } from "./db.js";
import { verifyToken } from "./security.js";

const PUBLIC_ROUTES = new Set(["GET /health", "POST /login", "POST /login/mfa", "POST /signup"]);
const IDENTITY_FIELDS = ["userId", "actorId", "senderId", "createdBy", "reviewedBy"];
const REVIEWERS = ["admin", "superadmin"];
const STAFF = ["technician", "admin", "superadmin", "report_viewer"];

export const READ_ONLY_ROLES = ["report_viewer"];

// Rules that depend on who is asking. Return a message to refuse the request.
function policy(req, user) {
  const route = `${req.method} ${req.path}`;

  // Read-only role: dashboards and analytics, never a write.
  if (READ_ONLY_ROLES.includes(user.role) && req.method !== "GET") {
    return [403, "Your account is read-only."];
  }
  if (route === "GET /users" && !STAFF.includes(user.role)) {
    return [403, "You do not have access to the user list."];
  }
  if (route === "GET /activities" && !["admin", "superadmin", "report_viewer"].includes(user.role)) {
    return [403, "You do not have access to the activity log."];
  }
  if (req.path.startsWith("/profile/")) {
    const target = req.path.split("/")[2];
    if (String(target) !== String(user.userId) && !REVIEWERS.includes(user.role)) {
      return [403, "You can only open your own profile."];
    }
  }
  return null;
}

function stampIdentity(req, user) {
  const self = user.userId;

  // Express 5 builds req.query on every access, so work on a copy and pin it.
  const query = { ...req.query };
  for (const field of IDENTITY_FIELDS) {
    if (query[field] !== undefined) query[field] = String(self);
  }
  // The caller is always "the acting user", whether or not the client said so.
  // (Password-request review lists everyone's requests when no userId is given.)
  if (req.path !== "/password-requests") query.userId = String(self);

  // Requesters only ever see their own tickets and password requests.
  if (req.method === "GET" && req.path === "/tickets" && ["student", "employee"].includes(user.role)) {
    query.mine = "1";
    query.userId = String(self);
  }
  if (req.method === "GET" && req.path === "/password-requests" && !REVIEWERS.includes(user.role)) {
    query.userId = String(self);
  }
  Object.defineProperty(req, "query", { value: query, writable: true, configurable: true, enumerable: true });

  if (req.method === "GET") return;
  if (!req.body || typeof req.body !== "object") req.body = {};
  for (const field of IDENTITY_FIELDS) {
    if (req.body[field] !== undefined) req.body[field] = self;
  }

  // Routes where the acting user must exist even if the client left it out.
  req.body.userId = self;
  req.body.actorId = self;
  if (req.method === "POST" && req.path === "/tickets") req.body.createdBy = self;
  if (req.method === "POST" && req.path === "/messages") req.body.senderId = self;
  if (req.method === "POST" && req.path === "/password-requests") req.body.userId = self;
  if (req.method === "POST" && req.path === "/activities") {
    req.body.name = user.name;
    req.body.roleName = user.roleName;
  }
}

export async function authenticate(req, res, next) {
  try {
    if (PUBLIC_ROUTES.has(`${req.method} ${req.path}`)) return next();

    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const payload = token ? verifyToken(token, "session") : null;
    if (!payload) return res.status(401).json({ error: "Please sign in again." });

    const rows = await query(
      "SELECT user_pk, name, role, role_name FROM users WHERE user_pk = ? LIMIT 1",
      [payload.sub],
    );
    if (!rows[0]) return res.status(401).json({ error: "Please sign in again." });

    const user = {
      userId: rows[0].user_pk,
      name: rows[0].name,
      role: rows[0].role,
      roleName: rows[0].role_name,
    };
    req.user = user;

    const refusal = policy(req, user);
    if (refusal) return res.status(refusal[0]).json({ error: refusal[1] });

    stampIdentity(req, user);
    next();
  } catch (error) {
    next(error);
  }
}

export const requireRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: "You do not have permission to do that." });
  }
  next();
};

// Both may read the analytics endpoints (Recharts dashboards, KPIs, reports).
export const verifyReportViewer = requireRoles("superadmin", "report_viewer");
// Writes and deletes on governance data: Super Admin only.
export const verifySuperAdmin = requireRoles("superadmin");
