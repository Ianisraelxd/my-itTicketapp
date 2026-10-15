// Checks for: sign-in cooldown, forgot password, ticket history, photos, help articles, auto-close,
// live updates, email alerts, backups and the satisfaction KPI.
// Needs a DEMO database and a server started like this (short timers, emails printed instead of sent):
//   DB_NAME=helpdesk_demo PORT=3002 MAIL_MODE=log AUTO_CLOSE_CHECK_SECONDS=2 node server/index.js
//   DB_NAME=helpdesk_demo API=http://localhost:3002/api node scripts/qa-features.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import zlib from "node:zlib";

import { pool, query } from "../server/db.js";
import { DEMO_PASSWORD, idFor } from "./demo-accounts.mjs";

const API = (process.env.API || "http://localhost:3001/api").replace(/\/$/, "");
const failures = [];
let passed = 0;
const check = (condition, name, detail = "") => {
  if (condition) passed += 1;
  else {
    failures.push(`${name}${detail ? ` -> ${detail}` : ""}`);
    console.log("  FAIL:", name, detail);
  }
};
const section = (title) => console.log(`\n# ${title}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const enc = encodeURIComponent;

async function raw(method, path, { token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
const login = async (role, password, id = idFor(role)) => (await raw("POST", "/login", { body: { id, password, role } })).json;

const accounts = {};
for (const [name, role, password] of [
  ["student", "student", DEMO_PASSWORD],
  ["agent", "agent", DEMO_PASSWORD],
  ["admin", "admin", DEMO_PASSWORD],
  ["superadmin", "superadmin", DEMO_PASSWORD],
]) accounts[name] = await login(role, password);
const tok = (name) => accounts[name].token;
const room = (await raw("GET", "/locations", { token: tok("student") })).json[0].id;
const newTicket = async (over = {}, who = "student") =>
  (await raw("POST", "/tickets", { token: tok(who), body: { subject: "Feature QA", category: "Hardware", locationId: room, impactLevel: "Individual", urgencyLevel: "Medium", description: "x", ...over } })).json;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// ---------------------------------------------------------------------------------------
section("Sign-in cooldown and forgot password");
{
  const id = `cool${Date.now()}`;
  await raw("POST", "/signup", { body: { fullName: "Cool Down", id, email: "c@example.com", userType: "Student", password: "Gx4#lantern-Rt" } });
  const attempt = (password = "wrong") => raw("POST", "/login", { body: { id, password, role: "student" } });
  let last;
  for (let i = 1; i <= 4; i += 1) {
    last = await attempt();
    check(last.status === 401 && !last.json.cooldownSeconds, `wrong attempt ${i} is a plain 401`);
  }
  last = await attempt();
  check(last.status === 401 && last.json.cooldownSeconds === 10, "5th wrong attempt starts a 10 second cooldown", JSON.stringify(last.json));
  const during = await attempt("Gx4#lantern-Rt");
  check(during.status === 429 && during.json.retryAfter >= 1 && during.json.retryAfter <= 10 && !during.json.token, "even the right password waits during the cooldown", `${during.status} ${during.text.slice(0, 100)}`);
  await sleep(10500);
  const after = await attempt();
  check(after.status === 401, "after 10 seconds a wrong password is an ordinary failure", String(after.status));
  const correct = await attempt("Gx4#lantern-Rt");
  check(correct.status === 200 && correct.json.token, "and the right password works again", String(correct.status));
  // Four more wrong passwords bring the count back to five (a new cooldown), and five more after it ends make ten.
  for (let i = 0; i < 5; i += 1) await attempt();
  await sleep(10500);
  let lastTry;
  for (let i = 0; i < 5; i += 1) lastTry = await attempt();
  check(lastTry.status === 423, "10 failures in a row lock the account for 5 minutes", String(lastTry.status));
  const stillLocked = await attempt("Gx4#lantern-Rt");
  check(stillLocked.status === 423 && !stillLocked.json.token, "even the right password is refused while locked", String(stillLocked.status));

  const before = (await query("SELECT COUNT(*) AS n FROM users"))[0].n;
  const forgot = await raw("POST", "/forgot-password", { body: { email: "someone@example.com" } });
  check(forgot.status === 200 && forgot.json.available === false && /next version/i.test(forgot.json.message), "forgot password: accepted, announced for the next version");
  check((await raw("POST", "/forgot-password", { body: { email: "not-an-email" } })).status === 400, "forgot password rejects a bad email");
  check((await raw("POST", "/forgot-password", { body: {} })).status === 400, "forgot password needs an email");
  check((await query("SELECT COUNT(*) AS n FROM users"))[0].n === before, "forgot password changes nothing");
}

// ---------------------------------------------------------------------------------------
section("Ticket history");
{
  const created = await newTicket({ subject: "History test" });
  const url = (suffix) => `/tickets/${enc(created.id)}${suffix}`;
  await raw("PATCH", url("/assign"), { token: tok("admin"), body: { agentId: accounts.agent.userId } });
  await raw("PATCH", url("/status"), { token: tok("agent"), body: { status: "Resolved" } });
  const history = await raw("GET", url("/history"), { token: tok("student") });
  const actions = (history.json ?? []).map((row) => row.action);
  check(history.status === 200 && ["created", "assigned", "status"].every((a) => actions.includes(a)), "history lists created, assigned and status changes", actions.join());
  check(history.json?.every((row) => row.actorName && row.label && row.createdAt), "each entry has who, what and when");
  const status = history.json?.find((row) => row.action === "status");
  check(status?.detail === "In Progress → Resolved" && status?.actorName === accounts.agent.name, "status entry records the change and the agent", JSON.stringify(status));
  const other = await login("staff", DEMO_PASSWORD);
  check((await raw("GET", url("/history"), { token: other.token })).status === 403, "someone else cannot read the history");
}

// ---------------------------------------------------------------------------------------
section("Photo attachments");
{
  const created = await newTicket({ subject: "Photo test" });
  const url = (suffix) => `/tickets/${enc(created.id)}${suffix}`;
  const upload = (body, who = "student") => raw("POST", url("/attachments"), { token: tok(who), body });
  const ok = await upload({ name: "../../evil name.png", data: `data:image/png;base64,${PNG}` });
  check(ok.status === 201 && ok.json.mime === "image/png" && !ok.json.name.includes("/"), "a PNG is accepted and the name is cleaned", `${ok.status} ${ok.text.slice(0, 100)}`);
  const messages = (await raw("GET", url("/messages"), { token: tok("student") })).json;
  check(messages.some((m) => m.kind === "attachment" && m.attachment?.id === ok.json.id), "the photo appears in the conversation");
  const file = await fetch(`${API}/attachments/${ok.json.id}`, { headers: { Authorization: `Bearer ${tok("admin")}` } });
  const bytes = Buffer.from(await file.arrayBuffer());
  check(file.status === 200 && file.headers.get("content-type") === "image/png" && bytes.slice(1, 4).toString() === "PNG", "an admin can view the photo");
  const outsider = await login("staff", DEMO_PASSWORD);
  check((await fetch(`${API}/attachments/${ok.json.id}`, { headers: { Authorization: `Bearer ${outsider.token}` } })).status === 403, "an outsider cannot view it");
  check((await fetch(`${API}/attachments/${ok.json.id}`)).status === 401, "no token, no photo");
  const html = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
  check((await upload({ name: "x.png", data: html })).status === 400, "a web page renamed .png is refused (checked by content)");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
  check((await upload({ name: "x.svg", data: svg })).status === 400, "SVG is refused");
  check((await upload({ name: "x.png", data: "" })).status === 400, "empty upload refused");
  check((await upload({ name: "x.png" })).status === 400, "missing data refused");
  const big = Buffer.concat([Buffer.from(PNG, "base64"), Buffer.alloc(5.5 * 1024 * 1024)]).toString("base64");
  check([413, 400].includes((await upload({ name: "big.png", data: big })).status), "a 5.5 MB photo is refused");
  check((await upload({ name: "a.png", data: PNG }, "agent")).status === 201, "an agent can add a photo too");
  for (let i = 0; i < 6; i += 1) await upload({ name: `p${i}.png`, data: PNG });
  check((await upload({ name: "extra.png", data: PNG })).status === 409, "no more than 8 photos per ticket");
  const list = await raw("GET", url("/attachments"), { token: tok("student") });
  check(list.json?.length === 8, "photo list", String(list.json?.length));
  await raw("PATCH", url("/status"), { token: tok("agent"), body: { status: "Resolved" } });
  check((await upload({ name: "late.png", data: PNG })).status === 409, "no photos on a resolved ticket");
  const stored = await query("SELECT stored_name FROM ticket_attachments WHERE attachment_pk = ?", [ok.json.id]);
  check(/^[0-9a-f-]{36}\.png$/.test(stored[0].stored_name), "the stored file name is random", stored[0].stored_name);
}

// ---------------------------------------------------------------------------------------
section("Help articles and the assistant");
{
  const list = await raw("GET", "/kb", { token: tok("student") });
  check(list.status === 200 && list.json.length >= 7, "students can read the articles", String(list.json?.length));
  const search = await raw("GET", "/kb?q=wifi%20wireless%20connect", { token: tok("student") });
  check(/Wi-Fi/.test(search.json?.[0]?.title ?? ""), "search finds the Wi-Fi article first", search.json?.[0]?.title);
  check((await raw("GET", "/kb?q=zzzzqqq", { token: tok("student") })).json.length === 0, "search with no match is empty");
  check((await raw("POST", "/kb", { token: tok("student"), body: { title: "x", body: "y" } })).status === 403, "students cannot write articles");
  check((await raw("POST", "/kb", { token: tok("agent"), body: { title: "x", body: "y" } })).status === 403, "agents cannot write articles");
  check((await raw("POST", "/kb", { token: tok("admin"), body: { title: "", body: "y" } })).status === 400, "an article needs a title");
  const made = await raw("POST", "/kb", { token: tok("admin"), body: { title: "Zebra stripes on the screen", category: "Hardware", summary: "Check the cable", body: "Reseat the cable.", keywords: "zebra stripes lines", published: false } });
  check(made.status === 201, "admin creates an article", made.text.slice(0, 80));
  check(!(await raw("GET", "/kb?q=zebra", { token: tok("student") })).json.length, "a draft is hidden from students");
  check((await raw("GET", "/kb?q=zebra", { token: tok("admin") })).json.length === 1, "and visible to admins");
  check((await raw("GET", `/kb/${made.json.id}`, { token: tok("student") })).status === 404, "a draft cannot be opened by a student");
  check((await raw("PUT", `/kb/${made.json.id}`, { token: tok("admin"), body: { title: "Zebra stripes on the screen", category: "Hardware", summary: "Check the cable", body: "Reseat the cable.", keywords: "zebra stripes lines", published: true } })).status === 200, "admin publishes it");
  check((await raw("GET", "/kb?q=zebra", { token: tok("student") })).json.length === 1, "now students find it");
  check((await raw("POST", `/kb/${made.json.id}/feedback`, { token: tok("student"), body: { helpful: true } })).status === 200, "feedback accepted");
  check((await raw("POST", `/kb/${made.json.id}/feedback`, { token: tok("student"), body: { helpful: "yes" } })).status === 400, "feedback must be true or false");
  await raw("GET", `/kb/${made.json.id}`, { token: tok("admin") });
  const article = await raw("GET", `/kb/${made.json.id}`, { token: tok("admin") });
  check(article.json.helpfulYes === 1 && article.json.views >= 1, "counters update", JSON.stringify(article.json));

  // the assistant offers articles for a typed question, and shows one on request
  const ticket = await newTicket({ subject: "Projector problem", category: "Hardware" });
  const url = (suffix) => `/tickets/${enc(ticket.id)}${suffix}`;
  await raw("POST", url("/messages"), { token: tok("student"), body: { text: "the projector shows no picture at all, hdmi cable seems fine" } });
  const after = (await raw("GET", url("/messages"), { token: tok("student") })).json;
  const offer = after.filter((m) => m.kind === "bot").at(-1);
  const articleOption = offer?.options?.find((o) => o.id.startsWith("kb:"));
  check(Boolean(articleOption), "a typed question gets help article suggestions", JSON.stringify(offer?.options));
  if (articleOption) {
    const shown = await raw("POST", url("/bot"), { token: tok("student"), body: { choice: articleOption.id } });
    check(shown.status === 201 && shown.json.messages.some((m) => m.kind === "bot" && /Try these steps|Try these/.test(m.text) || m.kind === "bot" && m.text.includes("📄")), "choosing an article shows it", shown.text.slice(0, 120));
    const helped = await raw("POST", url("/bot"), { token: tok("student"), body: { choice: articleOption.id.replace("kb:", "kbyes:") } });
    check(helped.status === 201, "'That helped' is recorded", String(helped.status));
  }
  const menu = await raw("POST", url("/bot"), { token: tok("student"), body: { choice: "menu" } });
  check(menu.status === 201, "bot menu");
  check((await raw("DELETE", `/kb/${made.json.id}`, { token: tok("admin") })).status === 200, "admin deletes the article");
}

// ---------------------------------------------------------------------------------------
section("Auto-close of resolved tickets");
{
  const ticket = await newTicket({ subject: "Close me" });
  const url = (suffix) => `/tickets/${enc(ticket.id)}${suffix}`;
  await raw("PATCH", url("/assign"), { token: tok("admin"), body: { agentId: accounts.agent.userId } });
  await raw("PATCH", url("/status"), { token: tok("agent"), body: { status: "Resolved" } });
  const listed = (await raw("GET", "/tickets", { token: tok("student") })).json.find((t) => t.id === ticket.id);
  check(listed.closedAt === null && listed.closesAt, "a fresh resolved ticket says when it will close", JSON.stringify([listed.closedAt, listed.closesAt]));
  check((await raw("POST", url("/reopen"), { token: tok("student"), body: { reason: "still broken" } })).status === 200, "it can be reopened while open");
  await raw("PATCH", url("/status"), { token: tok("agent"), body: { status: "Resolved" } });
  await query("UPDATE tickets SET resolved_at = DATE_SUB(NOW(), INTERVAL 4 DAY) WHERE code = ?", [ticket.id]);
  await sleep(9000);
  const closed = (await raw("GET", "/tickets", { token: tok("student") })).json.find((t) => t.id === ticket.id);
  check(closed.status === "Resolved" && closed.closedAt, "after 3 days it is closed for good but still Resolved", JSON.stringify([closed.status, closed.closedAt]));
  const reopen = await raw("POST", url("/reopen"), { token: tok("student"), body: { reason: "again" } });
  check(reopen.status === 409 && /closed/i.test(reopen.json.error), "a closed ticket cannot be reopened", `${reopen.status} ${reopen.text.slice(0, 100)}`);
  const events = (await raw("GET", url("/history"), { token: tok("admin") })).json.map((e) => e.action);
  check(events.includes("closed"), "the history records the closing", events.join());
  const notices = (await raw("GET", url("/messages"), { token: tok("student") })).json;
  check(notices.some((m) => m.kind === "assignment" && /closed for good/.test(m.text)), "the conversation says it was closed");
  const bot = await raw("POST", url("/bot"), { token: tok("student"), body: { choice: "menu" } });
  const options = bot.json?.messages?.at(-1)?.options?.map((o) => o.id) ?? [];
  check(!options.includes("reopen:ask"), "the assistant no longer offers to reopen", options.join());
  const keep = await newTicket({ subject: "Keep me" });
  await raw("PATCH", `/tickets/${enc(keep.id)}/status`, { token: tok("agent"), body: { status: "Resolved" } });
  await sleep(4000);
  check((await raw("GET", "/tickets", { token: tok("student") })).json.find((t) => t.id === keep.id).closedAt === null, "a recently resolved ticket stays open to reopening");
}

// ---------------------------------------------------------------------------------------
section("Live updates (server-sent events)");
{
  const ticketReply = await raw("POST", "/events/ticket", { token: tok("admin") });
  check(ticketReply.status === 200 && ticketReply.json.ticket?.length === 48, "a connection ticket is issued");
  check((await raw("POST", "/events/ticket")).status === 401, "no token, no ticket");
  const controller = new AbortController();
  const stream = await fetch(`${API}/events?ticket=${ticketReply.json.ticket}`, { signal: controller.signal });
  check(stream.status === 200 && /text\/event-stream/.test(stream.headers.get("content-type")), "the stream opens");
  const events = [];
  (async () => {
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (const part of buffer.split("\n\n").slice(0, -1)) {
          const data = part.split("\n").find((line) => line.startsWith("data: "));
          if (data) events.push(JSON.parse(data.slice(6)));
        }
        buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
      }
    } catch {
      // aborted at the end of the test
    }
  })();
  await sleep(300);
  const reuse = await fetch(`${API}/events?ticket=${ticketReply.json.ticket}`);
  check(reuse.status === 401, "a connection ticket works only once");
  check((await fetch(`${API}/events?ticket=nonsense`)).status === 401, "a made-up ticket is refused");
  const t = await newTicket({ subject: "Live test" });
  await raw("POST", `/tickets/${enc(t.id)}/messages`, { token: tok("student"), body: { text: "hello live" } });
  await sleep(800);
  check(events.some((e) => e.type === "hello"), "hello event");
  check(events.some((e) => e.type === "notification"), "the admin is told about the new request at once", JSON.stringify(events));
  check(events.some((e) => e.type === "message" && e.code === t.id), "and about the new chat message", JSON.stringify(events));
  controller.abort();
}

// ---------------------------------------------------------------------------------------
section("Email alerts");
{
  const logged = async (sql, params = []) => Number((await query(`SELECT COUNT(*) AS n FROM email_log WHERE ${sql}`, params))[0].n);
  const agentEmail = (await query("SELECT email FROM users WHERE user_pk = ?", [accounts.agent.userId]))[0].email;
  const before = await logged("to_email = ? AND subject LIKE '%assigned%'", [agentEmail]);
  const t = await newTicket({ subject: "Email test" });
  await raw("PATCH", `/tickets/${enc(t.id)}/assign`, { token: tok("admin"), body: { agentId: accounts.agent.userId } });
  await sleep(600);
  check((await logged("to_email = ? AND subject LIKE '%assigned%'", [agentEmail])) === before + 1, "assigning an agent sends them an email (log mode)");
  check((await raw("PATCH", "/me/alerts", { token: tok("agent"), body: { emailAlerts: false, phone: "" } })).status === 200, "an agent switches alerts off");
  const t2 = await newTicket({ subject: "Email test 2" });
  await raw("PATCH", `/tickets/${enc(t2.id)}/assign`, { token: tok("admin"), body: { agentId: accounts.agent.userId } });
  await sleep(600);
  check((await logged("to_email = ? AND subject LIKE '%assigned%'", [agentEmail])) === before + 1, "no email once alerts are off");
  await raw("PATCH", "/me/alerts", { token: tok("agent"), body: { emailAlerts: true, phone: "+63 912 345 6789" } });
  const mine = await raw("GET", "/me/alerts", { token: tok("agent") });
  check(mine.json.emailAlerts === true && mine.json.phone === "+63 912 345 6789" && mine.json.emailMode === "log", "alert settings read back", JSON.stringify(mine.json));
  check((await raw("PATCH", "/me/alerts", { token: tok("agent"), body: { emailAlerts: true, phone: "<script>" } })).status === 400, "a bad phone number is refused");
  check((await raw("PATCH", "/me/alerts", { token: tok("agent"), body: { emailAlerts: "yes" } })).status === 400, "alerts switch must be true or false");
  const adminEmail = (await query("SELECT email FROM users WHERE user_pk = ?", [accounts.admin.userId]))[0].email;
  const urgentBefore = await logged("to_email = ? AND subject LIKE '%Urgent request%'", [adminEmail]);
  const urgent = await newTicket({ subject: "Whole campus offline", impactLevel: "Organization", urgencyLevel: "High" });
  await sleep(600);
  check(urgent.priorityTier === "P1" && (await logged("to_email = ? AND subject LIKE '%Urgent request%'", [adminEmail])) === urgentBefore + 1, "a P1 ticket emails the admins");
  const notices = (await raw("GET", `/notifications?userId=${accounts.admin.userId}`, { token: tok("admin") })).json.items;
  check(notices.some((n) => n.type === "urgent_ticket"), "and shows an urgent notification");
  const pw = await newTicket({ subject: "Not urgent", impactLevel: "Individual", urgencyLevel: "Low" });
  check(pw.priorityTier === "P4", "a low ticket is P4");
}

// ---------------------------------------------------------------------------------------
section("Backups");
{
  check((await raw("GET", "/superadmin/backups", { token: tok("admin") })).status === 403, "an admin cannot see backups");
  check((await raw("POST", "/superadmin/backups", { token: tok("student") })).status === 403, "a student cannot make one");
  const made = await raw("POST", "/superadmin/backups", { token: tok("superadmin") });
  check(made.status === 201 && /^helpdesk-\d{4}-\d{2}-\d{2}_\d{6}\.sql\.gz$/.test(made.json?.name), "the super admin creates a backup", made.text.slice(0, 120));
  const list = await raw("GET", "/superadmin/backups", { token: tok("superadmin") });
  check(list.json.files.some((f) => f.name === made.json.name) && list.json.enabled === true, "it is listed");
  const file = await fetch(`${API}/superadmin/backups/${made.json.name}/download`, { headers: { Authorization: `Bearer ${tok("superadmin")}` } });
  const sql = zlib.gunzipSync(Buffer.from(await file.arrayBuffer())).toString("utf8");
  check(file.status === 200 && sql.startsWith("-- Campus HelpDesk backup") && /CREATE TABLE `tickets`/.test(sql) && /CREATE .*VIEW `tickets_all`/.test(sql), "the file is a gzip SQL dump with tables and views");
  check(!/DEFINER=/.test(sql), "no DEFINER in the dump (restores under any user)");
  check((await fetch(`${API}/superadmin/backups/..%2F..%2Fserver%2Findex.js/download`, { headers: { Authorization: `Bearer ${tok("superadmin")}` } })).status >= 400, "path traversal refused");
  check((await fetch(`${API}/superadmin/backups/evil.sql.gz/download`, { headers: { Authorization: `Bearer ${tok("superadmin")}` } })).status === 400, "only backup names are accepted");

  // restore into a scratch database and compare
  const target = "helpdesk_restore_test";
  await pool.query(`DROP DATABASE IF EXISTS \`${target}\``);
  const dir = new URL("../backups/daily/", import.meta.url);
  const out = execFileSync(process.execPath, ["scripts/restore-backup.mjs", new URL(made.json.name, dir).pathname.replace(/^\/([A-Za-z]:)/, "$1")], { env: { ...process.env, DB_NAME: target }, encoding: "utf8" });
  check(/Restored/.test(out), "the restore script runs", out.slice(0, 100));
  for (const table of ["users", "tickets", "ticket_messages", "kb_articles", "ticket_events", "notifications"]) {
    const [[a]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    const [[b]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${target}\`.\`${table}\``);
    check(Number(b.n) >= Number(a.n) - 5 && Number(b.n) > 0, `restored ${table}`, `${a.n} live / ${b.n} restored`);
  }
  const [[view]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${target}\`.tickets_all`);
  check(Number(view.n) > 0, "the tickets_all view works after the restore");
  const [[dates]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${target}\`.tickets t JOIN tickets l ON l.ticket_pk = t.ticket_pk WHERE l.created_at <> t.created_at`);
  check(Number(dates.n) === 0, "dates survive the restore unchanged");
  await pool.query(`DROP DATABASE \`${target}\``);
  if (fs.existsSync(new URL(made.json.name, dir))) fs.rmSync(new URL(made.json.name, dir));
}

