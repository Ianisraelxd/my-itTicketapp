// Run with: npm test   (uses Node's built-in test runner, no extra packages)
import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIORITY_MATRIX,
  calculatePriority,
  calculatePriorityTier,
  escalate,
  findEscalationKeywords,
  tierToPriorityLabel,
} from "./priority.js";

const calc = (impact, urgency, description = "", isFinalsWeek = false) =>
  calculatePriorityTier({ impact, urgency, description, isFinalsWeek });

test("matrix: every impact x urgency combination", () => {
  const expected = {
    Organization: { High: "P1", Medium: "P1", Low: "P2" },
    Department: { High: "P1", Medium: "P2", Low: "P3" },
    Individual: { High: "P2", Medium: "P3", Low: "P4" },
  };
  assert.deepEqual(PRIORITY_MATRIX, expected);
  for (const [impact, row] of Object.entries(expected)) {
    for (const [urgency, tier] of Object.entries(row)) {
      assert.equal(calc(impact, urgency).tier, tier, `${impact} + ${urgency}`);
    }
  }
});

test("keywords escalate by exactly one tier", () => {
  const result = calc("Department", "Low", "Projector broken before the Dean visits");
  assert.equal(result.baseTier, "P3");
  assert.equal(result.tier, "P2");
  assert.equal(result.escalated, true);
  assert.deepEqual(result.keywords, ["Dean"]);
});

test("keyword matching is case-insensitive and whole-word", () => {
  assert.deepEqual(findEscalationKeywords("EXAM tomorrow, graduation rehearsal"), ["Exam", "Graduation"]);
  assert.deepEqual(findEscalationKeywords("see the example above"), []);
  assert.deepEqual(findEscalationKeywords(null), []);
});

test("finals week escalates even without keywords", () => {
  assert.equal(calc("Individual", "Low", "mouse is broken", true).tier, "P3");
});

test("keyword and finals week together still escalate only one tier", () => {
  assert.equal(calc("Individual", "Low", "exam software", true).tier, "P3");
});

test("P1 cannot escalate further", () => {
  const result = calc("Organization", "High", "exam day", true);
  assert.equal(result.tier, "P1");
  assert.equal(result.escalated, false);
  assert.equal(escalate("P1"), "P1");
});

test("invalid input is rejected", () => {
  assert.throws(() => calc("Everyone", "High"), RangeError);
  assert.throws(() => calc("Individual", "Urgent"), RangeError);
});

test("tier to the legacy High/Medium/Low label", () => {
  assert.deepEqual(["P1", "P2", "P3", "P4"].map(tierToPriorityLabel), ["High", "High", "Medium", "Low"]);
});

test("middleware stores the result on the request, or answers 400", () => {
  const req = { body: { impactLevel: "Department", urgencyLevel: "Medium", description: "Lecture hall projector" } };
  let nextCalled = false;
  calculatePriority(req, {}, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(req.priority.tier, "P1"); // P2 escalated by "Lecture"

  let status = null;
  let payload = null;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(body) {
      payload = body;
    },
  };
  calculatePriority({ body: { impactLevel: "x", urgencyLevel: "High" } }, res, () => assert.fail("should not continue"));
  assert.equal(status, 400);
  assert.match(payload.error, /impact/);
});
