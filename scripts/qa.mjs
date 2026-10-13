// API quality checks: authentication, access control, input validation, concurrency and speed.
// Run against a database created from server/schema.sql (never your real data):
//   API=http://localhost:3001/api node scripts/qa.mjs
// It creates test tickets and accounts, so use a demo or empty database.

const API = (process.env.API || "http://localhost:3001/api").replace(/\/$/, "");
const results = { pass: 0, fail: [] };

function check(condition, name, detail = "") {
  if (condition) results.pass += 1;
  else {
    results.fail.push(`${name}${detail ? ` -> ${detail}` : ""}`);
    console.log("  FAIL:", name, detail);
  }
}
const section = (title) => console.log(`\n# ${title}`);

async function raw(method, path, { token, body, headers = {}, rawBody } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(rawBody === undefined && body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function login(role, password, id = "2404154") {
  const response = await raw("POST", "/login", { body: { id, password, role } });
  return response.json;
}

const accounts = {};
for (const [name, role, password] of [
  ["student", "student", "123456student"],
  ["staff", "staff", "123456employee"],
  ["agent", "agent", "123456technician"],
  ["admin", "admin", "123456admin"],
  ["superadmin", "superadmin", "123456superadmin"],
  ["viewer", "report_viewer", "123456viewer"],
]) {
  accounts[name] = await login(role, password);
  if (!accounts[name]?.token) throw new Error(`Cannot sign in as ${name}: ${JSON.stringify(accounts[name])}. Use a fresh demo database.`);
}
const tok = (name) => accounts[name].token;
const rooms = (await raw("GET", "/locations", { token: tok("student") })).json;
const ROOM = rooms[0].id;
const ticketBody = (over = {}) => ({
  subject: "QA ticket",
  category: "Hardware",
  locationId: ROOM,
  impactLevel: "Individual",
  urgencyLevel: "Medium",
  description: "QA test",
  ...over,
});
const enc = encodeURIComponent;

// ---------------------------------------------------------------------------------------
section("Basics and error handling");
{
  const health = await raw("GET", "/health");
  check(health.status === 200, "health 200");
  check(health.headers.get("x-content-type-options") === "nosniff", "security headers");
  check(/no-store/.test(health.headers.get("cache-control") || ""), "no-store");
  check(!health.headers.get("x-powered-by"), "x-powered-by hidden");

  const missing = await raw("GET", "/does-not-exist", { token: tok("student") });
  check(missing.status === 404 && missing.json, "unknown route -> JSON 404", `${missing.status} ${missing.text.slice(0, 60)}`);

  const bad = await raw("POST", "/login", { rawBody: "{not json", headers: { "Content-Type": "application/json" } });
  check(bad.status === 400 && bad.json && !/at .*\.js/.test(bad.text), "malformed JSON -> clean 400", `${bad.status} ${bad.text.slice(0, 80)}`);

  const huge = await raw("POST", "/login", { body: { id: "x".repeat(200000), password: "a", role: "student" } });
  check(huge.status === 413 && huge.json, "oversized body -> JSON 413", `${huge.status} ${huge.text.slice(0, 80)}`);
}

// ---------------------------------------------------------------------------------------
section("Authentication");
{
  const noToken = await raw("GET", "/tickets");
  check(noToken.status === 401, "no token -> 401");
  check((await raw("GET", "/tickets", { token: "garbage" })).status === 401, "garbage token -> 401");
  const tampered = tok("student").slice(0, -3) + "abc";
  check((await raw("GET", "/tickets", { token: tampered })).status === 401, "tampered token -> 401");
  const noneAlg = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "4", purpose: "session" })).toString("base64url")}.`;
  check((await raw("GET", "/tickets", { token: noneAlg })).status === 401, "alg=none token -> 401");

  for (const [label, body] of [
    ["empty body", {}],
    ["SQL injection id", { id: "' OR 1=1 --", password: "x", role: "student" }],
    ["SQL injection password", { id: "2404154", password: "' OR '1'='1", role: "student" }],
    ["object id", { id: { $ne: 1 }, password: "x", role: "student" }],
    ["array password", { id: "2404154", password: ["a"], role: "student" }],
    ["number role", { id: "2404154", password: "x", role: 5 }],
    ["role bot", { id: "assistant", password: "scrypt$locked$locked", role: "bot" }],
    ["very long id", { id: "9".repeat(5000), password: "x", role: "student" }],
  ]) {
    const response = await raw("POST", "/login", { body });
    check(response.status >= 400 && response.status < 500 && !response.json?.token, `login rejects: ${label}`, String(response.status));
  }
}

// ---------------------------------------------------------------------------------------
section("Sign up");
{
  const stamp = Date.now();
  const make = (over = {}) => ({ fullName: "QA User", id: `qa${stamp}${Math.random().toString(36).slice(2, 6)}`, email: "qa@example.com", userType: "Student", password: "secret12", ...over });
  const good = await raw("POST", "/signup", { body: make() });
  check(good.status === 201, "signup ok", String(good.status));
  const dupBody = make();
  await raw("POST", "/signup", { body: dupBody });
  check((await raw("POST", "/signup", { body: dupBody })).status === 409, "duplicate signup -> 409");
  check((await raw("POST", "/signup", { body: make({ password: "123" }) })).status === 400, "short password -> 400");
  check((await raw("POST", "/signup", { body: make({ fullName: "" }) })).status === 400, "empty name -> 400");
  const longName = await raw("POST", "/signup", { body: make({ fullName: "N".repeat(5000) }) });
  check(longName.status === 400, "5000-char name rejected", String(longName.status));
  const longId = await raw("POST", "/signup", { body: make({ id: "I".repeat(100) }) });
  check(longId.status === 400, "100-char id rejected", String(longId.status));
  const badEmail = await raw("POST", "/signup", { body: make({ email: "not-an-email" }) });
  check(badEmail.status === 400, "invalid email rejected", String(badEmail.status));
  const escalate = make({ userType: "Admin" });
  await raw("POST", "/signup", { body: escalate });
  const asStudent = await login("student", "secret12", escalate.id);
  check(asStudent?.role === "student" || !asStudent?.token, "signup cannot create an admin", JSON.stringify(asStudent).slice(0, 80));
  const staffSignup = make({ userType: "University Staff" });
  await raw("POST", "/signup", { body: staffSignup });
  check((await login("staff", "secret12", staffSignup.id))?.role === "staff", "University Staff signup -> staff role");
  const xss = make({ fullName: "<img src=x onerror=alert(1)>" });
  check((await raw("POST", "/signup", { body: xss })).status === 201, "xss-looking name stored as text");
}

// ---------------------------------------------------------------------------------------
section("Access control matrix");
{
  const ticket = (await raw("POST", "/tickets", { token: tok("student"), body: ticketBody() })).json;
  const code = ticket.id;
  const forbid = async (who, method, path, body, label) => {
    const response = await raw(method, path, { token: tok(who), body });
    check(response.status === 403 || response.status === 401, `${who} cannot ${label}`, String(response.status));
  };
  await forbid("student", "GET", "/users", undefined, "list users");
  await forbid("student", "GET", "/activities", undefined, "read the activity log");
  await forbid("student", "GET", "/reports/summary", undefined, "read reports");
  await forbid("student", "GET", "/kpi", undefined, "read KPIs");
  await forbid("student", "GET", "/superadmin/overview", undefined, "open the super admin overview");
  await forbid("student", "POST", "/superadmin/archive", { before: "2020-01-01", dryRun: true }, "archive");
  await forbid("student", "PATCH", `/tickets/${enc(code)}/status`, { status: "Resolved" }, "resolve a ticket");
  await forbid("student", "PATCH", `/tickets/${enc(code)}/assign`, { agentId: accounts.agent.userId }, "assign a ticket");
  await forbid("student", "PUT", `/tickets/${enc(code)}/cancel`, {}, "cancel directly");
  await forbid("student", "GET", "/cancellation-requests", undefined, "see the cancellation queue");
  await forbid("student", "GET", "/agents/workload", undefined, "see agent workload");
  await forbid("student", "GET", `/profile/${accounts.admin.userId}`, undefined, "read another profile");
  await forbid("student", "GET", "/messages/contacts", undefined, "open the chat dock contacts");
  await forbid("student", "PATCH", `/users/${accounts.staff.userId}/role`, { role: "agent" }, "change roles");
  await forbid("agent", "PATCH", `/tickets/${enc(code)}/assign`, { agentId: accounts.agent.userId }, "assign tickets");
  await forbid("agent", "PUT", `/tickets/${enc(code)}/cancel`, {}, "cancel tickets");
  await forbid("agent", "GET", "/reports/summary", undefined, "read reports");
  await forbid("agent", "GET", "/cancellation-requests", undefined, "see the cancellation queue");
  await forbid("admin", "GET", "/reports/summary", undefined, "read reports (superadmin only)");
  await forbid("admin", "POST", "/superadmin/archive", { before: "2020-01-01" }, "archive");
  await forbid("viewer", "POST", "/tickets", ticketBody(), "create tickets (read-only)");
  await forbid("viewer", "PUT", "/kpi/selection", { month: "2026-10", metrics: [] }, "change KPI selection");
  await forbid("superadmin", "POST", "/tickets", ticketBody(), "create tickets");

  // other people's tickets
  const other = await login("staff", "123456employee");
  await forbid("staff", "GET", `/tickets/${enc(code)}/messages`, undefined, "read someone else's ticket chat");
  await forbid("staff", "POST", `/tickets/${enc(code)}/messages`, { text: "hi" }, "write in someone else's ticket chat");
  await forbid("staff", "POST", `/tickets/${enc(code)}/bot`, { choice: "menu" }, "use the bot on someone else's ticket");
  await forbid("staff", "POST", `/tickets/${enc(code)}/reopen`, { reason: "x" }, "reopen someone else's ticket");
  await forbid("staff", "POST", `/tickets/${enc(code)}/cancellation-requests`, { reason: "x" }, "cancel someone else's ticket");
  const mine = (await raw("GET", "/tickets", { token: other.token })).json;
  check(!mine.some((t) => t.id === code), "staff only lists own tickets");
  const forged = (await raw("GET", `/tickets?mine=0&userId=${accounts.student.userId}`, { token: other.token })).json;
  check(!forged.some((t) => t.id === code), "mine=0 / userId query cannot widen a requester's list");

  // acting as someone else
  const spoof = await raw("POST", "/tickets", { token: tok("student"), body: ticketBody({ createdBy: accounts.admin.userId }) });
  const spoofed = (await raw("GET", "/tickets", { token: tok("admin") })).json.find((t) => t.id === spoof.json?.id);
  check(spoofed && spoofed.created_by === accounts.student.userId, "createdBy cannot be spoofed");
  const note = await raw("GET", `/notifications?userId=${accounts.admin.userId}`, { token: tok("student") });
  check(!(note.json?.items || []).some((n) => /New request submitted/.test(n.title)), "cannot read another user's notifications");
}

// ---------------------------------------------------------------------------------------
section("Ticket validation");
{
  const post = (over) => raw("POST", "/tickets", { token: tok("student"), body: ticketBody(over) });
  check((await post({ subject: "" })).status === 400, "empty subject -> 400");
  check((await post({ subject: "   " })).status === 400, "blank subject -> 400");
  check((await post({ category: "" })).status === 400, "empty category -> 400");
  const longSubject = await post({ subject: "S".repeat(5000) });
  check(longSubject.status === 400, "5000-char subject -> 400 (column is 200)", `${longSubject.status} ${longSubject.text.slice(0, 80)}`);
  const badCategory = await post({ category: "Totally Fake" });
  check(badCategory.status === 400, "unknown category rejected", String(badCategory.status));
  const longDescription = await post({ description: "D".repeat(60000) });
  check(longDescription.status === 400 || longDescription.status === 201, "60k description handled", String(longDescription.status));
  check((await post({ locationId: "abc" })).status === 400, "text location id -> 400");
  check((await post({ locationId: "1; DROP TABLE tickets" })).status === 400, "SQL in location id -> 400");
  check((await post({ impactLevel: "Everyone" })).status === 400, "bad impact -> 400");
  check((await post({ urgencyLevel: undefined })).status === 400, "missing urgency -> 400");
  check((await post({ subject: ["a"] })).status === 400, "array subject -> 400");
  const emoji = await post({ subject: "Projector 📽️ broken — ñandú", description: "日本語のテスト" });
  check(emoji.status === 201, "unicode accepted", String(emoji.status));
  const back = (await raw("GET", "/tickets", { token: tok("student") })).json.find((t) => t.id === emoji.json?.id);
  check(back?.subject === "Projector 📽️ broken — ñandú" && back?.description === "日本語のテスト", "unicode round trip", back?.subject);
  const escalated = await post({ description: "Final EXAM tomorrow", impactLevel: "Individual", urgencyLevel: "Low" });
  check(escalated.json?.priorityTier === "P3", "keyword escalation P4 -> P3", escalated.json?.priorityTier);
  const trimmed = await post({ subject: "  padded subject  " });
  const trimmedBack = (await raw("GET", "/tickets", { token: tok("student") })).json.find((t) => t.id === trimmed.json?.id);
  check(trimmedBack?.subject === "padded subject", "subject is trimmed", JSON.stringify(trimmedBack?.subject));
}

// ---------------------------------------------------------------------------------------
section("Workflow and status rules");
{
  const t = (await raw("POST", "/tickets", { token: tok("student"), body: ticketBody({ category: "Hardware" }) })).json.id;
  const url = (suffix) => `/tickets/${enc(t)}${suffix}`;
  check((await raw("PATCH", url("/status"), { token: tok("agent"), body: { status: "Closed" } })).status === 400, "invalid status -> 400");
  check((await raw("PATCH", url("/status"), { token: tok("agent"), body: {} })).status === 400, "missing status -> 400");
  check((await raw("PATCH", "/tickets/%23NOPE/status", { token: tok("agent"), body: { status: "Resolved" } })).status === 404, "unknown ticket -> 404");
  check((await raw("POST", url("/reopen"), { token: tok("student"), body: { reason: "x" } })).status === 409, "reopen an open ticket -> 409");
  check((await raw("POST", url("/messages"), { token: tok("student"), body: { text: "   " } })).status === 400, "empty chat message -> 400");
  const long = await raw("POST", url("/messages"), { token: tok("student"), body: { text: "m".repeat(5000) } });
  check(long.status === 201, "long chat message truncated, not rejected", String(long.status));
  check((await raw("POST", url("/messages"), { token: tok("student"), body: { text: ["a"] } })).status >= 400, "array chat message rejected");

  // assign + resolve + reopen cap
  check((await raw("PATCH", url("/assign"), { token: tok("admin"), body: { agentId: accounts.student.userId } })).status === 404, "assigning to a non-agent -> 404");
  check((await raw("PATCH", url("/assign"), { token: tok("admin"), body: { agentId: accounts.agent.userId } })).status === 200, "admin assigns");
  check((await raw("PATCH", url("/status"), { token: tok("agent"), body: { status: "Resolved" } })).status === 200, "agent resolves");
  const closedChat = await raw("POST", url("/messages"), { token: tok("student"), body: { text: "after resolve" } });
  check(closedChat.status === 409, "chat closed after Resolved", String(closedChat.status));
  for (let i = 1; i <= 3; i += 1) {
    const reopened = await raw("POST", url("/reopen"), { token: tok("student"), body: { reason: `again ${i}` } });
    check(reopened.status === 200, `reopen #${i}`, String(reopened.status));
    await raw("PATCH", url("/status"), { token: tok("agent"), body: { status: "Resolved" } });
  }
  check((await raw("POST", url("/reopen"), { token: tok("student"), body: { reason: "fourth" } })).status === 409, "4th reopen refused");

  // cancellation request flow
  const c = (await raw("POST", "/tickets", { token: tok("student"), body: ticketBody() })).json.id;
  const cu = (suffix) => `/tickets/${enc(c)}${suffix}`;
  check((await raw("POST", cu("/cancellation-requests"), { token: tok("student"), body: { reason: "" } })).status === 400, "cancellation needs a reason");
  const first = await raw("POST", cu("/cancellation-requests"), { token: tok("student"), body: { reason: "mistake" } });
  check(first.status === 201, "cancellation request filed");
  check((await raw("POST", cu("/cancellation-requests"), { token: tok("student"), body: { reason: "again" } })).status === 409, "duplicate pending request -> 409");
  const decide = (code, status) => raw("PATCH", `/cancellation-requests/${enc(code)}/status`, { token: tok("admin"), body: { status, note: "ok" } });
  check((await decide(first.json.id, "Maybe")).status === 400, "invalid decision -> 400");
  check((await decide(first.json.id, "Approved")).status === 200, "admin approves");
  check((await decide(first.json.id, "Approved")).status === 409, "decide twice -> 409");
  const after = (await raw("GET", "/tickets", { token: tok("student") })).json.find((x) => x.id === c);
  check(after.status === "Cancelled", "ticket Cancelled after approval");
  check((await raw("PATCH", cu("/status"), { token: tok("agent"), body: { status: "Open" } })).status === 409, "cancelled ticket cannot be changed");
}

