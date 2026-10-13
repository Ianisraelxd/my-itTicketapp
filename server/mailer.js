// Email (and optional SMS) alerts for the events people should not miss: an agent is assigned,
// a ticket is urgent, the requester's problem is resolved.
//
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE=true|false, MAIL_FROM   real email
//   MAIL_MODE=log                                                                    print instead of sending (testing)
//   SMS_WEBHOOK_URL                                                                  POST {to, message} to your SMS provider
//   APP_URL                                                                          link used in the emails
//
// With nothing configured alerts are simply off: the in-app notifications keep working.
import nodemailer from "nodemailer";

import { query } from "./db.js";

const env = () => process.env;

// Which notification types are worth an email, and which are urgent enough for a text message.
export const EMAIL_TYPES = new Set(["assigned", "reassigned", "urgent_ticket", "bot_urgent", "bot_handoff", "resolved"]);
export const SMS_TYPES = new Set(["assigned", "reassigned", "urgent_ticket", "bot_urgent"]);

export function mailMode() {
  if (env().MAIL_MODE === "log") return "log";
  return env().SMTP_HOST ? "smtp" : "off";
}

let transport = null;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env().SMTP_HOST,
      port: Number(env().SMTP_PORT) || 587,
      secure: env().SMTP_SECURE === "true",
      auth: env().SMTP_USER ? { user: env().SMTP_USER, pass: env().SMTP_PASS } : undefined,
    });
  }
  return transport;
}

/** The email for one notification (pure, so it can be unit tested). */
export function buildAlertMail({ title, body, ticketCode }, appUrl = env().APP_URL || "http://localhost:3001") {
  const subject = `[HelpDesk] ${title}${ticketCode ? ` (${ticketCode})` : ""}`;
  const text = `${title}\n\n${body}\n\n${ticketCode ? `Ticket: ${ticketCode}\n` : ""}Open HelpDesk: ${appUrl}\n\nYou get this because email alerts are on for your account.`;
  const escape = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px"><h2 style="color:#104c3d">${escape(title)}</h2><p>${escape(body)}</p>${
    ticketCode ? `<p><b>Ticket:</b> ${escape(ticketCode)}</p>` : ""
  }<p><a href="${escape(appUrl)}" style="background:#1c6b56;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open HelpDesk</a></p><p style="color:#777;font-size:12px">You get this because email alerts are on for your account.</p></div>`;
  return { subject, text, html };
}

async function record(userId, to, subject, status, detail = null) {
  try {
    await query("INSERT INTO email_log (user_pk, to_email, subject, status, detail) VALUES (?, ?, ?, ?, ?)", [userId, to, subject, status, detail ? String(detail).slice(0, 300) : null]);
  } catch {
    // the log is a convenience only
  }
}

async function sendText(phone, message, ticketCode) {
  const url = env().SMS_WEBHOOK_URL;
  if (!url || !phone) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: phone, message, ticket: ticketCode }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    console.error("SMS webhook failed:", error.message);
  }
}

/** Sends the alert to every person on the list who has an email and has not switched alerts off. */
export async function alertUsers(userIds, payload) {
  const mode = mailMode();
  const smsOn = Boolean(env().SMS_WEBHOOK_URL);
  if ((mode === "off" && !smsOn) || (!EMAIL_TYPES.has(payload.type) && !SMS_TYPES.has(payload.type))) return;
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return;

  const people = await query(
    `SELECT user_pk, name, email, phone FROM users WHERE user_pk IN (${ids.map(() => "?").join(", ")}) AND email_alerts = 1 AND role <> 'bot'`,
    ids,
  );
  for (const person of people) {
    if (EMAIL_TYPES.has(payload.type) && person.email && mode !== "off") {
      const mail = buildAlertMail(payload);
      try {
        if (mode === "log") console.log(`[mail:log] to ${person.email} | ${mail.subject}`);
        else await getTransport().sendMail({ from: env().MAIL_FROM || "HelpDesk <no-reply@helpdesk.local>", to: person.email, ...mail });
        await record(person.user_pk, person.email, mail.subject, mode === "log" ? "logged" : "sent");
      } catch (error) {
        await record(person.user_pk, person.email, mail.subject, "failed", error.message);
        console.error("email failed:", error.message);
      }
    }
    if (SMS_TYPES.has(payload.type) && person.phone) await sendText(person.phone, `${payload.title}: ${payload.body}`.slice(0, 300), payload.ticketCode);
  }
}
