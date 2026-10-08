// Thin client for the HelpDesk API. Requests go to /api/* which Vite proxies
// to the Express backend in development (see vite.config.js).

// --- Session token ----------------------------------------------------------
// The server issues a JWT at login. It lives in sessionStorage (per tab, gone
// when the tab closes) so a page refresh keeps you signed in.
const SESSION_KEY = "helpdesk-session";
let authToken = null;
try {
  authToken = sessionStorage.getItem(SESSION_KEY);
} catch {
  authToken = null;
}
let onUnauthorized = null;

export function setAuthToken(token) {
  authToken = token || null;
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked: the session just will not survive a refresh.
  }
}
export const hasAuthToken = () => Boolean(authToken);
// Called when the server says the session is no longer valid (expired, revoked).
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

function authHeaders(extra = {}) {
  return { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...extra };
}

async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: authHeaders({ "Content-Type": "application/json", ...(options.headers || {}) }),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && authToken && !path.startsWith("/login")) {
    onUnauthorized?.();
  }
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

// Downloads a protected file (the browser cannot attach the token to a plain link).
async function download(path, fallbackName) {
  const response = await fetch(`/api${path}`, { headers: authHeaders() });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Download failed (${response.status})`);
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] || fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  login: (credentials) =>
    request("/login", { method: "POST", body: JSON.stringify(credentials) }),

  loginMfa: (payload) =>
    request("/login/mfa", { method: "POST", body: JSON.stringify(payload) }),

  me: () => request("/me"),

  mfaSetup: () => request("/mfa/setup", { method: "POST", body: "{}" }),
  mfaEnable: (code) => request("/mfa/enable", { method: "POST", body: JSON.stringify({ code }) }),
  mfaDisable: (code) => request("/mfa/disable", { method: "POST", body: JSON.stringify({ code }) }),

  // Super admin governance
  getGovernanceOverview: () => request("/superadmin/overview"),
  previewArchive: (before) =>
    request("/superadmin/archive", { method: "POST", body: JSON.stringify({ before, dryRun: true }) }),
  runArchive: (before) =>
    request("/superadmin/archive", { method: "POST", body: JSON.stringify({ before, confirm: true }) }),
  getArchiveRuns: () => request("/superadmin/archive/runs"),
  downloadArchive: (runId, format) =>
    download(`/superadmin/archive/runs/${runId}/download?format=${format}`, `archive-${runId}.${format}`),
  getPrivilegedAccounts: () => request("/superadmin/admins"),
  manageAccount: (userId, action) =>
    request(`/superadmin/manage-admins/${encodeURIComponent(userId)}`, {
      method: "PUT",
      body: JSON.stringify({ action }),
    }),

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

  updateTicketStatus: (ticketId, status, actorId) =>
    request(`/tickets/${encodeURIComponent(ticketId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, actorId }),
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

  setUserRole: (userId, payload) =>
    request(`/users/${encodeURIComponent(userId)}/role`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  assignTicket: (ticketId, payload) =>
    request(`/tickets/${encodeURIComponent(ticketId)}/assign`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  requestCancellation: (ticketId, payload) =>
    request(`/tickets/${encodeURIComponent(ticketId)}/cancellation-requests`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getTicketCancellations: (ticketId, userId) =>
    request(
      `/tickets/${encodeURIComponent(ticketId)}/cancellation-requests?userId=${encodeURIComponent(userId)}`,
    ),

  getCancellationRequests: (userId) =>
    request(`/cancellation-requests?userId=${encodeURIComponent(userId)}`),

  reviewCancellation: (code, payload) =>
    request(`/cancellation-requests/${encodeURIComponent(code)}/status`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  getReportSummary: ({ userId, from, to, category, role }) => {
    const query = new URLSearchParams({ userId: String(userId) });
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (category && category !== "All") query.set("category", category);
    if (role && role !== "All") query.set("role", role);
    return request(`/reports/summary?${query.toString()}`);
  },

  getKpi: (userId, month) =>
    request(`/kpi?userId=${encodeURIComponent(userId)}&month=${encodeURIComponent(month)}`),

  getKpiTrend: (userId, month, count = 6) =>
    request(
      `/kpi/trend?userId=${encodeURIComponent(userId)}&month=${encodeURIComponent(month)}&count=${count}`,
    ),

  saveKpiSelection: (payload) =>
    request("/kpi/selection", { method: "PUT", body: JSON.stringify(payload) }),

  getNotifications: (userId) =>
    request(`/notifications?userId=${encodeURIComponent(userId)}`),

  markNotificationsRead: (userId, ids) =>
    request("/notifications/read", {
      method: "POST",
      body: JSON.stringify({ userId, ids }),
    }),

  reopenTicket: (ticketId, payload) =>
    request(`/tickets/${encodeURIComponent(ticketId)}/reopen`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getTicketParticipants: (ticketId, userId) =>
    request(
      `/tickets/${encodeURIComponent(ticketId)}/participants?userId=${encodeURIComponent(userId)}`,
    ),

  getTicketMessages: (ticketId, userId) =>
    request(
      `/tickets/${encodeURIComponent(ticketId)}/messages?userId=${encodeURIComponent(userId)}`,
    ),

  sendTicketMessage: (ticketId, payload) =>
    request(`/tickets/${encodeURIComponent(ticketId)}/messages`, {
      method: "POST",
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