// ---------------------------------------------------------------------------------------
section("Concurrency (parallel requests)");
{
  const burst = await Promise.all(Array.from({ length: 25 }, (_, i) => raw("POST", "/tickets", { token: tok("student"), body: ticketBody({ subject: `Burst ${i}` }) })));
  const okCount = burst.filter((r) => r.status === 201).length;
  const codes = new Set(burst.filter((r) => r.status === 201).map((r) => r.json.id));
  check(okCount === 25, "25 simultaneous ticket submissions all succeed", `${okCount} ok, statuses ${[...new Set(burst.map((r) => r.status))]}`);
  check(codes.size === okCount, "ticket codes are unique", `${codes.size} unique of ${okCount}`);

  const t = (await raw("POST", "/tickets", { token: tok("student"), body: ticketBody() })).json.id;
  const cancels = await Promise.all(Array.from({ length: 6 }, () => raw("PUT", `/tickets/${enc(t)}/cancel`, { token: tok("admin"), body: {} })));
  check(cancels.filter((r) => r.status === 200).length === 1, "6 simultaneous admin cancels: exactly one wins", cancels.map((r) => r.status).join());

  const r2 = (await raw("POST", "/tickets", { token: tok("student"), body: ticketBody() })).json.id;
  await raw("PATCH", `/tickets/${enc(r2)}/status`, { token: tok("agent"), body: { status: "Resolved" } });
  const reopens = await Promise.all(Array.from({ length: 5 }, () => raw("POST", `/tickets/${enc(r2)}/reopen`, { token: tok("student"), body: { reason: "again" } })));
  check(reopens.filter((r) => r.status === 200).length === 1, "5 simultaneous reopens: exactly one wins", reopens.map((r) => r.status).join());

  const crs = await Promise.all(
    Array.from({ length: 6 }, async () => {
      const id = (await raw("POST", "/tickets", { token: tok("student"), body: ticketBody() })).json.id;
      return raw("POST", `/tickets/${enc(id)}/cancellation-requests`, { token: tok("student"), body: { reason: "parallel" } });
    }),
  );
  check(crs.every((r) => r.status === 201), "parallel cancellation requests get unique codes", crs.map((r) => r.status).join());

  const pw = await Promise.all(
    Array.from({ length: 4 }, () => raw("POST", "/password-requests", { token: tok("staff"), body: { newPassword: "newpass123", reason: "r" } })),
  );
  check(pw.filter((r) => r.status >= 500).length === 0, "parallel password requests never 500", pw.map((r) => r.status).join());
}

