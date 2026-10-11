import assert from "node:assert/strict";
import test from "node:test";

import { hasSkill, isDue, pickAgent } from "./autoassign.js";

const agent = (id, skills, extra = {}) => ({ id, skills, active: 0, online: false, lastAssignedAt: null, ...extra });

test("hasSkill matches the category exactly, ignoring case and spaces", () => {
  assert.equal(hasSkill("Hardware, Printer", "printer"), true);
  assert.equal(hasSkill("Network / Internet", "Network / Internet"), true);
  assert.equal(hasSkill("Hardware", "Software"), false);
  assert.equal(hasSkill("", "Hardware"), false);
});

test("isDue is true only after the 30 minutes", () => {
  const now = Date.parse("2026-10-12T10:00:00Z");
  assert.equal(isDue({ createdAt: "2026-10-12T09:31:00Z", now }), false);
  assert.equal(isDue({ createdAt: "2026-10-12T09:30:00Z", now }), true);
  // the assignment time wins over the creation time
  assert.equal(isDue({ startedAt: "2026-10-12T09:45:00Z", createdAt: "2026-10-12T08:00:00Z", now }), false);
});

test("only agents with the matching specialty are picked", () => {
  const agents = [agent(1, "Hardware"), agent(2, "Software"), agent(3, "Software,Printer")];
  assert.equal(pickAgent({ category: "Printer" }, agents).agent.id, 3);
  assert.equal(pickAgent({ category: "Network / Internet" }, agents).reason, "no_specialist");
});

test("an expired ticket moves to a different specialist", () => {
  const agents = [agent(1, "Software"), agent(2, "Software")];
  const result = pickAgent({ category: "Software", assignedTo: 1 }, agents, [1]);
  assert.equal(result.agent.id, 2);
});

test("with a single specialist nothing moves", () => {
  const result = pickAgent({ category: "Software", assignedTo: 1 }, [agent(1, "Software"), agent(2, "Hardware")], [1]);
  assert.equal(result.agent, null);
  assert.equal(result.reason, "no_other_specialist");
});

test("ranking: online first, then lightest load, then longest idle", () => {
  const agents = [
    agent(1, "Software", { online: false, active: 0 }),
    agent(2, "Software", { online: true, active: 3 }),
    agent(3, "Software", { online: true, active: 1, lastAssignedAt: 500 }),
    agent(4, "Software", { online: true, active: 1, lastAssignedAt: 100 }),
  ];
  assert.equal(pickAgent({ category: "Software" }, agents).agent.id, 4);
});

test("agents who already had the ticket are skipped until everyone has had a turn", () => {
  const agents = [agent(1, "Software"), agent(2, "Software"), agent(3, "Software")];
  assert.equal(pickAgent({ category: "Software", assignedTo: 2 }, agents, [1, 2]).agent.id, 3);
  // all have had it: another round starts with the lightest-loaded other agent
  assert.ok([1, 3].includes(pickAgent({ category: "Software", assignedTo: 2 }, agents, [1, 2, 3]).agent.id));
});
