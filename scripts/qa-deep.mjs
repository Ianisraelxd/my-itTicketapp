// Deeper end-to-end checks that need to change data directly: the archive pipeline, two-step
// verification, password reset, role changes and the auto-assign engine.
// Run on a DEMO database that the API is using (the script edits ticket dates in it):
//   DB_NAME=helpdesk_demo API=http://localhost:3002/api node scripts/qa-deep.mjs
import crypto from "node:crypto";
import fs from "node:fs";

import { pool, query } from "../server/db.js";

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
  return { status: response.status, json, text };
}
const login = async (role, password, id = "2404154") => (await raw("POST", "/login", { body: { id, password, role } })).json;

// RFC 6238 code generator (same algorithm as the authenticator apps)
function totp(secret, offset = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const hmac = crypto.createHmac("sha1", key).update(counter).digest();
  const start = hmac[hmac.length - 1] & 0x0f;
  return String((hmac.readUInt32BE(start) & 0x7fffffff) % 1000000).padStart(6, "0");
}

const accounts = {};
for (const [name, role, password] of [
  ["student", "student", "123456student"],
  ["agent", "agent", "123456technician"],
  ["admin", "admin", "123456admin"],
  ["superadmin", "superadmin", "123456superadmin"],
]) accounts[name] = await login(role, password);
const tok = (name) => accounts[name].token;
const room = (await raw("GET", "/locations", { token: tok("student") })).json[0].id;
const newTicket = async (over = {}) =>
  (await raw("POST", "/tickets", { token: tok("student"), body: { subject: "Deep QA", category: "Hardware", locationId: room, impactLevel: "Individual", urgencyLevel: "Medium", description: "x", ...over } })).json.id;

// ---------------------------------------------------------------------------------------
section("Archive pipeline keeps reports and ticket numbers intact");
{
  const ids = [];
  for (let i = 0; i < 4; i += 1) ids.push(await newTicket({ subject: `Old ticket ${i}` }));
  for (const id of ids) {
    await raw("PATCH", `/tickets/${enc(id)}/assign`, { token: tok("admin"), body: { agentId: accounts.agent.userId } });
    await raw("PATCH", `/tickets/${enc(id)}/status`, { token: tok("agent"), body: { status: "Resolved" } });
    await raw("POST", `/tickets/${enc(id)}/messages`, { token: tok("admin"), body: { text: "note" } }).catch(() => {});
  }
  // make them a year old
  await query("UPDATE tickets SET created_at = '2025-03-01 10:00:00', resolved_at = '2025-03-01 12:00:00', assigned_at = '2025-03-01 10:30:00', first_response_at = '2025-03-01 10:30:00', assignment_started_at = '2025-03-01 10:30:00' WHERE subject LIKE 'Old ticket %'");
  await query("UPDATE ticket_messages SET created_at = '2025-03-01 11:00:00' WHERE ticket_pk IN (SELECT ticket_pk FROM tickets WHERE subject LIKE 'Old ticket %')");

  const before = (await raw("GET", "/reports/summary?from=2025-01-01&to=2025-12-31", { token: tok("superadmin") })).json;
  const dry = await raw("POST", "/superadmin/archive", { token: tok("superadmin"), body: { before: "2025-06-01", dryRun: true } });
  check(dry.status === 200 && dry.json.tickets >= 4, "dry run counts the old tickets", JSON.stringify(dry.json));
  const noConfirm = await raw("POST", "/superadmin/archive", { token: tok("superadmin"), body: { before: "2025-06-01" } });
  check(noConfirm.status === 400, "archive needs the typed confirmation", String(noConfirm.status));
  const run = await raw("POST", "/superadmin/archive", { token: tok("superadmin"), body: { before: "2025-06-01", confirm: true } });
  check(run.status === 200 || run.status === 201, "archive runs", `${run.status} ${run.text.slice(0, 200)}`);

  const live = await query("SELECT COUNT(*) AS n FROM tickets WHERE subject LIKE 'Old ticket %'");
  const archived = await query("SELECT COUNT(*) AS n FROM tickets_archive WHERE subject LIKE 'Old ticket %'");
  const view = await query("SELECT COUNT(*) AS n FROM tickets_all WHERE subject LIKE 'Old ticket %'");
  check(Number(live[0].n) === 0 && Number(archived[0].n) === 4 && Number(view[0].n) === 4, "tickets moved, none lost", `${live[0].n}/${archived[0].n}/${view[0].n}`);
  const archivedMessages = await query("SELECT COUNT(*) AS n FROM ticket_messages_archive");
  check(Number(archivedMessages[0].n) > 0, "conversations were archived with them", String(archivedMessages[0].n));
  const after = (await raw("GET", "/reports/summary?from=2025-01-01&to=2025-12-31", { token: tok("superadmin") })).json;
  check(JSON.stringify(before.totals ?? before) === JSON.stringify(after.totals ?? after), "report numbers unchanged by archiving");
  const next = await newTicket();
  check(!ids.includes(next) && Number(next.replace("#HD", "")) > Math.max(...ids.map((x) => Number(x.replace("#HD", "")))), "new ticket numbers do not reuse archived ones", next);
  // the spreadsheet is tidy: readable headers, names instead of ID numbers, formatted dates
  const csvFile = new URL(`../backups/archives/${run.json.files.csv}`, import.meta.url);
  const csvBytes = fs.readFileSync(csvFile);
  const csvText = csvBytes.toString("utf8");
  const csvLines = csvText.split("\r\n");
  check(csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf, "the CSV starts with a byte-order mark (opens correctly in Excel)");
  check(csvLines[0].startsWith('\uFEFF"Ticket","Subject","Category"') && /"Assigned agent"/.test(csvLines[0]) && !/ticket_pk|created_by|assigned_to/.test(csvLines[0]), "readable column names", csvLines[0].slice(0, 80));
  const csvRow = csvLines[1] ?? "";
  check(/"#HD\d{3}"/.test(csvRow) && /"Agent User"/.test(csvRow) && /"Student User"/.test(csvRow), "names instead of ID numbers", csvRow.slice(0, 160));
  check(/"2025-03-01 10:00"/.test(csvRow) && /"2025-03-01 12:00"/.test(csvRow) && !/T\d\d:\d\d:\d\d\.\d{3}Z/.test(csvRow), "dates formatted as year-month-day hour:minute");
  check(csvLines.length >= 5 && csvLines.filter((line) => line.length > 0).length === 5, "one line per archived ticket plus the header", String(csvLines.length));
  const runs = await raw("GET", "/superadmin/archive/runs", { token: tok("superadmin") });
  check(runs.status === 200 && runs.json.length > 0, "archive history listed");
  const file = await fetch(`${API}/superadmin/archive/runs/${runs.json[0].id ?? runs.json[0].run_pk}/download?format=json`, { headers: { Authorization: `Bearer ${tok("superadmin")}` } });
  check(file.status === 200 && /json/.test(file.headers.get("content-type") || ""), "backup file downloads", String(file.status));
  const csv = await fetch(`${API}/superadmin/archive/runs/${runs.json[0].id ?? runs.json[0].run_pk}/download?format=csv`, { headers: { Authorization: `Bearer ${tok("superadmin")}` } });
  check(csv.status === 200 && /Old ticket/.test(await csv.text()), "CSV backup contains the tickets");
}