// ---------------------------------------------------------------------------------------
section("Chat, bot and notifications");
{
  const t = (await raw("POST", "/tickets", { token: tok("student"), body: ticketBody({ category: "Printer" }) })).json.id;
  const u = (suffix) => `/tickets/${enc(t)}${suffix}`;
  check((await raw("POST", u("/bot"), { token: tok("student"), body: { choice: "does-not-exist" } })).status === 409, "bot rejects an option it never offered");
  check((await raw("POST", u("/bot"), { token: tok("student"), body: {} })).status === 400, "bot needs a choice");
  check((await raw("POST", u("/bot"), { token: tok("student"), body: { choice: ["menu"] } })).status >= 400, "bot rejects array choice");
  const noteHidden = await raw("POST", u("/bot"), { token: tok("student"), body: { choice: "urgent:ask" } });
  check(noteHidden.status === 201, "bot choice works");
  await raw("POST", u("/bot"), { token: tok("student"), body: { choice: "urgent:class" } });
  const ownerView = (await raw("GET", u("/messages"), { token: tok("student") })).json;
  const adminView = (await raw("GET", u("/messages"), { token: tok("admin") })).json;
  check(!ownerView.some((m) => m.kind === "bot_note") && adminView.some((m) => m.kind === "bot_note"), "staff-only note hidden from the requester");
  const flood = await Promise.all(Array.from({ length: 15 }, (_, i) => raw("POST", u("/messages"), { token: tok("student"), body: { text: `how long ${i}` } })));
  check(flood.every((r) => r.status === 201), "15 rapid typed messages accepted", flood.map((r) => r.status).join());
  const after = (await raw("GET", u("/messages"), { token: tok("student") })).json;
  check(after.length < 120, "bot does not spam endlessly", String(after.length));

  const notes = (await raw("GET", `/notifications?userId=${accounts.admin.userId}`, { token: tok("admin") })).json;
  check(Array.isArray(notes.items) && typeof notes.unread === "number", "notifications shape");
  const ids = notes.items.slice(0, 3).map((n) => n.id);
  const read = await raw("POST", "/notifications/read", { token: tok("admin"), body: { ids } });
  check(read.status === 200, "mark notifications read");
  const foreignRead = await raw("POST", "/notifications/read", { token: tok("student"), body: { ids: notes.items.map((n) => n.id) } });
  const still = (await raw("GET", `/notifications?userId=${accounts.admin.userId}`, { token: tok("admin") })).json;
  check(still.unread === notes.unread - ids.filter((id) => notes.items.find((n) => n.id === id && !n.read)).length, "another user cannot mark my notifications read", `${foreignRead.status}`);

  const dock = await raw("POST", "/messages", { token: tok("agent"), body: { recipientId: accounts.admin.userId, body: "hello admin" } });
  check(dock.status === 201 || dock.status === 200, "agent -> admin dock message", String(dock.status));
  const toStudent = await raw("POST", "/messages", { token: tok("agent"), body: { recipientId: accounts.student.userId, body: "hi" } });
  check(toStudent.status === 403 || toStudent.status === 400, "dock message to a student refused", String(toStudent.status));
  const self = await raw("POST", "/messages", { token: tok("agent"), body: { recipientId: accounts.agent.userId, body: "me" } });
  check(self.status >= 400, "dock message to yourself refused", String(self.status));
}

