import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";

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
 * In-ticket conversation plus the cancellation-request control.
 *
 * Requesters never cancel a ticket themselves. While a ticket is still open
 * they can send a cancellation request (with a reason); an admin approves or
 * declines it. Finished tickets hide the control and make the chat read-only.
 */
export default function TicketChat({ ticket, me, onChanged, showMessage }) {
  const [messages, setMessages] = useState([]);
  const [requests, setRequests] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef(null);

  const isOwner = ticket.created_by === me.userId;
  const closed = CLOSED_STATUSES.includes(ticket.status);
  const pending = requests.find((request) => request.status === "Pending");
  const lastDeclined = !pending && requests[0]?.status === "Rejected" ? requests[0] : null;

  const load = useCallback(
    () =>
      Promise.all([
        api.getTicketMessages(ticket.id, me.userId),
        api.getTicketCancellations(ticket.id, me.userId),
      ])
        .then(([rows, cancellations]) => {
          setMessages((prev) =>
            prev.length === rows.length && prev.at(-1)?.id === rows.at(-1)?.id ? prev : rows,
          );
          setRequests(cancellations);
        })
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

  async function submitRequest(event) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await api.requestCancellation(ticket.id, { userId: me.userId, reason: trimmed });
      setDialogOpen(false);
      setReason("");
      await load();
      showMessage(
        "Request sent",
        "An admin will review your cancellation request. You will be notified of the decision.",
      );
    } catch (error) {
      setDialogOpen(false);
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
        {isOwner && !closed && (
          <button
            type="button"
            className="table-button danger"
            disabled={Boolean(pending)}
            onClick={() => setDialogOpen(true)}
          >
            {pending ? "Awaiting admin decision" : "Request cancellation"}
          </button>
        )}
      </div>
      {isOwner && lastDeclined && !closed && (
        <p className="ticket-chat-note">
          Your last cancellation request was declined
          {lastDeclined.reviewNote ? `: ${lastDeclined.reviewNote}` : "."}
        </p>
      )}

      <div className="ticket-chat-messages" ref={scroller}>
        {messages.length === 0 && (
          <p className="chat-empty">
            No messages yet. Use this space to talk about {ticket.id} with the other side.
          </p>
        )}
        {messages.map((message, index) => {
          if (message.kind === "cancellation_decision") {
            return (
              <div className="chat-system" key={message.id}>
                {message.text}
                <time>{formatTime(message.createdAt)}</time>
              </div>
            );
          }
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

      {dialogOpen && (
        <div className="modal-backdrop" onClick={() => setDialogOpen(false)}>
          <form
            className="modal-box"
            onClick={(event) => event.stopPropagation()}
            onSubmit={submitRequest}
          >
            <div className="modal-icon warn-icon">!</div>
            <h3>Request cancellation</h3>
            <p>
              <strong>{ticket.id}</strong> will stay open until an admin accepts your request.
              Tell them why you want it cancelled.
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
                onClick={() => setDialogOpen(false)}
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
