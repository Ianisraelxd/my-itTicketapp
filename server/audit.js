// The ticket history ("who changed what"): one row per important action in ticket_events.
// Logging never breaks the action it records.
import { query } from "./db.js";

/**
 * @param {{ticketPk: number, actor?: {userId?: number, name: string, roleName: string}|null, action: string, detail?: string|null}} event
 * Pass actor = null for something the system did by itself (auto-assign, auto-close).
 */
export async function logEvent({ ticketPk, actor = null, action, detail = null }) {
  try {
    await query(
      "INSERT INTO ticket_events (ticket_pk, actor_pk, actor_name, actor_role, action, detail) VALUES (?, ?, ?, ?, ?, ?)",
      [ticketPk, actor?.userId ?? null, actor?.name ?? "System", actor?.roleName ?? "Automatic", action, detail ? String(detail).slice(0, 500) : null],
    );
  } catch (error) {
    console.error("could not write the ticket history:", error.message);
  }
}

// Short, readable label for each action (used by the History tab).
export const EVENT_LABELS = {
  created: "Request submitted",
  assigned: "Assigned by an admin",
  auto_assigned: "Assigned automatically",
  reassigned: "Reassigned automatically (30 minutes passed)",
  status: "Status changed",
  cancelled: "Cancelled by an admin",
  cancellation_requested: "Cancellation requested",
  cancellation_approved: "Cancellation approved",
  cancellation_rejected: "Cancellation declined",
  reopened: "Reopened",
  closed: "Closed for good",
  rating: "Rated the support",
  attachment_added: "Photo added",
};
