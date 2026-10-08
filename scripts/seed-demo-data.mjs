// Fills a DEMO database with realistic tickets, chats, a cancellation request and
// a password request, so the README screenshots (and report charts) have data.
//
//   1. Create a throwaway database from server/schema.sql (copy it and rename
//      "helpdesk" to "helpdesk_demo" first - never run the original against data you keep).
//   2. Start the API against it:   DB_NAME=helpdesk_demo PORT=3002 node server/index.js
//   3. node scripts/seed-demo-data.mjs http://localhost:3002
//
// DB_NAME must be the demo database for step 3 as well (it back-dates created_at).
import "dotenv/config";
import mysql from "mysql2/promise";

const API = (process.argv[2] || "http://localhost:3002").replace(/\/$/, "") + "/api";
const DB_NAME = process.env.DB_NAME;
if (!DB_NAME || !DB_NAME.includes("demo")) {
  console.error('Refusing to run: set DB_NAME to a database whose name contains "demo".');
  process.exit(1);
}

// Seeded account ids (see server/schema.sql)
const STUDENT = 1;
const EMPLOYEE = 2;
const HARDWARE_TECH = 3;
const ADMIN = 4;
const SOFTWARE_TECH = 6;
const NETWORK_TECH = 7;

// The API needs a signed-in user for everything, so sign in as each seeded account once.
const ACCOUNTS = {
  [STUDENT]: ["2404154", "student", "123456student"],
  [EMPLOYEE]: ["2404154", "employee", "123456employee"],
  [HARDWARE_TECH]: ["2404154", "technician", "123456technician"],
  [ADMIN]: ["2404154", "admin", "123456admin"],
  [SOFTWARE_TECH]: ["2404155", "technician", "123456technician"],
  [NETWORK_TECH]: ["2404156", "technician", "123456technician"],
};
const tokens = {};
for (const [userId, [id, role, password]] of Object.entries(ACCOUNTS)) {
  const response = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, role, password }),
  });
  const data = await response.json();
  if (!data.token) throw new Error(`Could not sign in as ${role} ${id}: ${data.error}`);
  tokens[userId] = data.token;
}