// ---------------------------------------------------------------------------------------
section("Satisfaction (CSAT) KPI");
{
  const t = await newTicket({ subject: "Rate me" });
  const url = (suffix) => `/tickets/${enc(t.id)}${suffix}`;
  await raw("PATCH", url("/status"), { token: tok("agent"), body: { status: "Resolved" } });
  const ask = await raw("POST", url("/bot"), { token: tok("student"), body: { choice: "rate:ask" } });
  check(ask.status === 201, "the assistant asks for a rating", String(ask.status));
  const five = await raw("POST", url("/bot"), { token: tok("student"), body: { choice: "rate:5" } });
  check(five.status === 201, "a 5-star rating is saved");
  const events = (await raw("GET", url("/history"), { token: tok("admin") })).json.map((e) => e.action);
  check(events.includes("rating"), "the rating is in the history");
  const month = new Date().toISOString().slice(0, 7);
  const select = await raw("PUT", "/kpi/selection", { token: tok("superadmin"), body: { month, metrics: [{ key: "CSAT", target: null }, { key: "AHT", target: null }] } });
  check(select.status === 200, "the super admin can pick the new KPI", select.text.slice(0, 100));
  const kpi = (await raw("GET", `/kpi?month=${month}`, { token: tok("superadmin") })).json;
  check(kpi.catalog.length === 16 && kpi.catalog.some((m) => m.key === "CSAT" && m.unit === "score"), "the catalog now has 16 metrics");
  const csat = kpi.metrics.find((m) => m.key === "CSAT");
  const value = csat?.value;
  check(Number(value) >= 1 && Number(value) <= 5, "CSAT shows an average between 1 and 5", JSON.stringify(csat).slice(0, 160));
  const trend = await raw("GET", "/kpi/trend", { token: tok("superadmin") });
  check(trend.status === 200, "trend still works");
}

