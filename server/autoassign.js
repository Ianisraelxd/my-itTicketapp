// Auto-assignment with a 30-minute expiry.
//
//   - A ticket nobody has picked up (Open) for 30 minutes is assigned to an agent whose skills
//     match the ticket's category.
//   - An auto-assigned ticket that is still not resolved 30 minutes after it was assigned
//     "expires": it is taken from that agent and given to another agent with the same specialty.
//   - Tickets an admin assigned by hand are pinned (assigned_manually = 1) and are never moved
//     automatically; an admin can always assign or reassign manually.
//
// pickAgent() and isDue() are pure functions (unit-tested in autoassign.test.js); the rest talks
// to the database and is started once from index.js with startAutoAssign().

export const AUTO_ASSIGN_MINUTES = Number(process.env.AUTO_ASSIGN_MINUTES) || 30;
const CHECK_EVERY_MS = Number(process.env.AUTO_ASSIGN_CHECK_SECONDS || 60) * 1000;
const ENABLED = process.env.AUTO_ASSIGN !== "false";

// users.skills is a comma-separated list of ticket categories.
export function hasSkill(skills, category) {
  const wanted = String(category ?? "").trim().toLowerCase();
  if (!wanted) return false;
  return String(skills ?? "")
    .split(",")
    .some((skill) => skill.trim().toLowerCase() === wanted);
}

/** True when the ticket's current assignment (or its waiting time) is older than the limit. */
export function isDue({ startedAt, createdAt, now = Date.now(), minutes = AUTO_ASSIGN_MINUTES }) {
  const start = new Date(startedAt ?? createdAt).getTime();
  return Number.isFinite(start) && now - start >= minutes * 60000;
}

/**
 * Choose the specialist for a ticket.
 * @param {{category: string, assignedTo?: number|null}} ticket
 * @param {Array<{id: number, skills: string, active: number, online: boolean, lastAssignedAt?: number|null}>} agents
 * @param {number[]} triedIds agents who already had this ticket
 * @returns {{agent: object|null, reason: string}}
 */
export function pickAgent(ticket, agents, triedIds = []) {
  const specialists = agents.filter((agent) => hasSkill(agent.skills, ticket.category));
  if (specialists.length === 0) return { agent: null, reason: "no_specialist" };

  const others = specialists.filter((agent) => agent.id !== ticket.assignedTo);
  if (others.length === 0) return { agent: null, reason: "no_other_specialist" };

  // Give the ticket to someone who has not had it yet; when everyone has, start another round.
  const fresh = others.filter((agent) => !triedIds.includes(agent.id));
  const pool = fresh.length > 0 ? fresh : others;

  const ranked = [...pool].sort(
    (a, b) =>
      Number(b.online) - Number(a.online) || // online first
      a.active - b.active || // lightest load
      (a.lastAssignedAt ?? 0) - (b.lastAssignedAt ?? 0) || // waited longest for work
      a.id - b.id,
  );
  return { agent: ranked[0], reason: "ok" };
}


async function loadAgents(query) {
  const rows = await query(
    `SELECT u.user_pk AS id, u.name, u.skills,
       (u.last_seen_at > DATE_SUB(NOW(), INTERVAL 90 SECOND)) AS online,
       (SELECT COUNT(*) FROM tickets t WHERE t.assigned_to = u.user_pk AND t.status IN ('Open', 'In Progress')) AS active,
       (SELECT UNIX_TIMESTAMP(MAX(a.created_at)) FROM ticket_assignments a WHERE a.agent_pk = u.user_pk) AS lastAssigned
     FROM users u WHERE u.role = 'agent'`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    skills: row.skills,
    online: Boolean(row.online),
    active: Number(row.active),
    lastAssignedAt: row.lastAssigned == null ? null : Number(row.lastAssigned),
  }));
}