// ---------------------------------------------------------------------------------------
section("Two-step verification (TOTP)");
{
  const stamp = `mfa${Date.now()}`;
  // Two-step verification is for staff accounts, so make this tester an agent first.
  await raw("POST", "/signup", { body: { fullName: "MFA Tester", id: stamp, email: "m@example.com", userType: "University Staff", password: "mfapass12" } });
  const created = await login("staff", "mfapass12", stamp);
  await raw("PATCH", `/users/${created.userId}/role`, { token: tok("admin"), body: { role: "agent" } });
  const who = await login("agent", "mfapass12", stamp);
  const setup = await raw("POST", "/mfa/setup", { token: who.token });
  check(setup.status === 200 && setup.json.secret, "MFA setup returns a secret", String(setup.status));
  const wrong = await raw("POST", "/mfa/enable", { token: who.token, body: { code: "000000" } });
  check(wrong.status === 400 || wrong.status === 401, "wrong code does not enable MFA", String(wrong.status));
  const enable = await raw("POST", "/mfa/enable", { token: who.token, body: { code: totp(setup.json.secret) } });
  check(enable.status === 200, "right code enables MFA", `${enable.status} ${enable.text.slice(0, 80)}`);
  const first = await login("agent", "mfapass12", stamp);
  check(first.mfaRequired && first.mfaToken && !first.token, "login now asks for a code");
  const badCode = await raw("POST", "/login/mfa", { body: { mfaToken: first.mfaToken, code: "123456" } });
  check(badCode.status >= 400 && !badCode.json?.token, "wrong code refused", String(badCode.status));
  const good = await raw("POST", "/login/mfa", { body: { mfaToken: first.mfaToken, code: totp(setup.json.secret) } });
  check(good.status === 200 && good.json.token, "right code signs in", String(good.status));
  const forged = await raw("POST", "/login/mfa", { body: { mfaToken: tok("student"), code: totp(setup.json.secret) } });
  check(!forged.json?.token, "a normal session token cannot stand in for the MFA step");
  const off = await raw("POST", "/mfa/disable", { token: good.json.token, body: { code: totp(setup.json.secret) } });
  check(off.status === 200, "MFA can be turned off with a code", `${off.status} ${off.text.slice(0, 80)}`);
}

