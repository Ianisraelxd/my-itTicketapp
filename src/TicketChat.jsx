import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";

// "Open" is the status new tickets start in, so it counts as Pending here.
const DIRECT_CANCEL_STATUSES = ["Pending", "Approved", "Assigned", "Open"];
const CLOSED_STATUSES = ["Resolved", "Done", "Closed", "Cancelled"];

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * In-ticket conversation plus the smart cancel control.
 *
 * - Pending / Approved / Assigned (Open): ticket owner gets a direct "Cancel ticket".
 * - In Progress: owner gets "Request cancellation", which posts a message
 *   for the technician instead of changing the status.
 * - Resolved / Done / Closed / Cancelled: no cancel control and the chat is read-only.
 */
export default function TicketChat({ ticket, me, onChanged, showMessage }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [dialog, setDialog] = useState(null); // "cancel" | "request" | null
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef(null);

  const isOwner = ticket.created_by === me.userId;
  const closed = CLOSED_STATUSES.includes(ticket.status);
  const canCancelDirectly = isOwner && DIRECT_CANCEL_STATUSES.includes(ticket.status);
  const canRequestCancel = isOwner && ticket.status === "In Progress";
  const alreadyRequested = messages.some((message) => message.kind === "cancellation_request");

  const load = useCallback(
    () =>
      api
        .getTicketMessages(ticket.id, me.userId)
        .then((rows) =>
          setMessages((prev) =>
            prev.length === rows.length && prev.at(-1)?.id === rows.at(-1)?.id ? prev : rows,
          ),
        )
        .catch(() => {}),
    [ticket.id, me.userId],
  );

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages.length]);

  async function send(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending || closed) return;
    setSending(true);
    try {
      await api.sendTicketMessage(ticket.id, { userId: me.userId, text });
      setDraft("");
      await load();
    } catch (error) {
      showMessage("Could not send message", error.message || "Please try again.");
      onChanged();
    } finally {
      setSending(false);
    }
  }

  async function cancelTicket() {
    setBusy(true);
    try {
      await api.cancelTicket(ticket.id, me.userId);
      setDialog(null);
      showMessage("Ticket cancelled", `${ticket.id} has been cancelled.`);
    } catch (error) {
      setDialog(null);
      showMessage("Could not cancel", error.message || "Please try again.");
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  async function requestCancellation(event) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await api.sendTicketMessage(ticket.id, {
        userId: me.userId,
        kind: "cancellation_request",
        text: `Cancellation Requested: ${trimmed}`,
      });
      setDialog(null);
      setReason("");
      await load();
      showMessage(
        "Request sent",
        "The technician has been notified of your cancellation request.",
      );
    } catch (error) {
      setDialog(null);
      showMessage("Could not send request", error.message || "Please try again.");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ticket-chat">
      <div className="ticket-chat-head">
        <strong>Conversation</strong>
        {canCancelDirectly && (
          <button type="button" className="table-button danger" onClick={() => setDialog("cancel")}>
            Cancel ticket
          </button>
        )}
        {canRequestCancel && (
          <button
            type="button"
            className="table-button danger"
            disabled={alreadyRequested}
            onClick={() => setDialog("request")}
          >
            {alreadyRequested ? "Cancellation requested" : "Request cancellation"}
          </button>
        )}
      </div>

      <div className="ticket-chat-messages" ref={scroller}>
        {messages.length === 0 && (
          <p className="chat-empty">
            No messages yet. Use this space to talk about {ticket.id} with the other side.
          </p>
        )}
        {messages.map((message, index) => {
          const mine = message.senderId === me.userId;
          const newSender = messages[index - 1]?.senderId !== message.senderId;
          return (
            <div
              className={`chat-msg ${mine ? "mine" : "theirs"} ${
                message.kind === "cancellation_request" ? "cancel-request" : ""
              }`}
              key={message.id}
            >
              {newSender && (
                <span className="chat-meta">
                  <b>{mine ? "You" : message.senderName}</b> · {message.senderRole}
                </span>
              )}
              <span className="chat-bubble">
                {message.kind === "cancellation_request" && (
                  <em className="chat-flag">Cancellation request</em>
                )}
                {message.text}
                <time>{formatTime(message.createdAt)}</time>
              </span>
            </div>
          );
        })}
      </div>

      {closed ? (
        <p className="ticket-chat-closed">
          This ticket is {ticket.status.toLowerCase()}, so the conversation is read-only.
        </p>
      ) : (
        <form className="chat-compose" onSubmit={send}>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write a message…"
            maxLength={1000}
            aria-label="Message"
          />
          <button type="submit" disabled={!draft.trim() || sending} aria-label="Send">
            ➤
          </button>
        </form>
      )}

      {dialog === "cancel" && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()}>
            <div className="modal-icon warn-icon">!</div>
            <h3>Cancel this ticket?</h3>
            <p>
              <strong>{ticket.id}</strong> will be marked as cancelled. This cannot be undone.
            </p>
            <div className="dialog-actions">
              <button
                className="button button-outline"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                Keep ticket
              </button>
              <button className="button button-primary" disabled={busy} onClick={cancelTicket}>
                Yes, cancel it
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === "request" && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <form
            className="modal-box"
            onClick={(event) => event.stopPropagation()}
            onSubmit={requestCancellation}
          >
            <div className="modal-icon warn-icon">!</div>
            <h3>Request cancellation</h3>
            <p>
              A technician is already working on <strong>{ticket.id}</strong>, so it can&rsquo;t be
              cancelled directly. Tell them why and they will handle it.
            </p>
            <label className="field-label dialog-note">
              Reason
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Example: The problem fixed itself."
                maxLength={500}
                required
                autoFocus
              />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="button button-outline"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                Back
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={busy || !reason.trim()}
              >
                Send request
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// Two side-by-side cards: the ticket's details on the left, the conversation on
// the right. On phones they become two tabs.
export function TicketDetailsModal({ ticket, me, onClose, onChanged, showMessage }) {
  const [tab, setTab] = useState("chat");
  const submitted = ticket.createdAt ? formatTime(ticket.createdAt) : "";
  const facts = [
    ["Category", ticket.category],
    ["Priority", `${ticket.priority}`],
    ["Location", ticket.location || "Not provided"],
    ["Requested by", ticket.userName || "Unknown"],
    ["Submitted", submitted || "—"],
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="ticket-duo" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="ticket-duo-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div className="ticket-tabs segmented" role="tablist" aria-label="Ticket sections">
          <button
            type="button"
            className={tab === "details" ? "active" : ""}
            onClick={() => setTab("details")}
          >
            Details
          </button>
          <button
            type="button"
            className={tab === "chat" ? "active" : ""}
            onClick={() => setTab("chat")}
          >
            Chat
          </button>
        </div>

        <aside className={`ticket-card ticket-info ${tab === "details" ? "show" : ""}`}>
          <span className="eyebrow">{ticket.id}</span>
          <h3>{ticket.subject}</h3>
          <span className={`status status-${ticket.status.toLowerCase().replace(" ", "-")}`}>
            <i></i>
            {ticket.status}
          </span>
          <dl className="ticket-facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="ticket-description">
            <span className="eyebrow">DESCRIPTION</span>
            <p>{ticket.description || "No description was provided."}</p>
          </div>
        </aside>

        <section className={`ticket-card ticket-chat-card ${tab === "chat" ? "show" : ""}`}>
          <TicketChat ticket={ticket} me={me} onChanged={onChanged} showMessage={showMessage} />
        </section>
      </div>
    </div>
  );
}