/** One pass: handle every ticket whose 30 minutes are up. Returns what it did (used by tests). */
export async function runAutoAssign({ query, pool, notify, adminIds, postNotice }) {
  const results = [];
  const due = await query(
    `SELECT t.ticket_pk, t.code, t.subject, t.category, t.created_by, t.assigned_to, t.assignment_started_at
     FROM tickets t
     WHERE t.status IN ('Open', 'In Progress') AND t.assigned_manually = 0
       AND COALESCE(t.assignment_started_at, t.created_at) <= DATE_SUB(NOW(), INTERVAL ${Number(AUTO_ASSIGN_MINUTES)} MINUTE)
     ORDER BY COALESCE(t.assignment_started_at, t.created_at) ASC LIMIT 50`,
  );

  for (const ticket of due) {
    const agents = await loadAgents(query);
    const history = await query("SELECT agent_pk FROM ticket_assignments WHERE ticket_pk = ?", [ticket.ticket_pk]);
    const { agent, reason } = pickAgent(
      { category: ticket.category, assignedTo: ticket.assigned_to },
      agents,
      history.map((row) => row.agent_pk),
    );

    if (!agent) {
      if (ticket.assigned_to) {
        // Nobody else has this specialty: let the current agent keep it and start a new 30 minutes.
        await query(
          "UPDATE tickets SET assignment_started_at = NOW() WHERE ticket_pk = ? AND assigned_to = ? AND status IN ('Open', 'In Progress')",
          [ticket.ticket_pk, ticket.assigned_to],
        );
      }
      const recent = await query(
        "SELECT 1 FROM notifications WHERE ticket_code = ? AND type = 'auto_unassigned' AND created_at > DATE_SUB(NOW(), INTERVAL 60 MINUTE) LIMIT 1",
        [ticket.code],
      );
      if (recent.length === 0) {
        await notify(await adminIds(), {
          type: "auto_unassigned",
          title: reason === "no_specialist" ? "No agent with this specialty" : "No other agent with this specialty",
          body:
            reason === "no_specialist"
              ? `${ticket.code} (${ticket.category}) has been waiting ${AUTO_ASSIGN_MINUTES} min and no agent has that skill. Please assign it.`
              : `${ticket.code} (${ticket.category}) was not resolved in ${AUTO_ASSIGN_MINUTES} min, but it is the only agent with that skill. Timer restarted.`,
          ticketCode: ticket.code,
        });
      }
      results.push({ code: ticket.code, action: "none", reason });
      continue;
    }

    // The guard in the UPDATE makes sure nobody changed the ticket (resolved, cancelled, assigned
    // by an admin) between the SELECT above and now.
    const [updated] = await pool.execute(
      `UPDATE tickets SET assigned_to = ?, status = 'In Progress', assignment_started_at = NOW(),
         assigned_at = COALESCE(assigned_at, NOW()), first_response_at = COALESCE(first_response_at, NOW()),
         auto_assign_count = auto_assign_count + 1
       WHERE ticket_pk = ? AND status IN ('Open', 'In Progress') AND assigned_manually = 0 AND assigned_to <=> ?`,
      [agent.id, ticket.ticket_pk, ticket.assigned_to],
    );
    if (updated.affectedRows === 0) continue;

    const expired = Boolean(ticket.assigned_to);
    await query("INSERT INTO ticket_assignments (ticket_pk, agent_pk, assigned_by, method) VALUES (?, ?, NULL, ?)", [
      ticket.ticket_pk,
      agent.id,
      expired ? "expired" : "auto",
    ]);

    const previous = expired ? agents.find((row) => row.id === ticket.assigned_to) : null;
    await postNotice(
      ticket.ticket_pk,
      expired
        ? `Not resolved within ${AUTO_ASSIGN_MINUTES} minutes, so the ticket was reassigned from ${previous?.name ?? "the previous agent"} to ${agent.name} (${ticket.category} specialist).`
        : `Nobody picked this up within ${AUTO_ASSIGN_MINUTES} minutes, so it was assigned automatically to ${agent.name} (${ticket.category} specialist).`,
    );
    await notify([agent.id], {
      type: "assigned",
      title: expired ? "Ticket reassigned to you" : "New ticket assigned to you",
      body: `${ticket.code}: ${ticket.subject}. Please resolve it within ${AUTO_ASSIGN_MINUTES} minutes or it moves on.`,
      ticketCode: ticket.code,
    });
    if (expired) {
      await notify([ticket.assigned_to], {
        type: "reassigned",
        title: "Ticket reassigned",
        body: `${ticket.code} was not resolved in ${AUTO_ASSIGN_MINUTES} minutes and moved to ${agent.name}.`,
        ticketCode: ticket.code,
      });
    }
    await notify([ticket.created_by], {
      type: "in_progress",
      title: expired ? "Your request moved to another agent" : "An agent is on your request",
      body: `${agent.name} is now handling ${ticket.code}: ${ticket.subject}`,
      ticketCode: ticket.code,
    });
    await notify(await adminIds(), {
      type: "auto_assigned",
      title: expired ? "Ticket auto-reassigned" : "Ticket auto-assigned",
      body: `${ticket.code} (${ticket.category}) went to ${agent.name}${previous ? ` after ${previous.name} ran out of time` : ""}.`,
      ticketCode: ticket.code,
    });
    results.push({ code: ticket.code, action: expired ? "expired" : "auto", to: agent.name });
  }
  return results;
}

let running = false;

/** Starts the check that runs every minute. Set AUTO_ASSIGN=false to switch it off. */
export function startAutoAssign(deps) {
  if (!ENABLED) {
    console.log("Auto-assign is off (AUTO_ASSIGN=false).");
    return null;
  }
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const done = await runAutoAssign(deps);
      for (const item of done) if (item.action !== "none") console.log("auto-assign:", JSON.stringify(item));
    } catch (error) {
      console.error("auto-assign failed:", error.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref?.();
  return { tick, timer };
}
