// Checks for: password policy, password hashing, password change, forced first-time change, session
// invalidation, progressive lockout and sign-in timing. Uses a DEMO database like the other qa scripts:
//   DB_NAME=helpdesk_demo PORT=3002 SEED_PASSWORD=Demo#Campus2026 SEED_MUST_CHANGE=false RATE_LIMIT_AUTH=5000 node server/index.js
//   DB_NAME=helpdesk_demo API=http://localhost:3002/api node scripts/qa-security.mjs
import { pool, query } from "../server/db.js";

const API = (process.env.API || "http://localhost:3001/api").replace(/\/$/, "");
if (!/demo|test|fresh/i.test(process.env.DB_NAME || "")) throw new Error("Use a throwaway database (DB_NAME must contain demo, test or fresh).");
const failures = [];
let passed = 0;
const check = (condition, name, detail = "") => {
  if (condition) passed += 1;
  else {
    failures.push(name);
    console.log("  FAIL:", name, detail);
  }
};
const section = (title) => console.log(`\n# ${title}`);

async function raw(method, path, { token, body } = {}) {
  const started = Date.now();
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
    // not json
  }
  return { status: response.status, json, text, ms: Date.now() - started };
}

const stamp = Date.now().toString(36);
const GOOD = "Vq7!harbor-Lm";
const WRONG = "Wrong#Guess-1x";
const signup = (id, password, extra = {}) =>
  raw("POST", "/signup", { body: { fullName: "Sec Tester", id, email: `${id}@example.com`, userType: "Student", password, ...extra } });
const login = (id, password) => raw("POST", "/login", { body: { id, password, role: "student" } });
const row = async (id) => (await query("SELECT * FROM users WHERE id_number = ? AND role = 'student'", [id]))[0];

// ---------------------------------------------------------------------------------------
section("Password policy on sign up");
{
  const weak = ["short1!A", "alllowercaseletters", "Password123!", "qwertyuiop12A!", "aaaaaaaaaa1A!", "Abcdefgh1234!"];
  for (const [i, password] of weak.entries()) {
    const result = await signup(`w${stamp}${i}`, password);
    check(result.status === 400, `refused: ${password}`, `${result.status} ${result.text.slice(0, 80)}`);
  }
  const personal = await signup(`n${stamp}`, `n${stamp}-Zk!9xq`);
  check(personal.status === 400, "password containing the ID is refused", String(personal.status));
  const long = await signup(`l${stamp}`, "A1!" + "x".repeat(200));
  check(long.status === 400, "over-long password is refused", String(long.status));
  const ok = await signup(`ok${stamp}`, GOOD);
  check(ok.status === 201, "a strong password is accepted", `${ok.status} ${ok.text.slice(0, 80)}`);
}

// ---------------------------------------------------------------------------------------
section("Hashing");
{
  const account = await row(`ok${stamp}`);
  check(/^scrypt\$32768\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(account.password), "stored as salted scrypt with its settings", account.password.slice(0, 30));
  check(!account.password.includes(GOOD), "plaintext is not stored");
  const other = await signup(`ok2${stamp}`, GOOD);
  const second = await row(`ok2${stamp}`);
  check(other.status === 201 && second.password !== account.password, "same password, different hash (salted)");
  // an old plaintext row is accepted once and upgraded
  await query("UPDATE users SET password = ? WHERE user_pk = ?", ["legacyPlain-9Z!", second.user_pk]);
  const legacy = await login(`ok2${stamp}`, "legacyPlain-9Z!");
  check(legacy.status === 200, "legacy plaintext still signs in", String(legacy.status));
  check((await row(`ok2${stamp}`)).password.startsWith("scrypt$32768$"), "and is upgraded to the new hash");
  const history = await query("SELECT COUNT(*) AS n FROM password_history WHERE user_pk = ?", [account.user_pk]);
  check(Number(history[0].n) === 1, "first password is in the history");
}