// ---------------------------------------------------------------------------------------
section("One click, one request (double clicks and slow connections)");
{
  const body = (extra = {}) => ({ subject: "Double click test", category: "Hardware", locationId: room, impactLevel: "Individual", urgencyLevel: "Medium", description: "x", ...extra });
  const count = async (subject) => Number((await query("SELECT COUNT(*) AS n FROM tickets WHERE subject = ?", [subject]))[0].n);

  const first = await raw("POST", "/tickets", { token: tok("student"), body: body({ subject: "Token A", clientToken: "tokenA-1234567890" }) });
  const again = await raw("POST", "/tickets", { token: tok("student"), body: body({ subject: "Token A", clientToken: "tokenA-1234567890" }) });
  check(first.status === 201 && again.status === 200 && again.json.id === first.json.id && again.json.duplicate === true, "the same token returns the first ticket, not a second one", `${first.json?.id} / ${again.json?.id} ${again.status}`);
  check((await count("Token A")) === 1, "only one ticket exists after a repeat");

  const parallel = await Promise.all(Array.from({ length: 8 }, () => raw("POST", "/tickets", { token: tok("student"), body: body({ subject: "Token B", clientToken: "tokenB-abcdefghij" }) })));
  check(new Set(parallel.map((r) => r.json?.id)).size === 1 && (await count("Token B")) === 1, "8 simultaneous clicks with one token make one ticket", parallel.map((r) => r.status).join());

  const other = await login("staff", DEMO_PASSWORD);
  const mine = await raw("POST", "/tickets", { token: other.token, body: body({ subject: "Token B", clientToken: "tokenB-abcdefghij" }) });
  check(mine.status === 201 && mine.json.id !== parallel[0].json.id, "another person using the same token still gets their own ticket");

  const fresh = await raw("POST", "/tickets", { token: tok("student"), body: body({ subject: "Token C", clientToken: "tokenC-different1" }) });
  check(fresh.status === 201 && fresh.json.id !== first.json.id, "a different token makes a new ticket");
  const junk = await raw("POST", "/tickets", { token: tok("student"), body: body({ subject: "Token D", clientToken: "x" }) });
  check(junk.status === 201, "a malformed token is ignored, not an error", String(junk.status));
  const objectToken = await raw("POST", "/tickets", { token: tok("student"), body: body({ subject: "Token E", clientToken: { $ne: 1 } }) });
  check(objectToken.status === 201, "a non-text token is ignored", String(objectToken.status));
}

await pool.end();
console.log(`\n${passed} passed, ${failures.length} failed`);
for (const line of failures) console.log(" -", line);
process.exit(failures.length ? 1 : 0);
