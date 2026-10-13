// Live updates (Server-Sent Events). A browser opens one long-lived connection and the server pushes
// a tiny message ("something changed") the moment a notification or chat message is created, so pages
// refresh at once instead of waiting for the next check. Polling stays as a slower safety net.
import crypto from "node:crypto";

const clients = new Map(); // userId -> Set of open responses
const tickets = new Map(); // one-time connection ticket -> { userId, expires }

// EventSource cannot send an Authorization header, so a signed-in browser first asks for a
// single-use ticket (valid for 30 seconds) and puts that in the address instead of its token.
export function issueEventTicket(userId) {
  const ticket = crypto.randomBytes(24).toString("hex");
  tickets.set(ticket, { userId, expires: Date.now() + 30000 });
  for (const [key, value] of tickets) if (value.expires < Date.now()) tickets.delete(key);
  return ticket;
}

export function connectEvents(req, res) {
  const entry = tickets.get(String(req.query.ticket ?? ""));
  tickets.delete(String(req.query.ticket ?? ""));
  if (!entry || entry.expires < Date.now()) return res.status(401).json({ error: "Please sign in again." });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 4000\n\n");
  res.write(`data: ${JSON.stringify({ type: "hello" })}\n\n`);

  if (!clients.has(entry.userId)) clients.set(entry.userId, new Set());
  clients.get(entry.userId).add(res);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.get(entry.userId)?.delete(res);
    if (clients.get(entry.userId)?.size === 0) clients.delete(entry.userId);
  });
}

/** Tell these users something changed. `event` is a small object such as { type: "message", code: "#HD001" }. */
export function publish(userIds, event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const userId of new Set((userIds || []).filter(Boolean))) {
    for (const res of clients.get(userId) ?? []) res.write(data);
  }
}

export const connectedUsers = () => clients.size;
