import "./App.css";

import { useCallback, useEffect, useRef, useState } from "react";

import { api, hasAuthToken, setAuthToken, setUnauthorizedHandler } from "./api";
import MfaSettings from "./MfaSettings";
import SuperAdminPanel from "./SuperAdminPanel";
import ChartSkeleton from "./ChartSkeleton";
import ChatInput from "./ChatInput";
import { downloadCsv, reportToCsvRows } from "./csv";
import { buildKpiCards, formatKpiValue, monthKey, monthLabel } from "./kpiFormat";
import KpiScorecard, { KpiPicker, KpiScorecardView } from "./KpiScorecard";
import KpiTrendCard from "./KpiTrendCard";
import useKpiData from "./useKpiData";
import useKpiTrend from "./useKpiTrend";
import ReportChartContainer from "./ReportChartContainer";
import ReportFilters from "./ReportFilters";
import { defaultReportFilters } from "./reportDefaults";
import useReportData from "./useReportData";
import { SettingsModal } from "./SettingsModal";
import { APP_VERSION, motionAllowed } from "./settings";
import { playSound } from "./sounds";
import { TicketDetailsModal } from "./TicketChat";

const navFor = {
  user: [
    ["userDashboard", "◈", "Dashboard"],
    ["requestPage", "+", "Submit Request"],
    ["myRequestsPage", "▤", "My Requests"],
    ["notificationsPage", "🔔", "Notifications"],
  ],
  technician: [
    ["technicianDashboard", "◈", "Dashboard"],
    ["technicianRequestsPage", "▤", "Assigned Requests"],
    ["notificationsPage", "🔔", "Notifications"],
  ],
  admin: [
    ["adminDashboard", "◈", "Dashboard"],
    ["manageRequestsPage", "▤", "Manage Requests"],
    ["passwordRequestsPage", "🔑", "Password Requests"],
    ["usersPage", "♙", "Users"],
    ["notificationsPage", "🔔", "Notifications"],
  ],
  superadmin: [
    ["superAdminDashboard", "◈", "Dashboard"],
    ["reportManagerPage", "▥", "Report Manager"],
    ["activityLogPage", "◷", "Activity Log Reports"],
    ["superAdminPanel", "🛡", "Super Admin Panel"],
  ],
  // Read-only: the same dashboards and reports as the super admin, nothing that changes data.
  report_viewer: [
    ["superAdminDashboard", "◈", "Dashboard"],
    ["reportManagerPage", "▥", "Report Manager"],
    ["activityLogPage", "◷", "Activity Log Reports"],
  ],
};

const MFA_ROLES = ["technician", "admin", "superadmin", "report_viewer"];

function landingFor(role) {
  if (role === "superadmin" || role === "report_viewer") return "superAdminDashboard";
  if (role === "admin") return "adminDashboard";
  if (role === "technician") return "technicianDashboard";
  return "userDashboard";
}

const PAGE_KEY = "helpdesk-page";

// Technician + progress shown in the ticket tables. Derived from the ticket
// itself (status, assigned technician, pending cancellation) so every role sees
// the same thing; the browser-only assignment record is just a fallback name.
function ticketTracking(ticket, assignment = {}) {
  const assignedTechnician = ticket.assignedName || assignment.assignedTechnician || "";
  let progress;
  if (ticket.status === "Cancelled") progress = "Cancelled";
  else if (ticket.status === "Resolved") progress = "Resolved";
  else if (Number(ticket.cancelPending) > 0) progress = "Cancellation requested";
  else if (ticket.status === "In Progress") progress = assignedTechnician ? "Technician working on it" : "In progress";
  else progress = "Waiting for a technician";
  if (Number(ticket.reopenCount) > 0 && !["Resolved", "Cancelled"].includes(ticket.status)) {
    progress = `Reopened: ${progress.charAt(0).toLowerCase()}${progress.slice(1)}`;
  }
  return { assignedTechnician, progress };
}

// Ticket categories. Technician skills are drawn from the same list (minus
// "Others"), which is how requests get matched to the right technician.
const SKILL_OPTIONS = [
  "Hardware",
  "Software",
  "Network / Internet",
  "Account / Login",
  "Printer",
];
const CATEGORY_OPTIONS = [...SKILL_OPTIONS, "Others"];

// How well a ticket fits a technician's skills:
// "match" = recommended, "mismatch" = outside their skills, "neutral" = no skills
// assigned yet or a general ("Others") request.
function skillFit(skills = [], category) {
  if (!skills.length || !SKILL_OPTIONS.includes(category)) return "neutral";
  return skills.includes(category) ? "match" : "mismatch";
}

const ASSIGNMENT_STORAGE_KEY = "helpdesk-ticket-assignments-v1";

