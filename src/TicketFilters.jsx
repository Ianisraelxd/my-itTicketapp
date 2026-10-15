import { useMemo, useState } from "react";

export const STATUS_FILTERS = ["Open", "In Progress", "Resolved", "Cancelled"];

const emptyFilters = { search: "", status: "all", category: "all", from: "", to: "" };

function localDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function matchesFilters(ticket, filters) {
  const text = filters.search.trim().toLowerCase();
  if (text) {
    const haystack = [ticket.id, ticket.subject, ticket.description, ticket.userName, ticket.assignedName, ticket.location]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(text)) return false;
  }
  if (filters.status !== "all" && ticket.status !== filters.status) return false;
  if (filters.category !== "all" && ticket.category !== filters.category) return false;
  if (filters.from || filters.to) {
    const day = localDay(ticket.createdAt);
    if (!day) return false;
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
  }
  return true;
}

/** Holds the filter state and returns the matching tickets plus the controls to show above a table. */
export default function useTicketFilters(tickets, categories) {
  const [filters, setFilters] = useState(emptyFilters);
  const visible = useMemo(() => tickets.filter((ticket) => matchesFilters(ticket, filters)), [tickets, filters]);
  const active = JSON.stringify(filters) !== JSON.stringify(emptyFilters);
  const set = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value }));

  const controls = (
    <section className="panel report-filters ticket-filters">
      <label>
        Search
        <input
          type="search"
          value={filters.search}
          onChange={set("search")}
          placeholder="Code, subject, description or name"
        />
      </label>
      <label>
        Status
        <select value={filters.status} onChange={set("status")}>
          <option value="all">All statuses</option>
          {STATUS_FILTERS.map((status) => <option key={status}>{status}</option>)}
        </select>
      </label>
      <label>
        Category
        <select value={filters.category} onChange={set("category")}>
          <option value="all">All categories</option>
          {categories.map((category) => <option key={category}>{category}</option>)}
        </select>
      </label>
      <label>
        From
        <input type="date" value={filters.from} max={filters.to || undefined} onChange={set("from")} />
      </label>
      <label>
        To
        <input type="date" value={filters.to} min={filters.from || undefined} onChange={set("to")} />
      </label>
      <span className="filter-count">{visible.length} of {tickets.length} tickets</span>
      {active && (
        <button type="button" className="button" onClick={() => setFilters(emptyFilters)}>
          Clear filters
        </button>
      )}
    </section>
  );

  return { visible, controls, active };
}
