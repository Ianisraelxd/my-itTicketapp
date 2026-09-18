// Thin client for the HelpDesk API. Requests go to /api/* which Vite proxies
// to the Express backend in development (see vite.config.js).

async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

export const api = {
  login: (credentials) =>
    request("/login", { method: "POST", body: JSON.stringify(credentials) }),

  getTickets: () => request("/tickets"),

  createTicket: (ticket) =>
    request("/tickets", { method: "POST", body: JSON.stringify(ticket) }),

  getActivities: () => request("/activities"),

  addActivity: (activity) =>
    request("/activities", { method: "POST", body: JSON.stringify(activity) }),

  getUsers: () => request("/users"),
};