// ---------------------------------------------------------------------------------------
section("Reports, KPIs and archive");
{
  const sup = tok("superadmin");
  const q = (s) => raw("GET", `/reports/summary${s}`, { token: sup });
  check((await q("")).status === 200, "report summary default");
  check((await q("?from=2026-01-01&to=2026-12-31&category=Hardware&role=student")).status === 200, "report summary with filters");
  const swapped = await q("?from=2026-12-31&to=2026-01-01");
  check(swapped.status === 200 || swapped.status === 400, "reversed date range handled", String(swapped.status));
  const bad = await q("?from=not-a-date&to=%27%3B%20DROP%20TABLE%20tickets%3B--");
  check(bad.status < 500, "garbage dates never 500", String(bad.status));
  check((await q("?category=%27%20OR%201%3D1--")).status < 500, "SQL injection in category never 500");
  check((await raw("GET", "/kpi?month=2026-10", { token: sup })).status === 200, "KPI month");
  check((await raw("GET", "/kpi?month=nonsense", { token: sup })).status < 500, "KPI bad month never 500");
  check((await raw("GET", "/kpi/trend?months=9999", { token: sup })).status < 500, "KPI trend huge window never 500");
  check((await raw("GET", "/kpi", { token: tok("viewer") })).status === 200, "viewer reads KPIs");

  const dry = await raw("POST", "/superadmin/archive", { token: sup, body: { before: "2026-10-01", dryRun: true } });
  check(dry.status === 200 || dry.status === 400, "archive dry run", String(dry.status));
  const recent = await raw("POST", "/superadmin/archive", { token: sup, body: { before: new Date().toISOString().slice(0, 10), confirm: true } });
  check(recent.status === 400, "archiving the last 30 days is refused", String(recent.status));
  check((await raw("POST", "/superadmin/archive", { token: sup, body: { before: "nonsense" } })).status === 400, "archive bad date -> 400");
  const traversal = await raw("GET", "/superadmin/archive/runs/..%2F..%2Fserver%2F.env/download?format=json", { token: sup });
  check(traversal.status >= 400 && traversal.status < 500, "archive download path traversal blocked", String(traversal.status));
  check((await raw("GET", "/superadmin/archive/runs/1/download?format=exe", { token: sup })).status >= 400, "archive download bad format");
}

