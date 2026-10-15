import assert from "node:assert/strict";
import test from "node:test";

import { MAX_LENGTH, MIN_LENGTH, evaluatePassword, passwordProblem } from "../shared/passwordPolicy.js";

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

