// Resolved tickets are closed for good a few days later: they stay "Resolved" in every report, but
// can no longer be reopened (the requester should submit a new request instead).
//   AUTO_CLOSE_DAYS=3 (default), 0 switches it off.
import { logEvent } from "./audit.js";

const parsed = Number(process.env.AUTO_CLOSE_DAYS);
export const CLOSE_DAYS = Number.isFinite(parsed) && process.env.AUTO_CLOSE_DAYS !== undefined && process.env.AUTO_CLOSE_DAYS !== "" ? parsed : 3;
const CHECK_EVERY_MS = Number(process.env.AUTO_CLOSE_CHECK_SECONDS || 600) * 1000;

/** One pass. Returns the codes that were closed. */
export async function runAutoClose({ query, notify, postNotice, days = CLOSE_DAYS }) {
  if (!(days > 0)) return [];
  const due = await query(
    "SELECT ticket_pk, code, subject, created_by FROM tickets WHERE status = 'Resolved' AND closed_at IS NULL AND resolved_at IS NOT NULL AND resolved_at <= DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT 200",
    [Number(days)],
  );
  const closed = [];
  for (const ticket of due) {
    // The guard keeps a ticket that was reopened a moment ago from being closed.
    const result = await query(
      "UPDATE tickets SET closed_at = NOW() WHERE ticket_pk = ? AND status = 'Resolved' AND closed_at IS NULL",
      [ticket.ticket_pk],
    );
    if (result.affectedRows === 0) continue;
    await logEvent({ ticketPk: ticket.ticket_pk, action: "closed", detail: `${days} days after it was resolved` });
    await postNotice(ticket.ticket_pk, `This ticket was closed for good ${days} days after it was resolved. If the problem comes back, please submit a new request.`);
    await notify([ticket.created_by], {
      type: "status",
      title: "Request closed",
      body: `${ticket.code}: ${ticket.subject} is now closed. Submit a new request if the problem returns.`,
      ticketCode: ticket.code,
    });
    closed.push(ticket.code);
  }
  return closed;
}

export function startAutoClose(deps) {
  if (!(CLOSE_DAYS > 0)) return null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const code of await runAutoClose(deps)) console.log("auto-close:", code);
    } catch (error) {
      console.error("auto-close failed:", error.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref?.();
  setTimeout(tick, 5000).unref?.();
  return { tick, timer };
}
