// Tiny CSV helpers (no dependency). Used by the Report Manager export.

// Cells that start with these characters can be run as formulas by Excel, so
// text cells get a leading apostrophe. Numbers are left alone.
const FORMULA_START = /^[=+\-@\t\r]/;

function escapeCell(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

// Triggers a browser download. The BOM makes Excel read the file as UTF-8.
export function downloadCsv(filename, rows) {
  const blob = new Blob([`﻿${toCsv(rows)}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Flattens the report JSON into one tidy table: Report, Label, Value.
export function reportToCsvRows(report) {
  const rows = [["Report", "Label", "Value"]];
  const { filters, totals } = report;
  rows.push(["Filters", "From", filters.from || "All time"]);
  rows.push(["Filters", "To", filters.to || "Today"]);
  rows.push(["Filters", "Category", filters.category]);
  rows.push(["Filters", "Requester role", filters.role]);
  rows.push(["Summary", "Total tickets", totals.total]);
  rows.push(["Summary", "Resolved", totals.resolved]);
  rows.push(["Summary", "Open backlog", totals.backlog]);
  rows.push(["Summary", "Cancelled", totals.cancelled]);
  rows.push(["Summary", "High priority", totals.high]);
  const sections = [
    ["Tickets by status", report.byStatus],
    ["Tickets by category", report.byCategory],
    ["Tickets by priority", report.byPriority],
    ["Tickets by requester role", report.byRole],
    ["Tickets per day", report.byDay],
    ["Tickets by location", report.byLocation],
    ["Registered users by role", report.usersByRole],
  ];
  sections.forEach(([name, items]) => {
    items.forEach((item) => rows.push([name, item.label, item.value]));
  });
  return rows;
}
