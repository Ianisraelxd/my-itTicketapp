import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";
import ChatInput from "./ChatInput";
import { playSound } from "./sounds";

const CLOSED_STATUSES = ["Resolved", "Done", "Closed", "Cancelled"];
const MAX_REOPENS = 3;

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
  const [participants, setParticipants] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenSure, setReopenSure] = useState(false);
  const scroller = useRef(null);
  const lastSeenId = useRef(null);

  const isOwner = ticket.created_by === me.userId;
  const closed = CLOSED_STATUSES.includes(ticket.status);
  const reopensLeft = MAX_REOPENS - Number(ticket.reopenCount || 0);
  const canReopen = isOwner && ticket.status === "Resolved";
  const pending = requests.find((request) => request.status === "Pending");
  const lastDeclined = !pending && requests[0]?.status === "Rejected" ? requests[0] : null;

  const load = useCallback(
    () =>
      Promise.all([
        api.getTicketMessages(ticket.id, me.userId),
        api.getTicketCancellations(ticket.id, me.userId),
        api.getTicketParticipants(ticket.id, me.userId),
      ])
        .then(([rows, cancellations, people]) => {
          setParticipants(people);
          const newest = rows.at(-1);
          if (
            lastSeenId.current !== null &&
            newest &&
            newest.id !== lastSeenId.current &&
            newest.senderId !== me.userId
          ) {
            playSound("received");
          }
          lastSeenId.current = newest ? newest.id : 0;
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
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending || closed) return;
    setSending(true);
    try {
      await api.sendTicketMessage(ticket.id, { userId: me.userId, text });
      playSound("sent");
      setDraft("");
      await load();
    } catch (error) {
      showMessage("Could not send message", error.message || "Please try again.");
      onChanged();
    } finally {
      setSending(false);
    }
  }

  async function submitReopen(event) {
    event.preventDefault();
    const trimmed = reopenReason.trim();
    if (!trimmed || !reopenSure) return;
    setBusy(true);
    try {
      await api.reopenTicket(ticket.id, { userId: me.userId, reason: trimmed });
      setReopenOpen(false);
      setReopenReason("");
      setReopenSure(false);
      await load();
      showMessage(
        "Ticket reopened",
        "Your technician and the admins were notified that the problem is still happening.",
      );
    } catch (error) {
      setReopenOpen(false);
      showMessage("Could not reopen", error.message || "Please try again.");
    } finally {
      setBusy(false);
      onChanged();
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
        {canReopen && (
          <button
            type="button"
            className="table-button warn"
            disabled={reopensLeft <= 0}
            title={reopensLeft <= 0 ? "Reopen limit reached" : undefined}
            onClick={() => setReopenOpen(true)}
          >
            {reopensLeft <= 0 ? "Reopen limit reached" : "Problem not fixed? Reopen"}
          </button>
        )}
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
      {!isOwner && participants.length > 0 && (
        <div className="ticket-people" aria-label="People in this conversation">
          {participants.map((person) => (
            <span
              key={person.userId}
              className={`person person-${person.part.toLowerCase()}`}
              title={`${person.name} · ${person.roleName}`}
            >
              <b>{person.userId === me.userId ? "You" : person.name}</b>
              <small>{person.part}</small>
            </span>
          ))}
        </div>
      )}
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
                message.kind === "cancellation_request" || message.kind === "reopen" ? "cancel-request" : ""
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
                {message.kind === "reopen" && <em className="chat-flag">Ticket reopened</em>}
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
          {canReopen && reopensLeft > 0 && " Still broken? Use Reopen above."}
        </p>
      ) : (
        <form className="chat-compose" onSubmit={send}>
          <ChatInput
            value={draft}
            onChange={setDraft}
            onSend={() => send()}
            placeholder="Write a message…"
          />
          <button type="submit" disabled={!draft.trim() || sending} aria-label="Send">
            ➤
          </button>
        </form>
      )}

      {reopenOpen && (
        <div className="modal-backdrop" onClick={() => setReopenOpen(false)}>
          <form
            className="modal-box"
            onClick={(event) => event.stopPropagation()}
            onSubmit={submitReopen}
          >
            <div className="modal-icon warn-icon">!</div>
            <h3>Reopen this ticket?</h3>
            <div className="reopen-warning" role="alert">
              <strong>Please read before you continue</strong>
              <ul>
                <li>Only reopen if the <b>same problem</b> is still happening.</li>
                <li>
                  If it is a <b>new or different</b> problem, submit a new request instead.
                </li>
                <li>
                  The technician and the admins will be notified right away, and the ticket goes back
                  to work.
                </li>
                <li>
                  You can reopen a ticket {MAX_REOPENS} times at most ({reopensLeft} left).
                </li>
              </ul>
            </div>
            <label className="field-label dialog-note">
              What is still wrong?
              <textarea
                value={reopenReason}
                onChange={(event) => setReopenReason(event.target.value)}
                placeholder="Example: The projector still shuts off after a few minutes."
                maxLength={500}
                required
                autoFocus
              />
            </label>
            <label className="reopen-confirm">
              <input
                type="checkbox"
                checked={reopenSure}
                onChange={(event) => setReopenSure(event.target.checked)}
              />
              <span>I confirm this is the same problem that was marked as fixed.</span>
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="button button-outline"
                disabled={busy}
                onClick={() => setReopenOpen(false)}
              >
                Back
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={busy || !reopenReason.trim() || !reopenSure}
              >
                Reopen ticket
              </button>
            </div>
          </form>
        </div>
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
const TRACK_STEPS = ["Submitted", "In progress", "Resolved"];

function ProgressTrack({ ticket }) {
  if (ticket.status === "Cancelled") {
    return <p className="progress-note progress-cancelled">This ticket was cancelled.</p>;
  }
  const stage = ticket.status === "Resolved" ? 2 : ticket.status === "In Progress" ? 1 : 0;
  const details = [
    "We received your request",
    ticket.assignedName ? `${ticket.assignedName} is handling it` : "Waiting for a technician",
    "The problem is fixed",
  ];
  return (
    <>
      <ol className="progress-track" aria-label="Ticket progress">
        {TRACK_STEPS.map((label, index) => (
          <li
            key={label}
            className={index < stage || (index === stage && stage === 2) ? "done" : index === stage ? "current" : ""}
          >
            <span className="progress-dot">{index < stage || (index === stage && stage === 2) ? "✓" : index + 1}</span>
            <b>{label}</b>
            <small>{index === stage ? details[index] : ""}</small>
          </li>
        ))}
      </ol>
      {Number(ticket.reopenCount) > 0 && (
        <p className="progress-note">
          Reopened {ticket.reopenCount} time{Number(ticket.reopenCount) === 1 ? "" : "s"} because the problem
          was still happening.
        </p>
      )}
      {Number(ticket.cancelPending) > 0 && (
        <p className="progress-note">Cancellation requested. Waiting for an admin to decide.</p>
      )}
    </>
  );
}

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
          <ProgressTrack ticket={ticket} />
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