// ---------------------------------------------------------------------------------------
section("Lockout and account safety");
{
  const stamp = `lock${Date.now()}`;
  await raw("POST", "/signup", { body: { fullName: "Lock Test", id: stamp, email: "l@example.com", userType: "Student", password: "rightpass1" } });
  let last;
  for (let i = 0; i < 6; i += 1) last = await raw("POST", "/login", { body: { id: stamp, password: "wrong", role: "student" } });
  check(last.status === 423 || last.status === 429, "6th wrong password -> locked", String(last.status));
  const stillLocked = await raw("POST", "/login", { body: { id: stamp, password: "rightpass1", role: "student" } });
  check(!stillLocked.json?.token, "correct password refused while locked", String(stillLocked.status));
  const profile = await raw("GET", `/profile/${accounts.student.userId}`, { token: tok("student") });
  check(!/password|mfa_secret|scrypt/i.test(profile.text), "profile never exposes secrets");
  const me = await raw("GET", "/me", { token: tok("student") });
  check(!/password|mfa_secret|scrypt/i.test(me.text), "/me never exposes secrets");
  const users = await raw("GET", "/users", { token: tok("admin") });
  check(!/password|mfa_secret|scrypt/i.test(users.text) && !users.json?.some((u) => u.roleKey === "bot"), "user list has no secrets and no bot");
}

