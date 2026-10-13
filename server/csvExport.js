// The spreadsheet that comes with every archive run: one tidy row per ticket, readable column names,
// people's names instead of ID numbers, dates as "2026-10-13 14:05". It opens correctly in Excel
// (UTF-8 with a byte-order mark, Windows line endings) and cannot run formulas hidden in ticket text.

const pad = (n) => String(n).padStart(2, "0");

export function formatDateTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** One CSV cell: quoted, quotes doubled, and a leading = + - @ made harmless. */
export function csvCell(value) {
  if (value === null || value === undefined) return '""';
  let text = String(value).replace(/\r\n|\r|\n/g, " ").trim();
  if (/^[=+\-@\t]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const COLUMNS = [
  ["Ticket", (t) => t.code],
  ["Subject", (t) => t.subject],
  ["Category", (t) => t.category],
  ["Priority tier", (t) => t.priority_tier],
  ["Priority", (t) => t.priority],
  ["Status", (t) => t.status],
  ["Requester", (t, c) => c.person(t.created_by)?.name],
  ["Requester type", (t, c) => c.person(t.created_by)?.roleName],
  ["Assigned agent", (t, c) => c.person(t.assigned_to)?.name],
  ["Location", (t) => t.location],
  ["Who is affected", (t) => t.impact_level],
  ["How soon", (t) => t.urgency_level],
  ["Submitted", (t) => formatDateTime(t.created_at)],
  ["Assigned", (t) => formatDateTime(t.assigned_at)],
  ["First response", (t) => formatDateTime(t.first_response_at)],
  ["Resolved", (t) => formatDateTime(t.resolved_at)],
  ["Closed for good", (t) => formatDateTime(t.closed_at)],
  ["Minutes to resolve", (t) => (t.resolved_at && t.created_at ? Math.max(0, Math.round((new Date(t.resolved_at) - new Date(t.created_at)) / 60000)) : "")],
  ["Times reopened", (t) => t.reopen_count],
  ["Automatic assignments", (t) => t.auto_assign_count],
  ["Satisfaction (1-5)", (t) => t.csat_rating],
  ["Messages in the conversation", (t, c) => c.messageCount(t.ticket_pk)],
  ["Description", (t) => t.description],
];

/**
 * @param {object[]} tickets rows from the tickets table
 * @param {{people?: Map<number, {name: string, roleName: string}>, messageCounts?: Map<number, number>}} lookups
 */
export function ticketsToCsv(tickets, { people = new Map(), messageCounts = new Map() } = {}) {
  const context = { person: (id) => people.get(id), messageCount: (pk) => messageCounts.get(pk) ?? 0 };
  const lines = [COLUMNS.map(([name]) => csvCell(name)).join(",")];
  for (const ticket of tickets) lines.push(COLUMNS.map(([, read]) => csvCell(read(ticket, context))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
