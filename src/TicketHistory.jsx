import { useState } from "react";

import { api } from "./api";

function when(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "Who changed what" for one ticket. The list loads the first time it is opened. */
export default function TicketHistory({ ticketId, me }) {
  const [state, setState] = useState({ status: "idle", rows: [] });

  function load(event) {
    if (!event.currentTarget.open || state.status === "ready") return;
    setState({ status: "loading", rows: [] });
    api
      .getTicketHistory(ticketId, me.userId)
      .then((rows) => setState({ status: "ready", rows }))
      .catch(() => setState({ status: "error", rows: [] }));
  }

  return (
    <details className="ticket-history" onToggle={load}>
      <summary>History: who changed what</summary>
      {state.status === "loading" && <p className="history-note">Loading…</p>}
      {state.status === "error" && <p className="history-note">The history could not be loaded.</p>}
      {state.status === "ready" && state.rows.length === 0 && <p className="history-note">Nothing recorded yet.</p>}
      {state.rows.length > 0 && (
        <ol>
          {state.rows.map((row) => (
            <li key={row.id}>
              <b>{row.label}</b>
              {row.detail && <span className="history-detail">{row.detail}</span>}
              <small>
                {row.actorName} · {row.actorRole} · {when(row.createdAt)}
              </small>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