// ---------------------------------------------------------------------------------------
section("Changing your own password");
{
  const id = `ok${stamp}`;
  const old = (await login(id, GOOD)).json.token;
  const call = (body, token = old) => raw("POST", "/me/password", { token, body });
  check((await call({ currentPassword: "nope", newPassword: "Rt5@glacier-Pw" })).status === 403, "wrong current password is refused");
  check((await call({ currentPassword: GOOD, newPassword: "weak" })).status === 400, "weak new password is refused");
  check((await call({ currentPassword: GOOD, newPassword: GOOD })).status === 400, "same password is refused");
  check((await call({ currentPassword: GOOD })).status === 400, "missing field is refused");
  const done = await call({ currentPassword: GOOD, newPassword: "Rt5@glacier-Pw" });
  check(done.status === 200 && done.json.token, "a good change works", done.text.slice(0, 80));
  check((await raw("GET", "/me", { token: old })).status === 401, "the old session token stops working");
  check((await raw("GET", "/me", { token: done.json.token })).status === 200, "the new session token works");
  check((await login(id, GOOD)).status === 401, "the old password no longer works");
  check((await login(id, "Rt5@glacier-Pw")).status === 200, "the new password works");
  const reuse = await call({ currentPassword: "Rt5@glacier-Pw", newPassword: GOOD }, done.json.token);
  check(reuse.status === 400 && /recent/i.test(reuse.text), "reusing a recent password is refused", reuse.text.slice(0, 100));
  let token = done.json.token;
  let current = "Rt5@glacier-Pw";
  for (let i = 0; i < 6; i += 1) {
    const next = `Cy${i}#tundra-Vh${i}x`;
    const step = await call({ currentPassword: current, newPassword: next }, token);
    if (step.status !== 200) check(false, `change ${i}`, step.text.slice(0, 80));
    token = step.json?.token;
    current = next;
  }
  const keep = await query("SELECT COUNT(*) AS n FROM password_history WHERE user_pk = ?", [(await row(id)).user_pk]);
  check(Number(keep[0].n) === 5, "only the last 5 passwords are remembered", String(keep[0].n));
}

// ---------------------------------------------------------------------------------------
section("Forced change on first sign-in");
{
  const id = `fc${stamp}`;
  await signup(id, GOOD);
  const account = await row(id);
  await query("UPDATE users SET must_change_password = 1 WHERE user_pk = ?", [account.user_pk]);
  const session = (await login(id, GOOD)).json;
  check(session.mustChangePassword === true, "sign-in says the password must be changed");
  const blocked = await raw("GET", "/tickets", { token: session.token });
  check(blocked.status === 403 && blocked.json.code === "password_change_required", "everything else is blocked", `${blocked.status} ${blocked.text.slice(0, 80)}`);
  check((await raw("POST", "/tickets", { token: session.token, body: {} })).status === 403, "creating a ticket is blocked");
  const me = await raw("GET", "/me", { token: session.token });
  check(me.status === 200 && me.json.mustChangePassword === true, "/me still works and says so");
  const changed = await raw("POST", "/me/password", { token: session.token, body: { currentPassword: GOOD, newPassword: "Hd2$bamboo-Nq" } });
  check(changed.status === 200, "the change goes through", changed.text.slice(0, 80));
  const after = await raw("GET", "/tickets?mine=1", { token: changed.json.token });
  check(after.status === 200, "the app opens up afterwards", String(after.status));
  check(Number((await row(id)).must_change_password) === 0, "the flag is cleared");
}

