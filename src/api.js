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

  signup: (account) =>
    request("/signup", { method: "POST", body: JSON.stringify(account) }),

  getTickets: (params = {}) => {
    const query = new URLSearchParams();
    if (params.mine && params.userId) {
      query.set("mine", "1");
      query.set("userId", String(params.userId));
    }
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return request(`/tickets${suffix}`);
  },

  createTicket: (ticket) =>
    request("/tickets", { method: "POST", body: JSON.stringify(ticket) }),

  updateTicketStatus: (ticketId, status) =>
    request(`/tickets/${encodeURIComponent(ticketId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  getActivities: () => request("/activities"),

  addActivity: (activity) =>
    request("/activities", { method: "POST", body: JSON.stringify(activity) }),

  getUsers: () => request("/users"),
};