function readTicketAssignments() {
  try {
    const raw = localStorage.getItem(ASSIGNMENT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function App() {
  const [authPage, setAuthPage] = useState("login");
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("userDashboard");
  const [credentials, setCredentials] = useState({
    id: "",
    password: "",
    role: "student",
  });
  const [mfaChallenge, setMfaChallenge] = useState(null); // { token } while the code step is showing
  const [mfaCode, setMfaCode] = useState("");
  const [signupForm, setSignupForm] = useState({
    fullName: "",
    id: "",
    email: "",
    userType: "Student",
    password: "",
  });
  const [forgotEmail, setForgotEmail] = useState("");
  const [tickets, setTickets] = useState([]);
  const [allTickets, setAllTickets] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [ticketAssignments, setTicketAssignments] = useState(() => readTicketAssignments());
  const [refreshKey, setRefreshKey] = useState(0);
  const [notifications, setNotifications] = useState({ unread: 0, items: [] });
  const [toasts, setToasts] = useState([]);
  const seenNotifications = useRef(null);
  const [modal, setModal] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileView, setProfileView] = useState("details");
  const [profile, setProfile] = useState(null);
  const [myPwRequests, setMyPwRequests] = useState([]);
  const [pwRequests, setPwRequests] = useState([]);
  const [pwForm, setPwForm] = useState({ newPassword: "", confirm: "", reason: "" });
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [request, setRequest] = useState({
    category: "",
    priority: "Medium",
    subject: "",
    location: "",
    description: "",
  });

  const roleType = ["superadmin", "admin", "technician", "report_viewer"].includes(user?.role)
    ? user.role
    : "user";
  const canEdit = user?.role === "superadmin";
  const latestPwRequest = myPwRequests[0] || null;
  const addActivity = (activity) => {
    // Optimistically show it, then persist to the database.
    setActivities((items) => [
      [new Date().toLocaleString(), user.name, user.roleName, activity],
      ...items,
    ]);
    api
      .addActivity({ name: user.name, roleName: user.roleName, action: activity })
      .catch(() => {});
  };
  const showMessage = (title, message) => setModal({ title, message });

  // After a page refresh: if a session token is still stored, ask the server who it belongs to.
  useEffect(() => {
    if (!hasAuthToken()) return;
    let active = true;
    api
      .me()
      .then((me) => {
        if (!active) return;
        setUser(me);
        let saved = null;
        try {
          saved = sessionStorage.getItem(PAGE_KEY);
        } catch {
          saved = null;
        }
        const allowed = (navFor[me.role] || navFor.user).map(([id]) => id);
        setPage(saved && allowed.includes(saved) ? saved : landingFor(me.role));
      })
      .catch(() => setAuthToken(null));
    return () => {
      active = false;
    };
  }, []);

  // Remember the current page so a refresh keeps you where you were.
  useEffect(() => {
    if (!user) return;
    try {
      sessionStorage.setItem(PAGE_KEY, page);
    } catch {
      // ignore
    }
  }, [user, page]);

  // The server says the session is over (expired or access revoked): go back to the login screen.
  const logoutRef = useRef(null);
  useEffect(() => {
    logoutRef.current = logout;
  });
  useEffect(() => {
    setUnauthorizedHandler(() => {
      logoutRef.current?.();
      setModal({ title: "Signed out", message: "Your session ended. Please sign in again." });
    });
  }, []);

  // Poll for notifications. Anything new pops up as a toast and refreshes the
  // ticket data so statuses stay current without a manual reload.
  useEffect(() => {
    if (!user || user.role === "superadmin" || user.role === "report_viewer") return;
    let active = true;
    seenNotifications.current = null;
    const load = () =>
      api
        .getNotifications(user.userId)
        .then((data) => {
          if (!active) return;
          setNotifications(data);
          const seen = seenNotifications.current;
          if (seen) {
            const fresh = data.items.filter((item) => !item.read && !seen.has(item.id));
            if (fresh.length > 0) {
              // Chat messages already have their own sound while a chat is open.
              playSound(fresh.every((item) => item.type === "message") ? "received" : "notification");
              setToasts((current) => [...fresh.slice(0, 3), ...current].slice(0, 4));
              setRefreshKey((value) => value + 1);
            }
          }
          seenNotifications.current = new Set(data.items.map((item) => item.id));
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 8000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user]);

  // Load tickets and activities from the database once a user is signed in.
  useEffect(() => {
    if (!user) return;
    let active = true;
    const isPrivateUser =
      user.role === "student" || user.role === "employee";
    const needsAdminData = ["technician", "admin", "superadmin", "report_viewer"].includes(user.role);
    const seesActivityLog = ["superadmin", "report_viewer"].includes(user.role);

    Promise.all([
      api.getTickets(isPrivateUser ? { mine: true, userId: user.userId } : {}),
      seesActivityLog ? api.getActivities() : Promise.resolve([]),
      ...(needsAdminData ? [api.getUsers()] : []),
    ])
      .then(([ticketRows, activityRows, userRows]) => {
        if (!active) return;
        setTickets(ticketRows);
        setAllTickets(ticketRows);
        if (userRows) setAllUsers(userRows);
        setActivities(activityRows);
      })
      .catch((error) =>
        showMessage("Could not load data", error.message || "Please try again."),
      );
    return () => {
      active = false;
    };
  }, [user, refreshKey]);

  const refreshData = () => setRefreshKey((value) => value + 1);

  // Load the signed-in account details when the profile panel opens.
  useEffect(() => {
    if (!user || !profileOpen) return;
    let active = true;
    api
      .getProfile(user.userId)
      .then((row) => active && setProfile(row))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user, profileOpen]);

  // Keep password change requests fresh so users see approval/rejection while
  // they wait, and admins see new requests without reloading the page.
  useEffect(() => {
    if (!user) return;
    let active = true;
    const canReview = ["admin", "superadmin"].includes(user.role);

    const load = () => {
      Promise.all([
        api.getPasswordRequests({ userId: user.userId }),
        canReview ? api.getPasswordRequests() : Promise.resolve(null),
      ])
        .then(([ownRows, allRows]) => {
          if (!active) return;
          setMyPwRequests(ownRows);
          if (allRows) setPwRequests(allRows);
        })
        .catch(() => {});
    };

    load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user, refreshKey]);

  useEffect(() => {
    localStorage.setItem(ASSIGNMENT_STORAGE_KEY, JSON.stringify(ticketAssignments));
  }, [ticketAssignments]);

  // Called once the server has accepted the sign-in (password, and code if required).
  function completeLogin(account) {
    const { token, ...profileFields } = account;
    setAuthToken(token);
    playSound("login");
    setUser(profileFields);
    refreshData();
    setPage(landingFor(account.role));
    setCredentials((current) => ({ ...current, password: "" }));
    setMfaChallenge(null);
    setMfaCode("");
  }

  async function login(event) {
    event.preventDefault();
    let result;
    try {
      result = await api.login(credentials);
    } catch (error) {
      showMessage(
        "Login failed",
        error.message || "Incorrect ID, password, or selected role.",
      );
      return;
    }
    if (result.mfaRequired) {
      setMfaChallenge({ token: result.mfaToken });
      setMfaCode("");
      return;
    }
    completeLogin(result);
  }

  async function submitMfa(event) {
    event.preventDefault();
    try {
      completeLogin(await api.loginMfa({ mfaToken: mfaChallenge.token, code: mfaCode }));
    } catch (error) {
      showMessage("Could not verify the code", error.message || "Please try again.");
      if (/expired|start/i.test(error.message || "")) setMfaChallenge(null);
    }
  }

  async function submitRequest(event) {
    event.preventDefault();
    if (!request.category) {
      showMessage(
        "Choose a category",
        "Please pick the type of problem (for example Hardware or Software) so the right technician can help.",
      );
      return;
    }
    if (
      !request.subject.trim() ||
      !request.location.trim() ||
      !request.description.trim()
    ) {
      showMessage(
        "Incomplete form",
        "Please complete the subject, location, and description.",
      );
      return;
    }
    let created;
    try {
      created = await api.createTicket({
        subject: request.subject,
        category: request.category,
        priority: request.priority,
        location: request.location,
        description: request.description,
        createdBy: user.userId,
      });
    } catch (error) {
      showMessage(
        "Could not submit",
        error.message || "Something went wrong saving your request.",
      );
      return;
    }
    setTickets((items) => [created, ...items]);
    refreshData();
    addActivity(`Submitted ${created.id}: ${created.subject}`);
    setRequest({
      category: "",
      priority: "Medium",
      subject: "",
      location: "",
      description: "",
    });
    showMessage("Request submitted", `${created.id} was created successfully.`);
  }

  function openProfile() {
    setProfileView("details");
    setProfileOpen(true);
  }

  async function submitPasswordChange(event) {
    event.preventDefault();
    if (pwForm.newPassword.length < 6) {
      showMessage("Password too short", "Use at least 6 characters for the new password.");
      return;
    }
    if (pwForm.newPassword !== pwForm.confirm) {
      showMessage("Passwords do not match", "Re-type the new password so both fields match.");
      return;
    }
    setPwSubmitting(true);
    try {
      const created = await api.requestPasswordChange({
        userId: user.userId,
        newPassword: pwForm.newPassword,
        reason: pwForm.reason,
      });
      setPwForm({ newPassword: "", confirm: "", reason: "" });
      setProfileView("details");
      refreshData();
      addActivity(`Filed ${created.id}: Password change request`);
      showMessage(
        "Request sent",
        `${created.id} was sent to the admin. Your profile will show whether it is accepted.`,
      );
    } catch (error) {
      showMessage("Could not submit request", error.message || "Please try again.");
    } finally {
      setPwSubmitting(false);
    }
  }

  function logout() {
    setAuthToken(null);
    try {
      sessionStorage.removeItem(PAGE_KEY);
    } catch {
      // ignore
    }
    setMfaChallenge(null);
    setMfaCode("");
    setUser(null);
    setAuthPage("login");
    setCredentials({ id: "", password: "", role: "student" });
    setProfileOpen(false);
    setProfileView("details");
    setProfile(null);
    setMyPwRequests([]);
    setPwRequests([]);
    setPwForm({ newPassword: "", confirm: "", reason: "" });
    setNotifications({ unread: 0, items: [] });
    setToasts([]);
  }

  async function markNotificationsRead(ids) {
    try {
      await api.markNotificationsRead(user.userId, ids || undefined);
    } catch {
      return;
    }
    setNotifications((current) => {
      const newlyRead = current.items.filter((item) => !item.read && (!ids || ids.includes(item.id))).length;
      return {
        unread: ids ? Math.max(0, current.unread - newlyRead) : 0,
        items: current.items.map((item) =>
          !ids || ids.includes(item.id) ? { ...item, read: true } : item,
        ),
      };
    });
  }

  // Tapping a notification marks it read and jumps to the page it is about.
  function openNotification(item) {
    markNotificationsRead([item.id]);
    setToasts((current) => current.filter((toast) => toast.id !== item.id));
    if (item.type.startsWith("password_")) {
      setPage(user.role === "admin" ? "passwordRequestsPage" : page);
      return;
    }
    if (user.role === "admin") setPage("manageRequestsPage");
    else if (user.role === "technician") setPage("technicianRequestsPage");
    else setPage("myRequestsPage");
  }

  const dismissToast = useCallback(
    (id) => setToasts((current) => current.filter((toast) => toast.id !== id)),
    [],
  );

  if (!user)
    return (
      <>
      <AuthScreen
        mfaChallenge={mfaChallenge}
        mfaCode={mfaCode}
        setMfaCode={setMfaCode}
        submitMfa={submitMfa}
        setMfaChallenge={setMfaChallenge}
        onOpenSettings={() => setSettingsOpen(true)}
        page={authPage}
        setPage={setAuthPage}
        credentials={credentials}
        setCredentials={setCredentials}
        signupForm={signupForm}
        setSignupForm={setSignupForm}
        forgotEmail={forgotEmail}
        setForgotEmail={setForgotEmail}
        login={login}
        showMessage={showMessage}
        modal={modal}
        setModal={setModal}
      />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </>
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">+</span>
          <span>
            Campus
            <br />
            <strong>HelpDesk</strong>
          </span>
        </div>
        <button
          type="button"
          className="sidebar-user"
          onClick={openProfile}
          title="View profile"
        >
          <span className="avatar">{user.name.charAt(0)}</span>
          <div>
            <strong>{user.name}</strong>
            <span>{user.roleName}</span>
          </div>
          <span className="profile-chevron" aria-hidden="true">›</span>
          {latestPwRequest?.status === "Pending" && (
            <span className="profile-dot" title="Password change request pending"></span>
          )}
        </button>
        <nav className="nav-list">
          {navFor[roleType].map(([id, icon, label]) => (
            <button
              className={page === id ? "active" : ""}
              key={id}
              onClick={() => setPage(id)}
            >
              <span>{icon}</span>
              {label}
              {id === "notificationsPage" && notifications.unread > 0 && (
                <b className="nav-badge">{notifications.unread}</b>
              )}
            </button>
          ))}
        </nav>
        <button className="logout-button settings-button" onClick={() => setSettingsOpen(true)}>
          <span>⚙</span>Settings
        </button>
        <button className="logout-button" onClick={logout}>
          <span>↪</span>Log out
        </button>
        <div className="sidebar-footer">
          HELPDESK {APP_VERSION}
          <br />
          <span>Support that keeps you moving.</span>
        </div>
      </aside>
      <main className="main-content">
        <header className="mobile-header">
          <span className="brand-mark">+</span>
          <strong>Campus HelpDesk</strong>
          <button className="mobile-profile" onClick={openProfile}>
            {user.name.split(" ")[0]} · {user.roleName} ›
          </button>
          <button
            className="mobile-settings"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙
          </button>
          <button className="mobile-logout" onClick={logout}>Log out</button>
        </header>
        <div className="page" key={page}>
        {page === "userDashboard" && (
          <UserDashboard
            setPage={setPage}
            tickets={tickets}
            ticketAssignments={ticketAssignments}
            userName={user.name}
          />
        )}
        {page === "requestPage" && (
          <RequestPage
            request={request}
            setRequest={setRequest}
            submitRequest={submitRequest}
          />
        )}
        {page === "myRequestsPage" && (
          <MyRequests
            tickets={tickets}
            ticketAssignments={ticketAssignments}
            setPage={setPage}
            me={user}
            refreshData={refreshData}
            showMessage={showMessage}
          />
        )}
        {page === "technicianDashboard" && (
          <TechnicianDashboard
            me={user}
            setPage={setPage}
            tickets={allTickets.length ? allTickets : tickets}
          />
        )}
        {page === "technicianRequestsPage" && (
          <TechnicianRequests
            me={user}
            mySkills={allUsers.find((item) => item.userId === user.userId)?.skills || []}
            tickets={allTickets.length ? allTickets : tickets}
            ticketAssignments={ticketAssignments}
            setTicketAssignments={setTicketAssignments}
            addActivity={addActivity}
            showMessage={showMessage}
            refreshData={refreshData}
          />
        )}
        {page === "adminDashboard" && (
          <AdminDashboard
            setPage={setPage}
            tickets={allTickets.length ? allTickets : tickets}
            users={allUsers}
          />
        )}
        {page === "superAdminDashboard" && (
          <SuperAdminDashboard
            canEdit={canEdit}
            me={user}
            showMessage={showMessage}
            setPage={setPage}
            tickets={allTickets.length ? allTickets : tickets}
            users={allUsers}
            activities={activities}
          />
        )}
        {page === "reportManagerPage" && (
          <ReportManager me={user} showMessage={showMessage} canEdit={canEdit} />
        )}
        {page === "superAdminPanel" && canEdit && (
          <>
            <PageHeader
              eyebrow="SYSTEM / 04"
              title="Super admin panel"
              description="Archiving and who can see or manage what. Daily reporting belongs to Report Viewers."
            />
            <SuperAdminPanel showMessage={showMessage} />
          </>
        )}
        {page === "manageRequestsPage" && (
          <ManageRequests
            me={user}
            tickets={allTickets.length ? allTickets : tickets}
            users={allUsers}
            ticketAssignments={ticketAssignments}
            setTicketAssignments={setTicketAssignments}
            showMessage={showMessage}
            refreshData={refreshData}
          />
        )}
        {page === "usersPage" && (
          <UsersPage currentUser={user} showMessage={showMessage} refreshData={refreshData} />
        )}
        {page === "passwordRequestsPage" && (
          <PasswordRequestsPage
            requests={pwRequests}
            currentUser={user}
            showMessage={showMessage}
            refreshData={refreshData}
          />
        )}
        {page === "activityLogPage" && <ActivityLog activities={activities} />}
        {page === "notificationsPage" && (
          <NotificationsPage
            data={notifications}
            onRead={markNotificationsRead}
            onOpen={openNotification}
          />
        )}
        </div>
      </main>
      {(user.role === "admin" || user.role === "technician") && (
        <ChatDock me={user} />
      )}
      <nav className="bottom-nav" aria-label="Main navigation">
        {navFor[roleType].map(([id, icon, label]) => (
          <button
            className={page === id ? "active" : ""}
            key={id}
            onClick={() => setPage(id)}
          >
            <span>{icon}</span>
            <small>{label}</small>
            {id === "notificationsPage" && notifications.unread > 0 && (
              <b className="nav-badge">{notifications.unread}</b>
            )}
          </button>
        ))}
      </nav>
      {profileOpen && (
        <ProfileModal
          user={user}
          profile={profile}
          view={profileView}
          setView={setProfileView}
          requests={myPwRequests}
          pwForm={pwForm}
          setPwForm={setPwForm}
          submitting={pwSubmitting}
          onSubmitRequest={submitPasswordChange}
          onProfileChanged={() => api.getProfile(user.userId).then(setProfile).catch(() => {})}
          showMessage={showMessage}
          onClose={() => setProfileOpen(false)}
          onLogout={logout}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <ToastStack toasts={toasts} onDismiss={dismissToast} onOpen={openNotification} />
      {modal && <Modal modal={modal} setModal={setModal} />}
    </div>
  );
}

function Modal({ modal, setModal }) {
  return (
    <div className="modal-backdrop" onClick={() => setModal(null)}>
      <div className="modal-box" onClick={(event) => event.stopPropagation()}>
        <div className="modal-icon">i</div>
        <h3>{modal.title}</h3>
        <p>{modal.message}</p>
        <button
          className="button button-primary"
          onClick={() => setModal(null)}
        >
          Okay
        </button>
      </div>
    </div>
  );
}
function AuthScreen({
  mfaChallenge,
  mfaCode,
  setMfaCode,
  submitMfa,
  setMfaChallenge,
  onOpenSettings,
  page,
  setPage,
  credentials,
  setCredentials,
  signupForm,
  setSignupForm,
  forgotEmail,
  setForgotEmail,
  login,
  showMessage,
  modal,
  setModal,
}) {
  const isSignup = page === "signup";
  const isForgot = page === "forgot";
  return (
    <div className="auth-page">
      <button
        type="button"
        className="auth-settings"
        aria-label="Settings"
        title="Settings"
        onClick={onOpenSettings}
      >
        ⚙
      </button>
      <div className="auth-visual">
        <div className="visual-grid"></div>
        <div className="visual-copy">
          <span className="eyebrow">CAMPUS IT SERVICES</span>
          <h1>
            Support that
            <br />
            <em>keeps you moving.</em>
          </h1>
          <p>
            One place to report, track, and resolve every technical concern
            across campus.
          </p>
          <div className="visual-meta">
            <span>◉ &nbsp; 24 / 7 SUPPORT</span>
            <span>⌁ &nbsp; CAMPUS-WIDE</span>
          </div>
        </div>
      </div>
      <div className="auth-panel">
        <div className="auth-panel-inner">
          <div className="auth-brand">
            <span className="brand-mark">+</span>
            <span>
              Campus
              <br />
              <strong>HelpDesk</strong>
            </span>
          </div>
          {page === "login" && mfaChallenge && (
            <>
              <AuthHeading
                title="Two-step verification"
                detail="Enter the 6-digit code from your authenticator app."
              />
              <form onSubmit={submitMfa}>
                <label className="field-label">
                  6-digit code
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.target.value)}
                    placeholder="123456"
                    autoFocus
                    required
                  />
                </label>
                <button
                  className="button button-primary full-width"
                  type="submit"
                  disabled={mfaCode.replace(/\s/g, "").length !== 6}
                >
                  Verify <span>→</span>
                </button>
              </form>
              <button type="button" className="text-button" onClick={() => setMfaChallenge(null)}>
                ← Back to sign in
              </button>
            </>
          )}
          {page === "login" && !mfaChallenge && (
            <>
              <AuthHeading
                title="Welcome back"
                detail="Sign in to access your support workspace."
              />
              <form onSubmit={login}>
                <Field
                  label="ID number"
                  type="text"
                  placeholder="e.g. 2404154"
                  value={credentials.id}
                  onChange={(value) =>
                    setCredentials({ ...credentials, id: value })
                  }
                />
                <PasswordField
                  label="Password"
                  placeholder="Enter your password"
                  value={credentials.password}
                  onChange={(value) =>
                    setCredentials({ ...credentials, password: value })
                  }
                />
                <label className="field-label">
                  Login as
                  <select
                    value={credentials.role}
                    onChange={(event) =>
                      setCredentials({
                        ...credentials,
                        role: event.target.value,
                      })
                    }
                  >
                    <option value="student">Student</option>
                    <option value="employee">Employee</option>
                    <option value="technician">Technician</option>
                    <option value="admin">Student / Employee Admin</option>
                    <option value="superadmin">Super Admin</option>
                    <option value="report_viewer">Report Viewer (read-only)</option>
                  </select>
                </label>
                <button
                  className="button button-primary full-width"
                  type="submit"
                >
                  Sign in <span>→</span>
                </button>
              </form>
              <AuthLinks
                onForgot={() => setPage("forgot")}
                onSignup={() => setPage("signup")}
              />
            </>
          )}
          {isSignup && (
            <>
              <AuthHeading
                title="Create account"
                detail="Register as a student or employee."
              />
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!signupForm.fullName.trim() || !signupForm.id.trim() || !signupForm.email.trim() || !signupForm.password.trim()) {
                    showMessage("Incomplete form", "Please fill in all signup fields before continuing.");
                    return;
                  }
                  try {
                    await api.signup({
                      fullName: signupForm.fullName,
                      id: signupForm.id,
                      email: signupForm.email,
                      userType: signupForm.userType,
                      password: signupForm.password,
                    });
                    playSound("signup");
                    showMessage(
                      "Account created",
                      "Your account was created successfully. You can now log in.",
                    );
                    setSignupForm({
                      fullName: "",
                      id: "",
                      email: "",
                      userType: "Student",
                      password: "",
                    });
                    setPage("login");
                  } catch (error) {
                    showMessage(
                      "Could not create account",
                      error.message || "Please try again.",
                    );
                  }
                }}
              >
                <Field
                  label="Full name"
                  placeholder="Enter your full name"
                  value={signupForm.fullName}
                  onChange={(value) =>
                    setSignupForm((current) => ({ ...current, fullName: value }))
                  }
                />
                <Field
                  label="ID number"
                  placeholder="Student / Employee ID"
                  value={signupForm.id}
                  onChange={(value) =>
                    setSignupForm((current) => ({ ...current, id: value }))
                  }
                />
                <Field
                  label="Email"
                  type="email"
                  placeholder="Enter email"
                  value={signupForm.email}
                  onChange={(value) =>
                    setSignupForm((current) => ({ ...current, email: value }))
                  }
                />
                <label className="field-label">
                  User type
                  <select
                    value={signupForm.userType}
                    onChange={(event) =>
                      setSignupForm((current) => ({
                        ...current,
                        userType: event.target.value,
                      }))
                    }
                  >
                    <option>Student</option>
                    <option>Employee</option>
                  </select>
                </label>
                <Field
                  label="Password"
                  type="password"
                  placeholder="Create password"
                  value={signupForm.password}
                  onChange={(value) =>
                    setSignupForm((current) => ({ ...current, password: value }))
                  }
                />
                <button
                  className="button button-primary full-width"
                  type="submit"
                >
                  Create account <span>→</span>
                </button>
              </form>
              <button className="text-button" onClick={() => setPage("login")}>
                ← Back to login
              </button>
            </>
          )}
          {isForgot && (
            <>
              <AuthHeading
                title="Reset password"
                detail="Enter your registered email to receive a reset request."
              />
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  showMessage(
                    "Reset request sent",
                    "A password reset request has been simulated successfully.",
                  );
                  setForgotEmail("");
                }}
              >
                <Field
                  label="Email address"
                  type="email"
                  placeholder="example@email.com"
                  value={forgotEmail}
                  onChange={setForgotEmail}
                />
                <button
                  className="button button-primary full-width"
                  type="submit"
                >
                  Send reset request <span>→</span>
                </button>
              </form>
              <button className="text-button" onClick={() => setPage("login")}>
                ← Back to login
              </button>
            </>
          )}
          <div className="auth-note">
            Need help? Contact <strong>IT Support Services</strong>
          </div>
        </div>
        {modal && <Modal modal={modal} setModal={setModal} />}
      </div>
    </div>
  );
}
function AuthHeading({ title, detail }) {
  return (
    <div className="auth-heading">
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}
function AuthLinks({ onForgot, onSignup }) {
  return (
    <div className="auth-links">
      <button onClick={onForgot}>Forgot password?</button>
      <span>·</span>
      <button onClick={onSignup}>Create account</button>
    </div>
  );
}
function Field({ label, type = "text", placeholder, value, onChange }) {
  return (
    <label className="field-label">
      {label}
      <input
        type={type}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(event) => onChange?.(event.target.value)}
        required
      />
    </label>
  );
}
function EyeButton({ visible, onToggle }) {
  return (
    <button
      type="button"
      className="eye-button"
      onClick={onToggle}
      aria-label={visible ? "Hide password" : "Show password"}
      title={visible ? "Hide password" : "Show password"}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
        <circle cx="12" cy="12" r="3" />
        {!visible && <line x1="4" y1="20" x2="20" y2="4" />}
      </svg>
    </button>
  );
}
function PasswordField({ label, placeholder, value, onChange }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field-label">
      {label}
      <span className="password-input">
        <input
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          value={value ?? ""}
          onChange={(event) => onChange?.(event.target.value)}
          required
        />
        <EyeButton visible={visible} onToggle={() => setVisible((v) => !v)} />
      </span>
    </label>
  );
}
function RequestStatusBanner({ latest }) {
  if (!latest) {
    return (
      <div className="pw-banner pw-banner-none">
        No password change request yet. Choose <strong>Change password</strong> to
        file one for the admin.
      </div>
    );
  }
  if (latest.status === "Pending") {
    return (
      <div className="pw-banner pw-banner-pending">
        <strong>{latest.id} is pending.</strong> Waiting for the admin to accept
        or decline your password change request.
      </div>
    );
  }
  if (latest.status === "Approved") {
    return (
      <div className="pw-banner pw-banner-approved">
        <strong>{latest.id} accepted.</strong> Your password was changed
        {latest.reviewedAt ? ` on ${latest.reviewedAt}` : ""}. Use the new
        password the next time you log in.
      </div>
    );
  }
  return (
    <div className="pw-banner pw-banner-rejected">
      <strong>{latest.id} declined.</strong>
      {latest.reviewNote
        ? ` Reason: ${latest.reviewNote}`
        : " The admin declined this password change request."}
    </div>
  );
}
function ChangePasswordForm({ pwForm, setPwForm, submitting, onSubmitRequest, onBack }) {
  return (
    <form className="profile-form" onSubmit={onSubmitRequest}>
      <button type="button" className="text-button profile-back" onClick={onBack}>
        ← Back to profile
      </button>
      <div className="modal-icon">🔑</div>
      <h3>Change password</h3>
      <p>
        File a password change request. The admin will review it before your
        password is updated.
      </p>
      <PasswordField
        label="New password"
        placeholder="At least 6 characters"
        value={pwForm.newPassword}
        onChange={(value) => setPwForm((current) => ({ ...current, newPassword: value }))}
      />
      <PasswordField
        label="Confirm new password"
        placeholder="Re-type the new password"
        value={pwForm.confirm}
        onChange={(value) => setPwForm((current) => ({ ...current, confirm: value }))}
      />
      <label className="field-label">
        Reason (optional)
        <textarea
          placeholder="Why do you need a password change?"
          value={pwForm.reason}
          onChange={(event) =>
            setPwForm((current) => ({ ...current, reason: event.target.value }))
          }
        />
      </label>
      <button
        className="button button-primary full-width"
        type="submit"
        disabled={submitting}
      >
        {submitting ? "Submitting..." : "Send request to admin"} <span>→</span>
      </button>
    </form>
  );
}
function ProfileModal({
  user,
  profile,
  view,
  setView,
  requests,
  pwForm,
  setPwForm,
  submitting,
  onSubmitRequest,
  onProfileChanged,
  showMessage,
  onClose,
  onLogout,
}) {
  const latest = requests[0] || null;
  const isPending = latest?.status === "Pending";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-box profile-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close profile"
        >
          ×
        </button>
        {view === "details" ? (
          <>
            <div className="profile-avatar">{user.name.charAt(0)}</div>
            <h3>{profile?.name || user.name}</h3>
            <span className="profile-role">{user.roleName}</span>
            <div className="profile-details">
              <div>
                <span>ID number</span>
                <strong>{profile?.id || user.id}</strong>
              </div>
              <div>
                <span>Email</span>
                <strong>{profile?.email || "Not provided"}</strong>
              </div>
              <div>
                <span>Password</span>
                <strong>Stored securely (hidden)</strong>
              </div>
              {MFA_ROLES.includes(user.role) && (
                <div>
                  <span>Two-step verification</span>
                  <strong>{profile?.mfaEnabled ? "On" : "Off"}</strong>
                </div>
              )}
            </div>
            <RequestStatusBanner latest={latest} />
            <div className="profile-actions">
              <button
                type="button"
                className="button button-primary full-width"
                onClick={() => setView("changePassword")}
                disabled={isPending}
              >
                {isPending ? "Request pending approval" : "Change password"}
              </button>
              {MFA_ROLES.includes(user.role) && (
                <button
                  type="button"
                  className="button button-outline full-width"
                  onClick={() => setView("mfa")}
                >
                  {profile?.mfaEnabled ? "Manage two-step verification" : "Set up two-step verification"}
                </button>
              )}
              <button
                type="button"
                className="button button-outline full-width"
                onClick={onLogout}
              >
                Log out
              </button>
            </div>
            {requests.length > 0 && (
              <div className="profile-history">
                <span className="eyebrow">PASSWORD REQUEST HISTORY</span>
                <ul>
                  {requests.slice(0, 4).map((item) => (
                    <li key={item.id}>
                      <strong>{item.id}</strong>
                      <span>{item.requestedAt}</span>
                      <Status value={item.status} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : view === "mfa" ? (
          <MfaSettings
            enabled={Boolean(profile?.mfaEnabled)}
            onBack={() => setView("details")}
            onChanged={onProfileChanged}
            showMessage={showMessage}
          />
        ) : (
          <ChangePasswordForm
            pwForm={pwForm}
            setPwForm={setPwForm}
            submitting={submitting}
            onSubmitRequest={onSubmitRequest}
            onBack={() => setView("details")}
          />
        )}
      </div>
    </div>
  );
}
function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
// Counts a numeric value (optionally with a % suffix) up from zero on mount.
function CountUp({ value }) {
  const match = /^(\d+)(%?)$/.exec(String(value));
  const isNumber = match !== null;
  const target = isNumber ? Number(match[1]) : 0;
  const suffix = isNumber ? match[2] : "";
  const reduceMotion = typeof window !== "undefined" && !motionAllowed();
  const [shown, setShown] = useState(reduceMotion ? target : 0);

  useEffect(() => {
    if (!isNumber || reduceMotion) return;
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / 700);
      setShown(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, isNumber, reduceMotion]);

  if (!isNumber) return value;
  return `${reduceMotion ? target : shown}${suffix}`;
}
function StatCard({ label, value, tone = "", hint = "" }) {
  return (
    <div className={`stat-card ${tone}`}>
      <span>{label}</span>
      <strong><CountUp value={value} /></strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
function UserDashboard({ setPage, tickets, ticketAssignments = {}, userName }) {
  return (
    <>
      <PageHeader
        eyebrow="OVERVIEW / 01"
        title={`${greeting()}, ${userName}.`}
        description="Here’s what’s happening with your support requests."
        action={
          <button
            className="button button-primary"
            onClick={() => setPage("requestPage")}
          >
            + New request
          </button>
        }
      />
      <div className="stats-grid">
        <StatCard
          label="Total requests"
          value={tickets.length}
          hint={
            tickets.some((ticket) => ticket.status === "Cancelled")
              ? `${tickets.filter((ticket) => ticket.status === "Cancelled").length} cancelled`
              : ""
          }
        />
        <StatCard
          label="Open"
          value={tickets.filter((ticket) => ticket.status === "Open").length}
          tone="gold"
        />
        <StatCard
          label="In progress"
          value={
            tickets.filter((ticket) => ticket.status === "In Progress").length
          }
          tone="blue"
        />
        <StatCard
          label="Resolved"
          value={
            tickets.filter((ticket) => ticket.status === "Resolved").length
          }
          tone="green"
        />
      </div>
      <div className="content-grid">
        <section className="panel panel-large">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">RECENT ACTIVITY</span>
              <h2>Your latest requests</h2>
            </div>
            <button
              className="link-button"
              onClick={() => setPage("myRequestsPage")}
            >
              View all ↗
            </button>
          </div>
          <TicketTable
            tickets={tickets.slice(0, 3).map((ticket) => ({
              ...ticket,
              ...ticketTracking(ticket, ticketAssignments[ticket.id]),
            }))}
            showAssignmentMeta
          />
        </section>
        <section className="panel quick-panel">
          <span className="eyebrow">NEED A HAND?</span>
          <h2>What can we help with?</h2>
          <p>Report a technical concern and our team will get right on it.</p>
          <button
            className="button button-dark"
            onClick={() => setPage("requestPage")}
          >
            Submit a request <span>→</span>
          </button>
          <div className="support-line">
            Average response time <strong>under 2 hours</strong>
          </div>
        </section>
      </div>
    </>
  );
}
function TicketTable({ tickets, showAssignmentMeta = false, onOpen }) {
  const hasMeta = showAssignmentMeta || tickets.some((ticket) => ticket.assignedTechnician || ticket.progress);

  if (!tickets || tickets.length === 0) {
    return (
      <div className="table-wrap empty-state">
        <p>No requests yet. Submit your first support request to get started.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Subject</th>
            <th>Category</th>
            <th>Priority</th>
            <th>Status</th>
            {hasMeta && <th>Technician</th>}
            {hasMeta && <th>Progress</th>}
            {onOpen && <th>Details</th>}
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.id}>
              <td>
                <strong>{ticket.id}</strong>
              </td>
              <td>{ticket.subject}</td>
              <td>{ticket.category}</td>
              <td>
                <Priority value={ticket.priority} />
              </td>
              <td>
                <Status value={ticket.status} />
              </td>
              {hasMeta && <td>{ticket.assignedTechnician || "Unassigned"}</td>}
              {hasMeta && <td>{ticket.progress || "Queued"}</td>}
              {onOpen && (
                <td>
                  <button className="table-button" onClick={() => onOpen(ticket.id)}>
                    Open
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Priority({ value }) {
  return (
    <span className={`priority priority-${value.toLowerCase()}`}>{value}</span>
  );
}
function Status({ value }) {
  return (
    <span className={`status status-${value.toLowerCase().replace(" ", "-")}`}>
      <i></i>
      {value}
    </span>
  );
}
function RequestPage({ request, setRequest, submitRequest }) {
  return (
    <>
      <PageHeader
        eyebrow="SUPPORT / 02"
        title="Submit a request"
        description="Tell us what’s going on. The more detail, the faster we can help."
      />
      <form className="panel request-form" onSubmit={submitRequest}>
        <div className="form-intro">
          <span className="form-number">01</span>
          <div>
            <h2>Request details</h2>
            <p>Give us the basics about your technical concern.</p>
          </div>
        </div>
        <div className="form-grid">
          <SelectField
            label="Category"
            value={request.category}
            options={CATEGORY_OPTIONS}
            placeholder="Select the type of problem"
            onChange={(value) => setRequest({ ...request, category: value })}
          />
          <SelectField
            label="Priority"
            value={request.priority}
            options={["Low", "Medium", "High"]}
            onChange={(value) => setRequest({ ...request, priority: value })}
          />
        </div>
        <Field
          label="Subject"
          placeholder="Example: Cannot connect to Wi-Fi"
          value={request.subject}
          onChange={(value) => setRequest({ ...request, subject: value })}
        />
        <Field
          label="Location"
          placeholder="Example: Computer Laboratory 2"
          value={request.location}
          onChange={(value) => setRequest({ ...request, location: value })}
        />
        <label className="field-label">
          Description
          <textarea
            placeholder="Describe your problem here..."
            value={request.description}
            onChange={(event) =>
              setRequest({ ...request, description: event.target.value })
            }
            required
          />
        </label>
        <div className="form-footer">
          <span>We’ll use these details to route your request.</span>
          <button className="button button-primary" type="submit">
            Submit request <span>→</span>
          </button>
        </div>
      </form>
    </>
  );
}
function SelectField({ label, value, options, onChange, placeholder }) {
  return (
    <label className="field-label">
      {label}
      <select
        value={value}
        required={Boolean(placeholder)}
        onChange={(event) => onChange(event.target.value)}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
function MyRequests({ tickets, ticketAssignments = {}, setPage, me, refreshData, showMessage }) {
  const [openId, setOpenId] = useState(null);
  const openTicket = tickets.find((ticket) => ticket.id === openId);
  return (
    <>
      <PageHeader
        eyebrow="REQUESTS / 03"
        title="My requests"
        description="A clear view of everything you’ve sent our way."
        action={
          <button
            className="button button-primary"
            onClick={() => setPage("requestPage")}
          >
            + New request
          </button>
        }
      />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ALL TICKETS</span>
            <h2>Request history</h2>
          </div>
          <span className="table-count">{tickets.length} total</span>
        </div>
        <TicketTable
          tickets={tickets.map((ticket) => ({
            ...ticket,
            ...ticketTracking(ticket, ticketAssignments[ticket.id]),
          }))}
          showAssignmentMeta
          onOpen={setOpenId}
        />
      </section>
      {openTicket && (
        <TicketDetailsModal
          ticket={openTicket}
          me={me}
          onClose={() => setOpenId(null)}
          onChanged={refreshData}
          showMessage={showMessage}
        />
      )}
    </>
  );
}
function AdminDashboard({ setPage, tickets = [], users = [] }) {
  const resolvedTickets = tickets.filter((ticket) => ticket.status === "Resolved").length;
  const openTickets = tickets.filter((ticket) => ticket.status === "Open").length;
  const inProgressTickets = tickets.filter((ticket) => ticket.status === "In Progress").length;
  const studentCount = users.filter((user) => /student/i.test(user.role || "")).length;
  const employeeCount = users.filter((user) => /employee/i.test(user.role || "")).length;

  const stats = [
    ["Students", String(studentCount)],
    ["Employees", String(employeeCount)],
    ["Pending requests", String(openTickets + inProgressTickets)],
    ["Resolved requests", String(resolvedTickets)],
  ];
  return (
    <>
      <PageHeader
        eyebrow="ADMIN / 01"
        title="Users administration."
        description="Manage student and employee requests from one place."
      />
      <div className="stats-grid">
        {stats.map(([label, value]) => (
          <StatCard key={label} label={label} value={value} />
        ))}
      </div>
      <section className="panel action-panel">
        <div>
          <span className="eyebrow">QUICK ACCESS</span>
          <h2>Keep things moving.</h2>
        </div>
        <div className="admin-actions">
          <button type="button" onClick={() => setPage("manageRequestsPage")}>
            <span>▤</span>
            <strong>Manage requests</strong>
            <small>Review and assign tickets</small>
            <span className="action-arrow" aria-label="Open requests">↗</span>
          </button>
          <button type="button" onClick={() => setPage("usersPage")}>
            <span>♙</span>
            <strong>Manage users</strong>
            <small>View registered users</small>
            <span className="action-arrow" aria-label="Open users">↗</span>
          </button>
          <button type="button" onClick={() => setPage("passwordRequestsPage")}>
            <span>🔑</span>
            <strong>Password requests</strong>
            <small>Accept or decline change requests</small>
            <span className="action-arrow" aria-label="Open password requests">↗</span>
          </button>
        </div>
      </section>
    </>
  );
}
function TechnicianDashboard({ setPage, tickets = [], me }) {
  const mine = tickets.filter(
    (ticket) => ticket.assignedTo === me.userId && ticket.status !== "Cancelled",
  );
  const waiting = tickets.filter((ticket) => ticket.status === "Open").length;
  const inProgress = mine.filter((ticket) => ticket.status === "In Progress").length;
  const resolved = mine.filter((ticket) => ticket.status === "Resolved").length;

  return (
    <>
      <PageHeader
        eyebrow="TECHNICIAN / 01"
        title="Your work queue."
        description="View and manage the support requests currently in the system."
      />
      <div className="stats-grid">
        <StatCard label="Assigned to you" value={mine.length} hint="Tickets an admin gave you" />
        <StatCard label="Waiting for a technician" value={waiting} tone="gold" hint="Not assigned yet" />
        <StatCard label="Your tickets in progress" value={inProgress} tone="blue" />
        <StatCard label="Completed by you" value={resolved} tone="green" />
      </div>
      <section className="panel empty-action">
        <div className="empty-icon">✓</div>
        <h2>Ready when you are.</h2>
        <p>
          {waiting === 0
            ? "No requests are waiting right now."
            : `${waiting} request${waiting === 1 ? " is" : "s are"} waiting for a technician.`}
        </p>
        <button
          className="button button-primary"
          onClick={() => setPage("technicianRequestsPage")}
        >
          View assigned requests <span>→</span>
        </button>
      </section>
    </>
  );
}
function SkillChips({ skills = [], empty = "No skills assigned" }) {
  if (!skills.length) return <span className="skill-empty">{empty}</span>;
  return (
    <span className="skill-chips">
      {skills.map((skill) => (
        <span className="skill-chip" key={skill}>{skill}</span>
      ))}
    </span>
  );
}
function TechnicianRequests({
  me,
  mySkills = [],
  tickets = [],
  ticketAssignments = {},
  setTicketAssignments,
  addActivity,
  showMessage,
  refreshData,
}) {
  const [riskDialog, setRiskDialog] = useState(null);
  const [view, setView] = useState("all");
  const [openId, setOpenId] = useState(null);
  const openTicket = tickets.find((ticket) => ticket.id === openId);

  // Pick up skill changes an admin makes while this page is open.
  useEffect(() => {
    const timer = setInterval(refreshData, 30000);
    return () => clearInterval(timer);
  }, [refreshData]);

  const handleResolve = async (ticketId) => {
    try {
      await api.updateTicketStatus(ticketId, "Resolved", me.userId);
      setTicketAssignments((current) => ({
        ...current,
        [ticketId]: {
          ...(current[ticketId] || {}),
          progress: "Resolved",
        },
      }));
      addActivity(`Resolved ticket ${ticketId}`);
      showMessage("Ticket resolved", `Ticket ${ticketId} has been marked as resolved.`);
      refreshData();
    } catch (error) {
      showMessage("Could not resolve ticket", error.message || "Please try again.");
    }
  };

  const requestResolve = (ticket) => {
    if (skillFit(mySkills, ticket.category) === "mismatch") {
      setRiskDialog(ticket);
      return;
    }
    handleResolve(ticket.id);
  };

  // Recommended tickets float to the top; the rest keep their original order.
  const rank = { match: 0, neutral: 1, mismatch: 2 };
  const finished = (ticket) => ["Resolved", "Cancelled"].includes(ticket.status);
  const order = (ticket) => rank[skillFit(mySkills, ticket.category)] + (finished(ticket) ? 10 : 0);
  const sorted = [...tickets].sort((a, b) => order(a) - order(b));
  const recommendedCount = tickets.filter(
    (ticket) => skillFit(mySkills, ticket.category) === "match" && !finished(ticket),
  ).length;
  const visible =
    view === "recommended"
      ? sorted.filter((ticket) => skillFit(mySkills, ticket.category) === "match")
      : sorted;

  return (
    <>
      <PageHeader
        eyebrow="TECHNICIAN / 02"
        title="Assigned requests"
        description="Technical issues currently waiting for action."
      />
      <section className="panel skill-banner">
        <div>
          <span className="eyebrow">YOUR SKILLS</span>
          <h2><SkillChips skills={mySkills} empty="No skills assigned yet" /></h2>
          <p>
            {mySkills.length
              ? `${recommendedCount} open request${recommendedCount === 1 ? "" : "s"} recommended for you are listed first.`
              : "Ask an admin to assign your skills so requests can be matched to you."}
          </p>
        </div>
        <div className="segmented" role="tablist" aria-label="Request filter">
          <button
            type="button"
            className={view === "all" ? "active" : ""}
            onClick={() => setView("all")}
          >
            All requests
          </button>
          <button
            type="button"
            className={view === "recommended" ? "active" : ""}
            onClick={() => setView("recommended")}
          >
            Recommended
          </button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">YOUR QUEUE</span>
            <h2>Active tickets</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>User</th>
                <th>Issue</th>
                <th>Category</th>
                <th>Fit</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Technician</th>
                <th>Progress</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan="10">
                    {view === "recommended"
                      ? "No requests match your skills right now."
                      : "No tickets are currently available."}
                  </td>
                </tr>
              )}
              {visible.map((ticket) => {
                const assignment = ticketAssignments[ticket.id] || {};
                const tracking = ticketTracking(ticket, assignment);
                const fit = skillFit(mySkills, ticket.category);
                return (
                  <tr key={ticket.id} className={`fit-row fit-${fit}`}>
                    <td>
                      <strong>{ticket.id}</strong>
                    </td>
                    <td>{ticket.userName || "Unknown user"}</td>
                    <td>{ticket.subject}</td>
                    <td>{ticket.category}</td>
                    <td>
                      {fit === "match" && <span className="fit-badge fit-badge-match">★ Recommended</span>}
                      {fit === "mismatch" && <span className="fit-badge fit-badge-mismatch">⚠ Outside your skills</span>}
                      {fit === "neutral" && <span className="fit-badge">—</span>}
                    </td>
                    <td>
                      <Priority value={ticket.priority} />
                    </td>
                    <td>
                      <Status value={ticket.status} />
                    </td>
                    <td>{tracking.assignedTechnician || "Pending assignment"}</td>
                    <td>{tracking.progress}</td>
                    <td>
                      <div className="inline-actions">
                        <button className="table-button light" onClick={() => setOpenId(ticket.id)}>
                          Chat
                        </button>
                        <button
                          className="table-button"
                          disabled={["Resolved", "Cancelled"].includes(ticket.status)}
                          onClick={() => requestResolve(ticket)}
                        >
                          {ticket.status === "Cancelled"
                            ? "Cancelled"
                            : ticket.status === "Resolved"
                              ? "Resolved"
                              : "Resolve"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {openTicket && (
        <TicketDetailsModal
          ticket={openTicket}
          me={me}
          onClose={() => setOpenId(null)}
          onChanged={refreshData}
          showMessage={showMessage}
        />
      )}
      {riskDialog && (
        <div className="modal-backdrop" onClick={() => setRiskDialog(null)}>
          <div className="modal-box risk-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-icon warn-icon">!</div>
            <h3>Not recommended for your skills</h3>
            <p>
              <strong>{riskDialog.id}</strong> is a <strong>{riskDialog.category}</strong> request,
              which is outside your skills. This is not recommended for your skill. Do this at
              your own risk.
            </p>
            <div className="dialog-actions">
              <button className="button button-outline" onClick={() => setRiskDialog(null)}>
                Cancel
              </button>
              <button
                className="button button-primary"
                onClick={() => {
                  const ticket = riskDialog;
                  setRiskDialog(null);
                  handleResolve(ticket.id);
                }}
              >
                Proceed anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
function ManageRequests({
  me,
  tickets = [],
  users = [],
  ticketAssignments = {},
  setTicketAssignments,
  showMessage,
  refreshData,
}) {
  const [assignDialog, setAssignDialog] = useState(null);
  const [viewDialog, setViewDialog] = useState(null);
  const [chatId, setChatId] = useState(null);
  const chatTicket = tickets.find((ticket) => ticket.id === chatId);
  const technicians = users.filter((user) =>
    /technician/i.test(user.role || ""),
  );

  const handleAssign = async (ticketId) => {
    const ticket = tickets.find((item) => item.id === ticketId);
    if (!ticket) return;
    setAssignDialog({ ticketId, subject: ticket.subject, category: ticket.category });
  };

  const handleView = (ticketId) => {
    const ticket = tickets.find((item) => item.id === ticketId);
    if (!ticket) return;
    setViewDialog({
      ...ticket,
      assignment: ticketAssignments[ticket.id] || {},
      tracking: ticketTracking(ticket, ticketAssignments[ticket.id]),
    });
  };

  const confirmAssign = async (ticketId, technician, slot) => {
    try {
      await api.assignTicket(ticketId, { actorId: me.userId, technicianId: technician.userId });
      setTicketAssignments((current) => ({
        ...current,
        [ticketId]: {
          ...(current[ticketId] || {}),
          assignedTechnician: technician.name,
          technicianId: technician.id,
          assignedTime: slot,
          progress: "Technician assigned",
        },
      }));
      showMessage(
        "Technician assigned",
        `${technician.name} is available at ${slot} for ticket ${ticketId}.`,
      );
      refreshData();
      setAssignDialog(null);
    } catch (error) {
      showMessage("Could not assign ticket", error.message || "Please try again.");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="MANAGEMENT / 02"
        title="Request management"
        description="Review, assign, and monitor submitted tickets."
      />
      <CancellationQueue me={me} showMessage={showMessage} refreshData={refreshData} />
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>User</th>
                <th>Role</th>
                <th>Issue</th>
                <th>Status</th>
                <th>Technician</th>
                <th>Progress</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {tickets.length === 0 && (
                <tr>
                  <td colSpan="8">No tickets have been created yet.</td>
                </tr>
              )}
              {tickets.map((ticket) => {
                const assignment = ticketAssignments[ticket.id] || {};
                const tracking = ticketTracking(ticket, assignment);
                return (
                  <tr key={ticket.id}>
                    <td>
                      <strong>{ticket.id}</strong>
                    </td>
                    <td>{ticket.userName || "Unknown user"}</td>
                    <td>{ticket.userRole || "Unassigned"}</td>
                    <td>{ticket.subject}</td>
                    <td>
                      <Status value={ticket.status} />
                    </td>
                    <td>{tracking.assignedTechnician || "Unassigned"}</td>
                    <td>{tracking.progress}</td>
                    <td>
                      <div className="inline-actions">
                        <button
                          className="table-button light"
                          onClick={() => handleView(ticket.id)}
                        >
                          View
                        </button>
                        <button className="table-button light" onClick={() => setChatId(ticket.id)}>
                          Chat
                        </button>
                        <button
                          className="table-button"
                          disabled={["Resolved", "Cancelled"].includes(ticket.status)}
                          onClick={() => handleAssign(ticket.id)}
                        >
                          {ticket.status === "Cancelled"
                            ? "Cancelled"
                            : ticket.status === "In Progress"
                              ? "In progress"
                              : "Assign"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {chatTicket && (
        <TicketDetailsModal
          ticket={chatTicket}
          me={me}
          onClose={() => setChatId(null)}
          onChanged={refreshData}
          showMessage={showMessage}
        />
      )}
      {assignDialog && (
        <div className="modal-backdrop" onClick={() => setAssignDialog(null)}>
          <div className="modal-box assignment-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-icon">✓</div>
            <h3>Available technicians</h3>
            <p>
              Assign support for <strong>{assignDialog.subject}</strong>.
            </p>
            <div className="assignment-list">
              {technicians.length === 0 ? (
                <div className="empty-assignment">No technicians are currently available.</div>
              ) : (
                [...technicians]
                  .sort(
                    (a, b) =>
                      Number(skillFit(b.skills, assignDialog.category) === "match") -
                      Number(skillFit(a.skills, assignDialog.category) === "match"),
                  )
                  .map((technician, index) => {
                  const fit = skillFit(technician.skills, assignDialog.category);
                  const slot = ["9:00 AM - 11:00 AM", "1:00 PM - 3:00 PM", "4:00 PM - 6:00 PM"][index % 3];
                  return (
                    <button
                      key={technician.userId}
                      className="assignment-card"
                      onClick={() => confirmAssign(assignDialog.ticketId, technician, slot)}
                    >
                      <span className="assignment-name">
                        {technician.name}
                        {fit === "match" && <span className="fit-badge fit-badge-match">★ Skill match</span>}
                      </span>
                      <SkillChips skills={technician.skills} />
                      <span className="assignment-slot">Available: {slot}</span>
                    </button>
                  );
                })
              )}
            </div>
            <button className="text-button" onClick={() => setAssignDialog(null)}>
              Close
            </button>
          </div>
        </div>
      )}
      {viewDialog && (
        <div className="modal-backdrop" onClick={() => setViewDialog(null)}>
          <div className="modal-box details-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-icon">i</div>
            <h3>{viewDialog.id}</h3>
            <p>{viewDialog.subject}</p>
            <div className="detail-stack">
              <div><strong>Technician:</strong> {viewDialog.tracking.assignedTechnician || "Not assigned"}</div>
              <div><strong>Availability:</strong> {viewDialog.assignment.assignedTime || "Awaiting schedule"}</div>
              <div><strong>Progress:</strong> {viewDialog.tracking.progress}</div>
              <div><strong>Status:</strong> {viewDialog.status}</div>
            </div>
            <button className="button button-primary" onClick={() => setViewDialog(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
function PasswordRequestsPage({ requests = [], currentUser, showMessage, refreshData }) {
  const [action, setAction] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const pendingCount = requests.filter((item) => item.status === "Pending").length;

  function openAction(mode, request) {
    setNote("");
    setAction({ mode, id: request.id, userName: request.userName });
  }

  async function confirmAction() {
    if (!action || busy) return;
    setBusy(true);
    try {
      await api.resolvePasswordRequest(action.id, {
        status: action.mode === "approve" ? "Approved" : "Rejected",
        note,
        reviewedBy: currentUser.userId,
      });
      showMessage(
        action.mode === "approve" ? "Request accepted" : "Request declined",
        action.mode === "approve"
          ? `${action.id} was accepted and the account password was updated.`
          : `${action.id} was declined. The user can file a new request.`,
      );
      setAction(null);
      setNote("");
      refreshData();
    } catch (error) {
      showMessage("Could not update request", error.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="SECURITY / 04"
        title="Password requests"
        description="Accept or decline password change requests filed by students and employees."
        action={<span className="table-count">{pendingCount} pending</span>}
      />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CHANGE PASSWORD</span>
            <h2>Request queue</h2>
          </div>
          <span className="table-count">{requests.length} total</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Request</th>
                <th>User</th>
                <th>ID</th>
                <th>Role</th>
                <th>Reason</th>
                <th>Requested</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 && (
                <tr>
                  <td colSpan="8">No password change requests yet.</td>
                </tr>
              )}
              {requests.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.id}</strong>
                  </td>
                  <td>{item.userName}</td>
                  <td>{item.userNumber}</td>
                  <td>{item.userRole}</td>
                  <td className="cell-note" title={item.reason || ""}>
                    {item.reason || "—"}
                  </td>
                  <td>{item.requestedAt}</td>
                  <td>
                    <Status value={item.status} />
                    {item.reviewNote && (
                      <div className="review-note">Note: {item.reviewNote}</div>
                    )}
                    {item.reviewedBy && item.reviewedAt && (
                      <div className="review-note">
                        {item.reviewedBy} · {item.reviewedAt}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="inline-actions">
                      <button
                        className="table-button"
                        disabled={item.status !== "Pending"}
                        onClick={() => openAction("approve", item)}
                      >
                        {item.status === "Approved" ? "Accepted" : "Accept"}
                      </button>
                      <button
                        className="table-button light"
                        disabled={item.status !== "Pending"}
                        onClick={() => openAction("decline", item)}
                      >
                        {item.status === "Rejected" ? "Declined" : "Decline"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {action && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!busy) setAction(null);
          }}
        >
          <div
            className="modal-box"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-icon">{action.mode === "approve" ? "✓" : "!"}</div>
            <h3>{action.mode === "approve" ? "Accept request?" : "Decline request?"}</h3>
            <p>
              {action.mode === "approve"
                ? `Accept ${action.id} from ${action.userName}? Their account password will be updated immediately.`
                : `Decline ${action.id} from ${action.userName}? They can file a new request afterwards.`}
            </p>
            {action.mode === "decline" && (
              <label className="field-label dialog-note">
                Note for the user (optional)
                <input
                  type="text"
                  placeholder="e.g. Visit the IT office for verification"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={confirmAction}
              >
                {busy
                  ? "Working..."
                  : action.mode === "approve"
                    ? "Accept request"
                    : "Decline request"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => setAction(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
function SkillEditor({ technician, onToggle, busy }) {
  return (
    <div className="skill-editor">
      {SKILL_OPTIONS.map((skill) => {
        const on = technician.skills.includes(skill);
        return (
          <button
            type="button"
            key={skill}
            className={`skill-toggle ${on ? "on" : ""}`}
            aria-pressed={on}
            disabled={busy}
            onClick={() => onToggle(technician, skill)}
          >
            {on ? "✓ " : "+ "}
            {skill}
          </button>
        );
      })}
    </div>
  );
}
function UsersPage({ currentUser, showMessage, refreshData }) {
  const [users, setUsers] = useState([]);
  const [selectedType, setSelectedType] = useState("technician");
  const [savingId, setSavingId] = useState(null);
  const [typeDialog, setTypeDialog] = useState(null);

  async function confirmTypeChange() {
    const { user: target, role } = typeDialog;
    setTypeDialog(null);
    setSavingId(target.userId);
    try {
      const result = await api.setUserRole(target.userId, {
        actorId: currentUser.userId,
        role,
      });
      setUsers((rows) =>
        rows.map((row) =>
          row.userId === target.userId
            ? {
                ...row,
                roleKey: result.role,
                role: result.roleName,
                skills: result.role === "technician" ? row.skills : [],
              }
            : row,
        ),
      );
      refreshData();
      showMessage(
        "User type changed",
        `${target.name} is now a ${result.roleName}. They need to log in again as a ${result.roleName} to use the new account type.`,
      );
    } catch (error) {
      showMessage("Could not change type", error.message || "Please try again.");
    } finally {
      setSavingId(null);
    }
  }

  async function toggleSkill(technician, skill) {
    const next = technician.skills.includes(skill)
      ? technician.skills.filter((item) => item !== skill)
      : [...technician.skills, skill];
    setSavingId(technician.userId);
    try {
      const result = await api.setTechnicianSkills(technician.userId, {
        actorId: currentUser.userId,
        skills: next,
      });
      setUsers((rows) =>
        rows.map((row) =>
          row.userId === technician.userId ? { ...row, skills: result.skills } : row,
        ),
      );
      refreshData();
    } catch (error) {
      showMessage("Could not update skills", error.message || "Please try again.");
    } finally {
      setSavingId(null);
    }
  }

  useEffect(() => {
    let active = true;
    api
      .getUsers()
      .then((rows) => active && setUsers(rows))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const filteredUsers = users.filter((user) => {
    if (!selectedType) return true;
    return (user.role || "").toLowerCase() === selectedType.toLowerCase();
  });

  return (
    <>
      <PageHeader
        eyebrow="DIRECTORY / 03"
        title="Users"
        description="Registered users across the HelpDesk system."
      />
      <section className="panel">
        <div className="panel-heading user-filter-panel">
          <div>
            <span className="eyebrow">FILTER USERS</span>
            <h2>Choose a user type</h2>
          </div>
          <label className="field-label compact-field">
            User type
            <select
              value={selectedType}
              onChange={(event) => setSelectedType(event.target.value)}
            >
              <option value="student">Student</option>
              <option value="employee">Employee</option>
              <option value="technician">Technician</option>
              <option value="admin">Admin</option>
              <option value="superadmin">Super Admin</option>
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Role</th>
                <th>Email</th>
                {selectedType === "technician" && <th>Skills (tap to assign)</th>}
                {(selectedType === "employee" || selectedType === "technician") && <th>Type</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="7">No registered {selectedType} users yet.</td>
                </tr>
              ) : (
                filteredUsers.map((user, index) => (
                  <tr key={`${user.id}-${index}`}>
                    <td>
                      <strong>{user.id}</strong>
                    </td>
                    <td>{user.name}</td>
                    <td>{user.role}</td>
                    <td>{user.email}</td>
                    {selectedType === "technician" && (
                      <td>
                        <SkillEditor
                          technician={user}
                          onToggle={toggleSkill}
                          busy={savingId === user.userId}
                        />
                      </td>
                    )}
                    {(selectedType === "employee" || selectedType === "technician") && (
                      <td>
                        <button
                          className="table-button light"
                          disabled={savingId === user.userId}
                          onClick={() =>
                            setTypeDialog({
                              user,
                              role: selectedType === "employee" ? "technician" : "employee",
                            })
                          }
                        >
                          {selectedType === "employee" ? "Make technician" : "Make employee"}
                        </button>
                      </td>
                    )}
                    <td>
                      <Status value="Active" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      {typeDialog && (
        <div className="modal-backdrop" onClick={() => setTypeDialog(null)}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()}>
            <div className="modal-icon">⇄</div>
            <h3>Change user type?</h3>
            <p>
              <strong>{typeDialog.user.name}</strong> will become a{" "}
              <strong>{typeDialog.role === "technician" ? "Technician" : "Employee"}</strong>.
              {typeDialog.role === "employee"
                ? " Their assigned skills will be cleared."
                : " You can assign their skills afterwards."}
            </p>
            <div className="dialog-actions">
              <button className="button button-outline" onClick={() => setTypeDialog(null)}>
                Cancel
              </button>
              <button className="button button-primary" onClick={confirmTypeChange}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function formatChatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function ChatWindow({ me, contact, onClose }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [sending, setSending] = useState(false);
  const scroller = useRef(null);
  const lastSeenId = useRef(null);

  const load = useCallback(
    () =>
      api
        .getConversation(me.userId, contact.userId)
        .then((rows) => {
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
        })
        .catch(() => {}),
    [me.userId, contact.userId],
  );

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages.length, collapsed]);

  async function send(event) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api.sendMessage({ senderId: me.userId, recipientId: contact.userId, body });
      playSound("sent");
      setDraft("");
      await load();
    } catch {
      // Keep the draft so the message can be retried.
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={`chat-window ${collapsed ? "collapsed" : ""}`} aria-label={`Chat with ${contact.name}`}>
      <header className="chat-window-head" onClick={() => setCollapsed((value) => !value)}>
        <span className="chat-avatar">{contact.name.charAt(0)}</span>
        <div>
          <strong>{contact.name}</strong>
          <small>{contact.roleName}</small>
        </div>
        <button
          type="button"
          className="chat-close"
          aria-label="Close chat"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      </header>
      {!collapsed && (
        <>
          <div className="chat-messages" ref={scroller}>
            {messages.length === 0 && (
              <p className="chat-empty">
                Say hi to {contact.name}. Only admins and technicians can message each other.
              </p>
            )}
            {messages.map((message, index) => {
              const mine = message.senderId === me.userId;
              const newSender = messages[index - 1]?.senderId !== message.senderId;
              return (
                <div className={`chat-msg ${mine ? "mine" : "theirs"}`} key={message.id}>
                  {newSender && (
                    <span className="chat-meta">
                      <b>{mine ? "You" : message.senderName}</b> · {message.senderRole}
                    </span>
                  )}
                  <span className="chat-bubble" title={formatChatTime(message.createdAt)}>
                    {message.body}
                    <time>{formatChatTime(message.createdAt)}</time>
                  </span>
                </div>
              );
            })}
          </div>
          <form className="chat-compose" onSubmit={send}>
            <ChatInput
              value={draft}
              onChange={setDraft}
              onSend={() => send()}
              placeholder="Type a message…"
              autoFocus
            />
            <button type="submit" disabled={!draft.trim() || sending} aria-label="Send">
              ➤
            </button>
          </form>
        </>
      )}
    </section>
  );
}

// Facebook-style chat: a floating button, a contact list, and docked windows.
function ChatDock({ me }) {
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [windows, setWindows] = useState([]);
  const unread = contacts.reduce((total, contact) => total + contact.unread, 0);
  const openWindowIds = useRef([]);
  const knownUnread = useRef(null);

  useEffect(() => {
    openWindowIds.current = windows.map((item) => item.userId);
  }, [windows]);

  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .getChatContacts(me.userId)
        .then((rows) => {
          if (!active) return;
          const previous = knownUnread.current;
          if (
            previous &&
            rows.some(
              (row) =>
                row.unread > (previous[row.userId] || 0) &&
                !openWindowIds.current.includes(row.userId),
            )
          ) {
            playSound("received");
          }
          knownUnread.current = Object.fromEntries(rows.map((row) => [row.userId, row.unread]));
          setContacts(rows);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [me.userId]);

  function openChat(contact) {
    setWindows((current) =>
      current.some((item) => item.userId === contact.userId)
        ? current
        : [...current.slice(-1), contact],
    );
    setOpen(false);
  }

  return (
    <div className="chat-dock">
      <div className="chat-windows">
        {windows.map((contact) => (
          <ChatWindow
            key={contact.userId}
            me={me}
            contact={contact}
            onClose={() => setWindows((current) => current.filter((item) => item.userId !== contact.userId))}
          />
        ))}
      </div>
      <div className="chat-launcher-wrap">
        {open && (
          <div className="chat-list" role="dialog" aria-label="Messages">
            <header>
              <strong>Messages</strong>
              <small>Admins and technicians</small>
            </header>
            <div className="chat-list-body">
              {contacts.length === 0 && (
                <p className="chat-empty">No other admins or technicians yet.</p>
              )}
              {contacts.map((contact) => (
                <button
                  type="button"
                  className="chat-contact"
                  key={contact.userId}
                  onClick={() => openChat(contact)}
                >
                  <span className="chat-avatar">{contact.name.charAt(0)}</span>
                  <span className="chat-contact-text">
                    <strong>{contact.name}</strong>
                    <small>{contact.roleName}</small>
                    {contact.lastBody && (
                      <em className={contact.unread ? "unread" : ""}>{contact.lastBody}</em>
                    )}
                  </span>
                  {contact.unread > 0 && <b className="chat-badge">{contact.unread}</b>}
                </button>
              ))}
            </div>
          </div>
        )}
        <button
          type="button"
          className={`chat-launcher ${open ? "open" : ""}`}
          onClick={() => setOpen((value) => !value)}
          aria-label="Open messages"
          aria-expanded={open}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.6 1.3 4.9 3.4 6.5V22l3.6-2c1 .3 2 .4 3 .4 5.5 0 10-3.9 10-8.7S17.5 3 12 3Z" />
          </svg>
          {unread > 0 && <b className="chat-badge">{unread}</b>}
        </button>
      </div>
    </div>
  );
}
const NOTIFICATION_STYLES = {
  resolved: ["✓", "good"],
  assigned: ["➜", "info"],
  in_progress: ["◔", "info"],
  status: ["•", "info"],
  message: ["✉", "info"],
  new_ticket: ["+", "warn"],
  cancellation_requested: ["!", "warn"],
  cancellation_approved: ["✕", "muted"],
  cancellation_rejected: ["↺", "info"],
  password_request: ["🔑", "warn"],
  password_approved: ["🔑", "good"],
  password_rejected: ["🔑", "muted"],
  skills: ["★", "good"],
  reopened: ["↻", "warn"],
  role: ["⇄", "info"],
};

function timeAgo(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} d ago`;
  return date.toLocaleDateString();
}

function NotificationIcon({ type }) {
  const [symbol, tone] = NOTIFICATION_STYLES[type] || ["•", "info"];
  return <span className={`notif-icon notif-${tone}`}>{symbol}</span>;
}

function NotificationsPage({ data, onRead, onOpen }) {
  const [filter, setFilter] = useState("all");
  const items = filter === "unread" ? data.items.filter((item) => !item.read) : data.items;
  return (
    <>
      <PageHeader
        eyebrow="UPDATES / 05"
        title="Notifications"
        description="Everything that changed on your requests and account, in one place."
        action={
          <button
            className="button button-primary"
            disabled={data.unread === 0}
            onClick={() => onRead(null)}
          >
            Mark all as read
          </button>
        }
      />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{data.unread} UNREAD</span>
            <h2>Latest updates</h2>
          </div>
          <div className="segmented" role="tablist" aria-label="Notification filter">
            <button
              type="button"
              className={filter === "all" ? "active" : ""}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            <button
              type="button"
              className={filter === "unread" ? "active" : ""}
              onClick={() => setFilter("unread")}
            >
              Unread
            </button>
          </div>
        </div>
        {items.length === 0 ? (
          <div className="notif-empty">
            <span className="empty-icon">🔔</span>
            <strong>{filter === "unread" ? "You are all caught up." : "No notifications yet."}</strong>
            <p>Updates about your requests will show up here.</p>
          </div>
        ) : (
          <ul className="notif-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`notif-item ${item.read ? "" : "unread"}`}
                  onClick={() => onOpen(item)}
                >
                  <NotificationIcon type={item.type} />
                  <span className="notif-text">
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                    <small>{timeAgo(item.createdAt)}</small>
                  </span>
                  {!item.read && <i className="notif-dot" aria-label="Unread"></i>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// Slide-in alerts for notifications that arrive while the app is open.
function ToastStack({ toasts, onDismiss, onOpen }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} onOpen={onOpen} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss, onOpen }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 7000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);
  return (
    <div className="toast" role="status">
      <button type="button" className="toast-body" onClick={() => onOpen(toast)}>
        <NotificationIcon type={toast.type} />
        <span className="notif-text">
          <strong>{toast.title}</strong>
          <span>{toast.body}</span>
        </span>
      </button>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
        ×
      </button>
    </div>
  );
}

// Admin queue: requesters ask to cancel, an admin accepts or declines.
function CancellationQueue({ me, showMessage, refreshData }) {
  const [requests, setRequests] = useState([]);
  const [review, setReview] = useState(null); // { request, status }
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api
        .getCancellationRequests(me.userId)
        .then(setRequests)
        .catch(() => {}),
    [me.userId],
  );

  useEffect(() => {
    load();
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [load]);

  const pending = requests.filter((request) => request.status === "Pending");
  const history = requests.filter((request) => request.status !== "Pending").slice(0, 5);

  async function submitReview(event) {
    event.preventDefault();
    if (!review || busy) return;
    setBusy(true);
    try {
      await api.reviewCancellation(review.request.id, {
        actorId: me.userId,
        status: review.status,
        note,
      });
      showMessage(
        review.status === "Approved" ? "Cancellation approved" : "Cancellation declined",
        review.status === "Approved"
          ? `${review.request.ticketId} was cancelled. The requester and technician were notified.`
          : `${review.request.requesterName} was told the request stays open.`,
      );
    } catch (error) {
      showMessage("Could not save decision", error.message || "Please try again.");
    } finally {
      setBusy(false);
      setReview(null);
      setNote("");
      load();
      refreshData();
    }
  }

  return (
    <>
      <section className="panel cancel-queue">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CANCELLATION REQUESTS</span>
            <h2>
              {pending.length === 0
                ? "Nothing waiting for review"
                : `${pending.length} waiting for your decision`}
            </h2>
          </div>
        </div>
        {pending.length > 0 && (
          <ul className="cancel-list">
            {pending.map((request) => (
              <li key={request.id}>
                <div>
                  <strong>
                    {request.ticketId} · {request.subject}
                  </strong>
                  <span>
                    {request.requesterName} ({request.requesterRole}) · ticket is {request.ticketStatus}
                  </span>
                  <p>&ldquo;{request.reason}&rdquo;</p>
                </div>
                <div className="inline-actions">
                  <button
                    className="table-button"
                    onClick={() => setReview({ request, status: "Approved" })}
                  >
                    Accept
                  </button>
                  <button
                    className="table-button danger"
                    onClick={() => setReview({ request, status: "Rejected" })}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {history.length > 0 && (
          <div className="cancel-history">
            <span className="eyebrow">RECENT DECISIONS</span>
            {history.map((request) => (
              <div key={request.id}>
                <span>
                  {request.ticketId} · {request.requesterName}
                </span>
                <Status value={request.status === "Approved" ? "Approved" : "Rejected"} />
              </div>
            ))}
          </div>
        )}
      </section>
      {review && (
        <div className="modal-backdrop" onClick={() => setReview(null)}>
          <form
            className="modal-box"
            onClick={(event) => event.stopPropagation()}
            onSubmit={submitReview}
          >
            <div className="modal-icon">{review.status === "Approved" ? "✓" : "✕"}</div>
            <h3>{review.status === "Approved" ? "Accept cancellation?" : "Reject cancellation?"}</h3>
            <p>
              {review.status === "Approved"
                ? `${review.request.ticketId} will be cancelled and the requester and technician will be notified.`
                : `${review.request.ticketId} stays open and the requester will be told why.`}
            </p>
            <label className="field-label dialog-note">
              Note (optional)
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                placeholder="Add a short note for the requester"
              />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="button button-outline"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                Back
              </button>
              <button type="submit" className="button button-primary" disabled={busy}>
                {review.status === "Approved" ? "Accept" : "Reject"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

function ReportCard({ title, note, children, wide = false }) {
  return (
    <section className={`panel report-card ${wide ? "wide" : ""}`}>
      <div className="report-card-head">
        <h3>{title}</h3>
        {note && <small>{note}</small>}
      </div>
      {children}
    </section>
  );
}

function SuperAdminDashboard({ me, canEdit, showMessage, setPage, tickets = [], users = [], activities = [] }) {
  const total = tickets.length;
  const resolved = tickets.filter((t) => t.status === "Resolved").length;
  const open = tickets.filter((t) => t.status === "Open").length;
  const inProgress = tickets.filter((t) => t.status === "In Progress").length;
  const technicians = users.filter((u) => /technician/i.test(u.role || "")).length;
  const resolutionRate = pct(resolved, total);
  const recent = activities.slice(0, 5);

  const summaries = [
    ["Total users", String(users.length), `${technicians} technicians`],
    ["Total tickets", String(total), `${open} open · ${inProgress} in progress`],
    ["Resolved tickets", String(resolved), `${open + inProgress} still active`],
    ["System activity", String(activities.length), "logged actions"],
  ];

  return (
    <>
      <PageHeader
        eyebrow="SYSTEM / 01"
        title="System overview."
        description="A pulse check across the entire HelpDesk system."
      />
      <div className="stats-grid">
        {summaries.map(([label, value, hint]) => (
          <div className="stat-card" key={label}>
            <span>{label}</span>
            <strong><CountUp value={value} /></strong>
            <small>{hint}</small>
          </div>
        ))}
      </div>
      <KpiScorecard me={me} showMessage={showMessage} canEdit={canEdit} />
      <div className="dash-split">
        <section className="panel kpi-panel">
          <span className="eyebrow">KPI · RESOLUTION RATE</span>
          <div className="kpi-big">{resolutionRate}%</div>
          <div className="kpi-meter"><span style={{ width: `${resolutionRate}%` }}></span></div>
          <p>{resolved} of {total} tickets resolved. Target: 80%.</p>
          <button type="button" className="button button-primary" onClick={() => setPage("reportManagerPage")}>
            Open Report Manager
          </button>
        </section>
        <section className="panel">
          <div className="report-card-head">
            <h3>Latest activity</h3>
            <button type="button" className="link-button" onClick={() => setPage("activityLogPage")}>
              View all
            </button>
          </div>
          {recent.length ? (
            <ul className="recent-list">
              {recent.map((a, i) => (
                <li key={i}>
                  <strong>{a[1]}</strong> <span>{a[3]}</span>
                  <small>{a[0]}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="report-empty">No activity yet.</p>
          )}
        </section>
      </div>
    </>
  );
}

const STATUS_COLORS = {
  Open: "#bd8128",
  "In Progress": "#39759d",
  Resolved: "#1c6b56",
  Cancelled: "#a7b1ac",
};
const PRIORITY_COLORS = { High: "#a44b45", Medium: "#bd8128", Low: "#1c6b56" };
const REQUESTER_ROLES = [
  ["student", "Student"],
  ["employee", "Employee"],
  ["technician", "Technician"],
  ["admin", "Admin"],
];

const formatDay = (value) => (typeof value === "string" ? value.slice(5) : value);

function ReportManager({ me, showMessage, canEdit = true }) {
  // Defaults load immediately: last 30 days, all categories, all roles.
  const [filters, setFilters] = useState(defaultReportFilters);
  const { data, isLoading, error, reload } = useReportData(filters, me.userId);

  // The KPI scorecard is monthly: it follows the month of the "To" date.
  const kpiMonth = (filters.to || monthKey()).slice(0, 7);
  const kpi = useKpiData(kpiMonth, me.userId);
  const trend = useKpiTrend(kpiMonth, me.userId);
  const [picking, setPicking] = useState(false);
  const cards = buildKpiCards(kpi.data);

  const locationRows = data?.byLocation || [];
  const locationMax = Math.max(1, ...locationRows.map((row) => row.value));

  function exportCsv() {
    if (!data) return;
    const from = data.filters.from || "all";
    const to = data.filters.to || "today";
    const kpiRows = cards.map((card) => [
      `KPI scorecard ${kpiMonth}`,
      card.target !== null && card.target !== undefined
        ? `${card.metric.name} (target ${formatKpiValue(card.target, card.metric.unit)})`
        : card.metric.name,
      card.reading?.value ?? "",
    ]);
    downloadCsv(`helpdesk-report_${from}_to_${to}.csv`, reportToCsvRows(data, kpiRows));
  }

  return (
    <>
      <PageHeader
        eyebrow="SYSTEM / 02"
        title="Report manager"
        description="Your chosen KPIs on top, the detail behind them below. Showing the last 30 days by default."
      />
      <ReportFilters
        filters={filters}
        onChange={setFilters}
        categories={SKILL_OPTIONS.concat("Others")}
        roles={REQUESTER_ROLES}
        onExport={exportCsv}
        canExport={Boolean(data) && !isLoading}
      />

      <KpiScorecardView
        data={kpi.data}
        trend={trend}
        isLoading={kpi.isLoading}
        error={kpi.error}
        reload={kpi.reload}
        eyebrow="KPI SCORECARD"
        title={`KPIs for ${monthLabel(kpiMonth)}`}
        note="KPIs always cover the whole month of the To date and ignore the category and role filters."
        controls={
          canEdit ? (
            <button
              type="button"
              className="button button-primary"
              disabled={!kpi.data}
              onClick={() => setPicking(true)}
            >
              Choose KPIs
            </button>
          ) : (
            <span className="gov-badge muted">Read-only</span>
          )
        }
      />
      <KpiTrendCard cards={cards} trend={trend} isLoading={kpi.isLoading || !trend} />
      {picking && kpi.data && (
        <KpiPicker
          data={kpi.data}
          month={kpiMonth}
          me={me}
          showMessage={showMessage}
          onClose={() => setPicking(false)}
          onSaved={() => {
            setPicking(false);
            kpi.reload();
          }}
        />
      )}

      {error && (
        <section className="panel report-error" role="alert">
          <strong>Could not load the report.</strong>
          <p>{error}</p>
          <button className="button button-primary" onClick={reload}>
            Try again
          </button>
        </section>
      )}

      <div className="report-section-title">
        <span className="eyebrow">DETAIL</span>
        <h2>
          {data?.totals
            ? `${data.totals.total} ticket${data.totals.total === 1 ? "" : "s"} in the selected period`
            : "Tickets in the selected period"}
        </h2>
      </div>
      <div className="report-grid">
        <ReportChartContainer
          title="Ticket volume over time"
          note="Line chart · per day"
          type="line"
          data={data?.byDay}
          xTickFormatter={formatDay}
          series={[{ key: "value", label: "Tickets", color: "#1c6b56" }]}
          isLoading={isLoading}
          wide
        />
        <ReportChartContainer
          title="Tickets by status"
          note="Donut chart"
          type="pie"
          data={data?.byStatus}
          colorFor={(row) => STATUS_COLORS[row.label]}
          isLoading={isLoading}
        />
        <ReportChartContainer
          title="Tickets by priority"
          note="Bar graph"
          data={data?.byPriority}
          colorFor={(row) => PRIORITY_COLORS[row.label] || "#1c6b56"}
          isLoading={isLoading}
        />
        <ReportChartContainer
          title="Tickets by category"
          note="Bar graph"
          data={data?.byCategory}
          horizontal
          isLoading={isLoading}
        />
        <ReportChartContainer
          title="Requests by requester role"
          note="Bar graph"
          data={data?.byRole}
          horizontal
          series={[{ key: "value", label: "Tickets", color: "#39759d" }]}
          isLoading={isLoading}
        />
        <ReportCard title="Campus location map" note="Heat map of where requests come from" wide>
          {isLoading ? (
            <ChartSkeleton height={140} label="Loading location map" />
          ) : locationRows.length ? (
            <div className="heat-map">
              {locationRows.map((row) => (
                <div
                  className="heat-cell"
                  key={row.label}
                  style={{
                    background: `rgba(28, 107, 86, ${0.12 + (row.value / locationMax) * 0.88})`,
                    color: row.value / locationMax > 0.45 ? "#fff" : "var(--ink)",
                  }}
                >
                  <strong>{row.value}</strong>
                  <span>{row.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="report-empty">No data for these filters.</p>
          )}
        </ReportCard>
        <ReportChartContainer
          title="Registered users by role"
          note="Not affected by filters"
          data={data?.usersByRole}
          horizontal
          series={[{ key: "value", label: "Users", color: "#39759d" }]}
          isLoading={isLoading}
        />
      </div>
    </>
  );
}

function ActivityLog({ activities }) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const roles = [...new Set(activities.map((a) => a[2]).filter(Boolean))].sort();
  const term = search.trim().toLowerCase();
  const rows = activities.filter(
    (a) =>
      (role === "all" || a[2] === role) &&
      (!term || a.some((cell) => String(cell).toLowerCase().includes(term))),
  );
  return (
    <>
      <PageHeader
        eyebrow="SYSTEM / 03"
        title="Activity log reports"
        description="Every action performed by every user inside the HelpDesk system."
      />
      <section className="panel report-filters">
        <label>
          Search
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="User or activity" />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="all">All roles</option>
            {roles.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <span className="filter-count">{rows.length} of {activities.length} entries</span>
      </section>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date / time</th>
                <th>User</th>
                <th>Role</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((activity, index) => (
                <tr key={`${activity[0]}-${index}`}>
                  {activity.map((item, i) => (
                    <td key={i}>{item}</td>
                  ))}
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={4}>No matching activity.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default App;
