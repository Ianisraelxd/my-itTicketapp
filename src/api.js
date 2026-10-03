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

  getProfile: (userId) =>
    request(`/profile/${encodeURIComponent(userId)}`),

  getPasswordRequests: (params = {}) => {
    const query = new URLSearchParams();
    if (params.userId) query.set("userId", String(params.userId));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return request(`/password-requests${suffix}`);
  },

  requestPasswordChange: (payload) =>
    request("/password-requests", { method: "POST", body: JSON.stringify(payload) }),

  resolvePasswordRequest: (code, payload) =>
    request(`/password-requests/${encodeURIComponent(code)}/status`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  setTechnicianSkills: (userId, payload) =>
    request(`/users/${encodeURIComponent(userId)}/skills`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  getChatContacts: (userId) =>
    request(`/messages/contacts?userId=${encodeURIComponent(userId)}`),

  getConversation: (userId, withId) =>
    request(
      `/messages?userId=${encodeURIComponent(userId)}&withId=${encodeURIComponent(withId)}`,
    ),

  sendMessage: (message) =>
    request("/messages", { method: "POST", body: JSON.stringify(message) }),
};