// `as` is the user id of whoever performs the action.
async function call(method, path, body, as) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens[as]}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${data.error || response.status}`);
  return data;
}

const enc = encodeURIComponent;
const created = [];

async function ticket(spec) {
  const { id } = await call("POST", "/tickets", {
    subject: spec.subject,
    category: spec.category,
    priority: spec.priority,
    location: spec.location,
    description: spec.description,
    createdBy: spec.by,
  }, spec.by);
  created.push({ id, daysAgo: spec.daysAgo ?? 0, assigned: Boolean(spec.assign), resolved: Boolean(spec.resolve) });
  if (spec.assign) await call("PATCH", `/tickets/${enc(id)}/assign`, { actorId: ADMIN, technicianId: spec.assign }, ADMIN);
  for (const [userId, text] of spec.chat || []) {
    await call("POST", `/tickets/${enc(id)}/messages`, { userId, text }, userId);
  }
  if (spec.resolve) {
    await call("PATCH", `/tickets/${enc(id)}/status`, { status: "Resolved", actorId: spec.resolve }, spec.resolve);
  }
  return id;
}

// --- Story tickets (these appear in the README screenshots) -------------------
await ticket({
  subject: "Projector in Lab 1 will not turn on",
  category: "Hardware", priority: "High", location: "Computer Laboratory 1", by: STUDENT, daysAgo: 1,
  description: "The projector shows a blinking red light and never starts. We have a presentation at 2 PM.",
  assign: HARDWARE_TECH,
  chat: [
    [STUDENT, "Hi! Any update? Our presentation starts at 2 PM."],
    [HARDWARE_TECH, "On my way to Lab 1 now. I will swap the lamp unit if needed."],
    [STUDENT, "Thank you so much!"],
  ],
});

const wifi = await ticket({
  subject: "Wi-Fi keeps dropping in the library",
  category: "Network / Internet", priority: "Medium", location: "Main Library, 2nd floor", by: STUDENT, daysAgo: 2,
  description: "The connection disconnects every few minutes, mostly near the study booths.",
  assign: NETWORK_TECH,
  chat: [[NETWORK_TECH, "Thanks for reporting. I am checking the access point on the 2nd floor."]],
});
await call("POST", `/tickets/${enc(wifi)}/cancellation-requests`, {
  userId: STUDENT,
  reason: "I moved to another room and it works fine there now.",
}, STUDENT);

await ticket({
  subject: "Office 365 keeps asking me to sign in",
  category: "Software", priority: "Medium", location: "Faculty Room 204", by: STUDENT, daysAgo: 4,
  description: "Word and Outlook ask for my password every time I open them.",
  assign: SOFTWARE_TECH,
  chat: [[SOFTWARE_TECH, "I cleared the cached credentials and re-activated your license. Please try again."]],
  resolve: SOFTWARE_TECH,
});

await ticket({
  subject: "Cannot log in to the student portal",
  category: "Account / Login", priority: "High", location: "Dormitory B", by: STUDENT, daysAgo: 0,
  description: "It says my account is locked after I typed the wrong password once.",
});

await ticket({
  subject: "Printer jam in the Registrar's office",
  category: "Printer", priority: "Low", location: "Registrar's Office", by: EMPLOYEE, daysAgo: 3,
  description: "Paper is stuck inside and the tray will not open.",
  assign: HARDWARE_TECH,
  resolve: HARDWARE_TECH,
});

await ticket({
  subject: "Install MATLAB on the Lab 3 computers",
  category: "Software", priority: "Medium", location: "Computer Laboratory 3", by: EMPLOYEE, daysAgo: 0,
  description: "The engineering class needs MATLAB R2024b on all 30 machines before Monday.",
});

// --- Filler tickets so the Report Manager charts look alive ---------------------
const categories = ["Hardware", "Software", "Network / Internet", "Account / Login", "Printer", "Others"];
const locations = ["Computer Laboratory 1", "Computer Laboratory 2", "Main Library", "Registrar's Office", "Dormitory B", "Faculty Room 204", "Cafeteria"];
const priorities = ["Low", "Medium", "High"];
const techs = [HARDWARE_TECH, SOFTWARE_TECH, NETWORK_TECH];
// About half of them in the last 30 days, the rest spread back ~5 months so the KPI trends have a history.
for (let i = 0; i < 70; i += 1) {
  const category = categories[(i * 5 + 2) % categories.length];
  const tech = techs[i % techs.length];
  const stage = i % 4; // 0 open, 1 in progress, 2/3 resolved
  await ticket({
    subject: `${category} issue reported (${i + 1})`,
    category,
    priority: priorities[(i * 7) % 3],
    location: locations[(i * 3) % locations.length],
    by: i % 3 === 0 ? EMPLOYEE : STUDENT,
    daysAgo: i < 32 ? 1 + ((i * 5) % 29) : 30 + ((i * 7) % 130),
    description: "Routine request created for demo data.",
    assign: stage >= 1 ? tech : undefined,
    resolve: stage >= 2 ? tech : undefined,
  });
}

// A pending password-change request for the admin screen
await call("POST", "/password-requests", {
  userId: STUDENT,
  newPassword: "new-demo-pass",
  reason: "I think someone saw me typing my password.",
}, STUDENT);

// Spread creation dates over the last 30 days so the volume chart has a shape.
const db = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: DB_NAME,
});
// Realistic timeline for the KPI scorecard: assigned/first response within
// minutes-hours, fixes taking from under an hour to about a day.
for (const [index, { id, daysAgo, assigned, resolved }] of created.entries()) {
  const respond = 3 + ((index * 11) % 40); // minutes until IT first reacts
  const assign = respond + 2 + ((index * 17) % 70); // minutes until it is assigned
  const work = 35 + ((index * 53) % 900); // minutes from assignment to fix
  await db.execute(
    `UPDATE tickets SET
       created_at = DATE_SUB(NOW(), INTERVAL ? DAY),
       first_response_at = IF(?, DATE_ADD(DATE_SUB(NOW(), INTERVAL ? DAY), INTERVAL ? MINUTE), NULL),
       assigned_at = IF(?, DATE_ADD(DATE_SUB(NOW(), INTERVAL ? DAY), INTERVAL ? MINUTE), NULL),
       resolved_at = IF(?, LEAST(NOW(), DATE_ADD(DATE_SUB(NOW(), INTERVAL ? DAY), INTERVAL ? MINUTE)), NULL)
     WHERE code = ?`,
    [
      daysAgo,
      assigned, daysAgo, respond,
      assigned, daysAgo, assign,
      resolved, daysAgo, assign + work,
      id,
    ],
  );
}

// A few reopened and cancelled tickets so Reopen Rate and Cancellation Rate have values.
const resolvedFillers = created.filter((item, index) => item.resolved && index > 6).slice(0, 3);
for (const { id } of resolvedFillers) {
  await db.execute("UPDATE tickets SET reopen_count = 1 WHERE code = ?", [id]);
}
const openFillers = created.filter((item, index) => !item.assigned && index > 6).slice(0, 2);
for (const { id } of openFillers) {
  await db.execute("UPDATE tickets SET status = 'Cancelled' WHERE code = ?", [id]);
}
await db.end();

console.log(`Seeded ${created.length} tickets into ${DB_NAME}.`);