// ---------------------------------------------------------------------------------------
section("Progressive lockout");
{
  const id = `lk${stamp}`;
  await signup(id, GOOD);
  const account = await row(id);
  const wrong = () => login(id, WRONG);
  const expire = () => query("UPDATE users SET locked_until = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE user_pk = ?", [account.user_pk]);
  const results = [];
  for (let i = 0; i < 4; i += 1) results.push(await wrong());
  check(results.every((r) => r.status === 401 && !r.json.cooldownSeconds), "attempts 1-4: plain 401");
  const fifth = await wrong();
  check(fifth.status === 401 && fifth.json.cooldownSeconds === 10, "attempt 5: 10 second cooldown");
  check((await login(id, GOOD)).status === 429, "the right password waits during the cooldown");
  await expire();
  for (let i = 0; i < 4; i += 1) await wrong(); // 6..9
  await expire();
  const tenth = await wrong();
  check(tenth.status === 423 && tenth.json.lockedMinutes === 5 && tenth.json.lockLevel === 1, "attempt 10: locked for 5 minutes", tenth.text.slice(0, 120));
  const minutes = Math.round((new Date((await row(id)).locked_until) - Date.now()) / 60000);
  check(minutes >= 4 && minutes <= 6, "lock is really stored for about 5 minutes", String(minutes));
  const during = await login(id, GOOD);
  check(!during.json?.token && [423, 429].includes(during.status), "the right password is refused while locked", String(during.status));
  const plan = [[15, 2], [60, 3], [360, 4], [1440, 5], [1440, 6]];
  for (const [wait, level] of plan) {
    await expire();
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await wrong();
      if (i < 4) await expire();
    }
    check(last.status === 423 && last.json.lockedMinutes === wait && last.json.lockLevel === level, `lock number ${level}: ${wait} minutes`, last.text.slice(0, 120));
  }
  const alerts = await query("SELECT COUNT(*) AS n FROM notifications WHERE type = 'security_lock' AND body LIKE ?", [`%${id}%`]);
  check(Number(alerts[0].n) > 0, "admins are told about repeated locks", String(alerts[0].n));
  await expire();
  const ok = await login(id, GOOD);
  check(ok.status === 200, "right password works once the lock has ended", String(ok.status));
  const reset = await row(id);
  check(reset.lock_level === 0 && reset.failed_logins === 0 && reset.locked_until === null, "success resets the counters");
  for (let i = 0; i < 10; i += 1) {
    await wrong();
    if (i === 4) await expire();
  }
  await query("UPDATE users SET locked_until = NULL, last_failed_at = DATE_SUB(NOW(), INTERVAL 25 HOUR) WHERE user_pk = ?", [account.user_pk]);
  const calm = await wrong();
  check(calm.status === 401 && !calm.json.cooldownSeconds && (await row(id)).lock_level === 0, "a quiet day forgives old failures");
}

// ---------------------------------------------------------------------------------------
section("Sign-in does not reveal which IDs exist");
{
  const known = await login(`ok${stamp}`, WRONG);
  const unknown = await login(`nobody${stamp}`, WRONG);
  check(known.status === unknown.status && known.json.error === unknown.json.error, "same answer for unknown ID and wrong password");
  const times = [];
  for (let i = 0; i < 3; i += 1) times.push([(await login(`nobody${stamp}x${i}`, WRONG)).ms, (await login(`ok${stamp}`, WRONG)).ms]);
  const avg = (index) => times.reduce((sum, t) => sum + t[index], 0) / times.length;
  check(avg(0) > avg(1) * 0.5, "an unknown ID takes about as long as a wrong password", `${avg(0).toFixed(0)}ms vs ${avg(1).toFixed(0)}ms`);
}

// ---------------------------------------------------------------------------------------
section("Admin password requests follow the policy");
{
  const id = `pr${stamp}`;
  await signup(id, GOOD);
  const token = (await login(id, GOOD)).json.token;
  const weak = await raw("POST", "/password-requests", { token, body: { newPassword: "weakweak1" } });
  check(weak.status === 400, "weak password in a request is refused", String(weak.status));
  const same = await raw("POST", "/password-requests", { token, body: { newPassword: GOOD } });
  check(same.status === 400, "request for the current password is refused", String(same.status));
  const ok = await raw("POST", "/password-requests", { token, body: { newPassword: "Pr4%saffron-Ld" } });
  check(ok.status === 201 || ok.status === 200, "a good request is accepted", `${ok.status} ${ok.text.slice(0, 80)}`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failures:");
  for (const f of failures) console.log(" -", f);
}
await pool.end();
process.exit(failures.length ? 1 : 0);