// ---------------------------------------------------------------------------------------
section("Speed (single requests and bulk data)");
{
  const timed = async (label, fn, limitMs) => {
    const start = performance.now();
    const response = await fn();
    const ms = Math.round(performance.now() - start);
    check(response.status < 500 && ms <= limitMs, `${label} ${ms} ms`, `limit ${limitMs} ms, status ${response.status}`);
    return ms;
  };
  await timed("GET /tickets (student)", () => raw("GET", "/tickets", { token: tok("student") }), 400);
  await timed("GET /tickets (admin)", () => raw("GET", "/tickets", { token: tok("admin") }), 600);
  await timed("GET /reports/summary", () => raw("GET", "/reports/summary", { token: tok("superadmin") }), 800);
  await timed("GET /kpi", () => raw("GET", "/kpi", { token: tok("superadmin") }), 800);
  await timed("GET /kpi/trend", () => raw("GET", "/kpi/trend", { token: tok("superadmin") }), 1500);
  await timed("GET /notifications", () => raw("GET", `/notifications?userId=${accounts.admin.userId}`, { token: tok("admin") }), 300);
  const logins = await Promise.all(Array.from({ length: 10 }, () => login("student", "123456student")));
  check(logins.every((l) => l?.token), "10 simultaneous logins");
}

console.log(`\n${results.pass} passed, ${results.fail.length} failed`);
if (results.fail.length) {
  console.log("\nFailures:");
  for (const line of results.fail) console.log(" -", line);
}
process.exit(results.fail.length ? 1 : 0);
