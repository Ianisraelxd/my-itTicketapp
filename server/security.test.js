import assert from "node:assert/strict";
import test from "node:test";

import { COOLDOWN_AFTER, LOCK_AFTER, RELOCK_AFTER, describeMinutes, lockMinutes, onWrongPassword } from "./lockout.js";
import { SCRYPT_PARAMS, hashPassword, isHashed, needsRehash, spendPasswordTime, verifyPassword } from "./security.js";
import { MAX_LENGTH, MIN_LENGTH, evaluatePassword, generatePassword, passwordProblem } from "../shared/passwordPolicy.js";
import crypto from "node:crypto";

test("hashes are salted, carry their settings and verify only the right password", async () => {
  const a = await hashPassword("Blue-Kite#Harbor-742");
  const b = await hashPassword("Blue-Kite#Harbor-742");
  assert.notEqual(a, b, "a fresh salt each time");
  assert.match(a, /^scrypt\$32768\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(isHashed(a), true);
  assert.equal(await verifyPassword("Blue-Kite#Harbor-742", a), true);
  assert.equal(await verifyPassword("Blue-Kite#Harbor-743", a), false);
  assert.equal(await verifyPassword("", a), false);
  assert.equal(await verifyPassword(["Blue-Kite#Harbor-742"], a), false);
  assert.equal(await verifyPassword("anything", "scrypt$locked$locked"), false);
  assert.equal(await verifyPassword("anything", null), false);
});

test("old hashes still work and are marked for an upgrade", async () => {
  const { scryptSync, randomBytes } = crypto;
  const salt = randomBytes(16);
  const legacy = `scrypt$${salt.toString("hex")}$${scryptSync("OldPass#2020x", salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex")}`;
  assert.equal(await verifyPassword("OldPass#2020x", legacy), true);
  assert.equal(needsRehash(legacy), true);
  assert.equal(needsRehash("plain text password"), true);
  assert.equal(await verifyPassword("plain text password", "plain text password"), true);
  assert.equal(needsRehash(await hashPassword("Fresh#Pass-2026")), false);
  assert.equal(needsRehash("scrypt$locked$locked"), false);
  assert.ok(SCRYPT_PARAMS.N >= 32768);
});

test("an unknown ID costs about as much time as a wrong password", async () => {
  const start = performance.now();
  await spendPasswordTime("whatever");
  await spendPasswordTime("whatever");
  assert.ok(performance.now() - start > 100, "it really hashes");
});

test("password policy: refuses weak, common, personal and patterned passwords", () => {
  const me = { id: "2024-00417", name: "Maria Santos", email: "maria.santos@campus.edu" };
  const ok = (p) => evaluatePassword(p, me).ok;
  for (const bad of ["", "short1A!", "password", "Password123!", "P@ssw0rd2026", "qwerty12345", "alllowercaseletters", "ALLUPPERCASE123", "1234567890", "aaaaBBBB1111!!", "Maria#Santos2026", "mar2024-00417X!", "maria.santos#Xk9", "x".repeat(MAX_LENGTH + 1)]) {
    assert.equal(ok(bad), false, `should refuse: ${bad.slice(0, 30)}`);
  }
  for (const good of ["Blue-Kite#Harbor-742", "Tr0ub4dor&3x", "correct-Horse-battery9", "Xk9#mQ2vLp"]) {
    assert.equal(ok(good), true, `should accept: ${good}`);
  }
  assert.equal(MIN_LENGTH, 10);
  assert.equal(passwordProblem("Blue-Kite#Harbor-742", me), null);
  assert.match(passwordProblem("abc", me), /stronger password/);
});

test("password policy: score rises with length and variety and is capped when a rule fails", () => {
  assert.equal(evaluatePassword("").score, 0);
  assert.ok(evaluatePassword("Blue-Kite#Harbor-742").score >= 3);
  assert.ok(evaluatePassword("Blue-Kite#Harbor-742").score > evaluatePassword("Xk9#mQ2vLp").score - 1);
  assert.ok(evaluatePassword("Password123!").score <= 1);
});

test("generated passwords always pass the policy", () => {
  for (let i = 0; i < 200; i += 1) {
    const password = generatePassword((n) => crypto.randomInt(n));
    assert.equal(evaluatePassword(password).ok, true, password);
    assert.ok(password.length >= 16);
  }
});

test("progressive lockout: cooldown, then locks that get longer, then forgiven", () => {
  const day = 24 * 3600 * 1000;
  const start = 1_000_000_000_000;
  let account = { failed_logins: 0, lock_level: 0, last_failed_at: null };
  const wrong = (now) => {
    const result = onWrongPassword(account, now);
    account = { failed_logins: result.failed, lock_level: result.level, last_failed_at: new Date(now) };
    return result;
  };
  const actions = [];
  for (let i = 0; i < LOCK_AFTER; i += 1) actions.push(wrong(start + i * 1000).action);
  assert.deepEqual(actions, ["none", "none", "none", "none", "cooldown", "none", "none", "none", "none", "lock"]);
  assert.equal(account.lock_level, 1);
  assert.equal(lockMinutes(1), 5);

  // after the lock only RELOCK_AFTER more mistakes are needed, and the second lock is longer
  const second = [];
  for (let i = 0; i < RELOCK_AFTER; i += 1) second.push(wrong(start + 60_000 + i * 1000));
  assert.equal(second.at(-1).action, "lock");
  assert.equal(second.at(-1).level, 2);
  assert.equal(second.at(-1).minutes, 15);
  assert.ok(second.slice(0, -1).every((r) => r.action === "none"));

  for (let i = 0; i < RELOCK_AFTER; i += 1) wrong(start + 120_000 + i * 1000);
  assert.equal(account.lock_level, 3);
  for (let i = 0; i < RELOCK_AFTER; i += 1) wrong(start + 180_000 + i * 1000);
  assert.equal(account.lock_level, 4);
  for (let i = 0; i < RELOCK_AFTER * 3; i += 1) wrong(start + 240_000 + i * 1000);
  assert.equal(account.lock_level, 7);
  assert.equal(lockMinutes(7), 1440, "never longer than 24 hours");

  // a quiet day wipes the slate
  const forgiven = onWrongPassword(account, start + 3 * day);
  assert.deepEqual([forgiven.action, forgiven.level, forgiven.failed], ["none", 0, 1]);
  assert.equal(COOLDOWN_AFTER, 5);
});

test("lock lengths read naturally", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(lockMinutes), [5, 15, 60, 360, 1440, 1440]);
  assert.equal(describeMinutes(5), "5 minutes");
  assert.equal(describeMinutes(1), "1 minute");
  assert.equal(describeMinutes(60), "1 hour");
  assert.equal(describeMinutes(1440), "24 hours");
});
