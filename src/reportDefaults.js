// Local calendar date as YYYY-MM-DD (toISOString would shift it to UTC).
export function toISODate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Sensible defaults so the Report Manager is never empty on open:
// the last 30 days, every category, every requester role.
export function defaultReportFilters() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);
  return { from: toISODate(start), to: toISODate(end), category: "All", role: "All" };
}