// ---------------------------------------------------------------------------------------
section("Password change request end to end");
{
  const stamp = `pw${Date.now()}`;
  await raw("POST", "/signup", { body: { fullName: "Pw Tester", id: stamp, email: "p@example.com", userType: "Student", password: "oldpass12" } });
  const who = await login("student", "oldpass12", stamp);
  const request = await raw("POST", "/password-requests", { token: who.token, body: { newPassword: "newpass12", reason: "test" } });
  check(request.status === 201, "request filed", String(request.status));
  check((await login("student", "newpass12", stamp))?.token === undefined, "new password does not work before approval");
  const pending = await raw("GET", "/password-requests", { token: tok("admin") });
  check(pending.json.some((r) => r.id === request.json.id), "admin sees the request");
  const stranger = await raw("PATCH", `/password-requests/${enc(request.json.id)}/status`, { token: tok("student"), body: { status: "Approved" } });
  check(stranger.status === 403, "a student cannot approve it", String(stranger.status));
  const approve = await raw("PATCH", `/password-requests/${enc(request.json.id)}/status`, { token: tok("admin"), body: { status: "Approved", note: "ok" } });
  check(approve.status === 200, "admin approves", String(approve.status));
  check((await login("student", "newpass12", stamp))?.token, "new password works after approval");
  check(!(await login("student", "oldpass12", stamp))?.token, "old password stops working");
  const again = await raw("PATCH", `/password-requests/${enc(request.json.id)}/status`, { token: tok("admin"), body: { status: "Approved" } });
  check(again.status === 409, "cannot decide twice", String(again.status));
}

// ---------------------------------------------------------------------------------------
section("Roles and admin management");
{
  const stamp = `role${Date.now()}`;
  await raw("POST", "/signup", { body: { fullName: "Role Tester", id: stamp, email: "r@example.com", userType: "University Staff", password: "rolepass12" } });
  const target = await login("staff", "rolepass12", stamp);
  const toAgent = await raw("PATCH", `/users/${target.userId}/role`, { token: tok("admin"), body: { role: "agent" } });
  check(toAgent.status === 200 && toAgent.json.roleName === "Agent", "admin makes staff an agent", toAgent.text.slice(0, 100));
  check((await login("agent", "rolepass12", stamp))?.role === "agent", "they sign in as an agent now");
  check((await raw("PATCH", `/users/${target.userId}/role`, { token: tok("admin"), body: { role: "admin" } })).status === 400, "admin cannot use this to create admins");
  const skills = await raw("PATCH", `/users/${target.userId}/skills`, { token: tok("admin"), body: { skills: ["Hardware", "Nonsense"] } });
  check(skills.status === 400, "unknown skill names are rejected", String(skills.status));
  const toStaff = await raw("PATCH", `/users/${target.userId}/role`, { token: tok("admin"), body: { role: "staff" } });
  check(toStaff.status === 200, "and back to staff");

  const grant = await raw("PUT", `/superadmin/manage-admins/${target.userId}`, { token: tok("superadmin"), body: { action: "grant" } });
  check(grant.status === 200, "super admin grants admin", `${grant.status} ${grant.text.slice(0, 100)}`);
  check((await login("admin", "rolepass12", stamp))?.role === "admin", "they can sign in as admin");
  const revoke = await raw("PUT", `/superadmin/manage-admins/${target.userId}`, { token: tok("superadmin"), body: { action: "revoke" } });
  check(revoke.status === 200, "super admin revokes");
  check(!(await login("admin", "rolepass12", stamp))?.token, "admin sign-in stops working");
  check((await raw("PUT", `/superadmin/manage-admins/${target.userId}`, { token: tok("admin"), body: { action: "grant" } })).status === 403, "an admin cannot grant admin rights");
  check((await raw("PUT", `/superadmin/manage-admins/${target.userId}`, { token: tok("superadmin"), body: { action: "explode" } })).status === 400, "unknown action -> 400");
  check((await raw("PUT", `/superadmin/manage-admins/${accounts.superadmin.userId}`, { token: tok("superadmin"), body: { action: "revoke" } })).status >= 400, "the super admin cannot revoke themselves");
}

// ---------------------------------------------------------------------------------------
section("Cancelled and finished tickets leave the agent's load");
{
  const id = await newTicket();
  await raw("PATCH", `/tickets/${enc(id)}/assign`, { token: tok("admin"), body: { agentId: accounts.agent.userId } });
  const load = async () => (await raw("GET", `/agents/workload?userId=${accounts.admin.userId}`, { token: tok("admin") })).json.find((a) => a.userId === accounts.agent.userId).activeTickets;
  const before = await load();
  await raw("PUT", `/tickets/${enc(id)}/cancel`, { token: tok("admin"), body: { reason: "dup" } });
  check((await load()) === before - 1, "cancelling frees the agent's slot", `${before} -> ${await load()}`);
  const second = await newTicket();
  await raw("PATCH", `/tickets/${enc(second)}/assign`, { token: tok("admin"), body: { agentId: accounts.agent.userId } });
  const mid = await load();
  await raw("PATCH", `/tickets/${enc(second)}/status`, { token: tok("agent"), body: { status: "Resolved" } });
  check((await load()) === mid - 1, "resolving frees the agent's slot");
}

await pool.end();
console.log(`\n${passed} passed, ${failures.length} failed`);
for (const line of failures) console.log(" -", line);
process.exit(failures.length ? 1 : 0);
