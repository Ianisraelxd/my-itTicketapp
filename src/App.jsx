import "./App.css";

import { useEffect, useState } from "react";

import { api } from "./api";

const navFor = {
  user: [
    ["userDashboard", "◈", "Dashboard"],
    ["requestPage", "+", "Submit Request"],
    ["myRequestsPage", "▤", "My Requests"],
  ],
  technician: [
    ["technicianDashboard", "◈", "Dashboard"],
    ["technicianRequestsPage", "▤", "Assigned Requests"],
  ],
  admin: [
    ["adminDashboard", "◈", "Dashboard"],
    ["manageRequestsPage", "▤", "Manage Requests"],
    ["passwordRequestsPage", "🔑", "Password Requests"],
    ["usersPage", "♙", "Users"],
  ],
  superadmin: [
    ["superAdminDashboard", "◈", "Dashboard"],
    ["reportManagerPage", "▥", "Report Manager"],
    ["activityLogPage", "◷", "Activity Log Reports"],
  ],
};

// Played when the Sign in / Create account button is pressed.
function playAuthSound() {
  try {
    const audio = new Audio("/login-sound.mp3");
    audio.play().catch(() => {});
  } catch {
    // Audio unavailable; ignore.
  }
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
  const [modal, setModal] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileView, setProfileView] = useState("details");
  const [profile, setProfile] = useState(null);
  const [myPwRequests, setMyPwRequests] = useState([]);
  const [pwRequests, setPwRequests] = useState([]);
  const [pwForm, setPwForm] = useState({ newPassword: "", confirm: "", reason: "" });
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [request, setRequest] = useState({
    category: "Hardware",
    priority: "Medium",
    subject: "",
    location: "",
    description: "",
  });

  const roleType =
    user?.role === "superadmin"
      ? "superadmin"
      : user?.role === "admin"
        ? "admin"
        : user?.role === "technician"
          ? "technician"
          : "user";
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

  // Load tickets and activities from the database once a user is signed in.
  useEffect(() => {
    if (!user) return;
    let active = true;
    const isPrivateUser =
      user.role === "student" || user.role === "employee";
    const needsAdminData = ["technician", "admin", "superadmin"].includes(user.role);

    Promise.all([
      api.getTickets(isPrivateUser ? { mine: true, userId: user.userId } : {}),
      api.getActivities(),
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

  async function login(event) {
    event.preventDefault();
    let account;
    try {
      account = await api.login(credentials);
    } catch (error) {
      showMessage(
        "Login failed",
        error.message || "Incorrect ID, password, or selected role.",
      );
      return;
    }
    setUser(account);
    refreshData();
    const landing =
      account.role === "superadmin"
        ? "superAdminDashboard"
        : account.role === "admin"
          ? "adminDashboard"
          : account.role === "technician"
            ? "technicianDashboard"
            : "userDashboard";
    setPage(landing);
    setCredentials((current) => ({ ...current, password: "" }));
  }

  async function submitRequest(event) {
    event.preventDefault();
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
      category: "Hardware",
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
    setUser(null);
    setAuthPage("login");
    setCredentials({ id: "", password: "", role: "student" });
    setProfileOpen(false);
    setProfileView("details");
    setProfile(null);
    setMyPwRequests([]);
    setPwRequests([]);
    setPwForm({ newPassword: "", confirm: "", reason: "" });
  }

  if (!user)
    return (
      <AuthScreen
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
            </button>
          ))}
        </nav>
        <button className="logout-button" onClick={logout}>
          <span>↪</span>Log out
        </button>
        <div className="sidebar-footer">
          HELPDESK v1.0
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
          />
        )}
        {page === "technicianDashboard" && (
          <TechnicianDashboard setPage={setPage} tickets={allTickets.length ? allTickets : tickets} />
        )}
        {page === "technicianRequestsPage" && (
          <TechnicianRequests
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
            setPage={setPage}
            tickets={allTickets.length ? allTickets : tickets}
            users={allUsers}
            activities={activities}
          />
        )}
        {page === "reportManagerPage" && (
          <ReportManager
            tickets={allTickets.length ? allTickets : tickets}
            users={allUsers}
          />
        )}
        {page === "manageRequestsPage" && (
          <ManageRequests
            tickets={allTickets.length ? allTickets : tickets}
            users={allUsers}
            ticketAssignments={ticketAssignments}
            setTicketAssignments={setTicketAssignments}
            showMessage={showMessage}
            refreshData={refreshData}
          />
        )}
        {page === "usersPage" && <UsersPage />}
        {page === "passwordRequestsPage" && (
          <PasswordRequestsPage
            requests={pwRequests}
            currentUser={user}
            showMessage={showMessage}
            refreshData={refreshData}
          />
        )}
        {page === "activityLogPage" && <ActivityLog activities={activities} />}
        </div>
      </main>
      <nav className="bottom-nav" aria-label="Main navigation">
        {navFor[roleType].map(([id, icon, label]) => (
          <button
            className={page === id ? "active" : ""}
            key={id}
            onClick={() => setPage(id)}
          >
            <span>{icon}</span>
            <small>{label}</small>
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
          onClose={() => setProfileOpen(false)}
          onLogout={logout}
        />
      )}
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
          {page === "login" && (
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
                  </select>
                </label>
                <button
                  className="button button-primary full-width"
                  type="submit"
                  onClick={playAuthSound}
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
                  onClick={playAuthSound}
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
  onClose,
  onLogout,
}) {
  const [showPassword, setShowPassword] = useState(false);
  const latest = requests[0] || null;
  const isPending = latest?.status === "Pending";
  const password = profile?.password || "••••••";

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
              <div className="profile-password">
                <span>Password</span>
                <strong className="profile-password-value">
                  {showPassword ? password : "••••••••"}
                </strong>
                <EyeButton
                  visible={showPassword}
                  onToggle={() => setShowPassword((value) => !value)}
                />
              </div>
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
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
function StatCard({ label, value, tone = "" }) {
  return (
    <div className={`stat-card ${tone}`}>
      <span>{label}</span>
      <strong><CountUp value={value} /></strong>
      <small>
        Compared with last month <b>↗</b>
      </small>
    </div>
  );
}
function UserDashboard({ setPage, tickets, ticketAssignments = {}, userName }) {
  return (
    <>
      <PageHeader
        eyebrow="OVERVIEW / 01"
        title={`Good morning, ${userName}.`}
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
        <StatCard label="Total requests" value={tickets.length} />
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
              assignedTechnician: ticketAssignments[ticket.id]?.assignedTechnician || "",
              progress: ticketAssignments[ticket.id]?.progress || "Queued",
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
function TicketTable({ tickets, showAssignmentMeta = false }) {
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
            options={[
              "Hardware",
              "Network / Internet",
              "Software",
              "Account / Login",
              "Printer",
              "Others",
            ]}
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
function SelectField({ label, value, options, onChange }) {
  return (
    <label className="field-label">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
function MyRequests({ tickets, ticketAssignments = {}, setPage }) {
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
            assignedTechnician: ticketAssignments[ticket.id]?.assignedTechnician || "",
            progress: ticketAssignments[ticket.id]?.progress || "Queued",
          }))}
          showAssignmentMeta
        />
      </section>
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
function TechnicianDashboard({ setPage, tickets = [] }) {
  const open = tickets.filter((ticket) => ticket.status === "Open").length;
  const inProgress = tickets.filter((ticket) => ticket.status === "In Progress").length;
  const resolved = tickets.filter((ticket) => ticket.status === "Resolved").length;

  return (
    <>
      <PageHeader
        eyebrow="TECHNICIAN / 01"
        title="Your work queue."
        description="View and manage the support requests currently in the system."
      />
      <div className="stats-grid">
        <StatCard label="Assigned tickets" value={tickets.length} />
        <StatCard label="Open" value={open} tone="gold" />
        <StatCard label="In progress" value={inProgress} tone="blue" />
        <StatCard label="Completed" value={resolved} tone="green" />
      </div>
      <section className="panel empty-action">
        <div className="empty-icon">✓</div>
        <h2>Ready when you are.</h2>
        <p>{tickets.length} requests are available in the queue.</p>
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
function TechnicianRequests({
  tickets = [],
  ticketAssignments = {},
  setTicketAssignments,
  addActivity,
  showMessage,
  refreshData,
}) {
  const [localTickets, setLocalTickets] = useState(tickets);

  useEffect(() => {
    setLocalTickets(tickets);
  }, [tickets]);

  const handleResolve = async (ticketId) => {
    try {
      await api.updateTicketStatus(ticketId, "Resolved");
      setTicketAssignments((current) => ({
        ...current,
        [ticketId]: {
          ...(current[ticketId] || {}),
          progress: "Resolved",
        },
      }));
      setLocalTickets((items) =>
        items.map((ticket) =>
          ticket.id === ticketId ? { ...ticket, status: "Resolved" } : ticket,
        ),
      );
      addActivity(`Resolved ticket ${ticketId}`);
      showMessage("Ticket resolved", `Ticket ${ticketId} has been marked as resolved.`);
      refreshData();
    } catch (error) {
      showMessage("Could not resolve ticket", error.message || "Please try again.");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="TECHNICIAN / 02"
        title="Assigned requests"
        description="Technical issues currently waiting for action."
      />
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
                <th>Priority</th>
                <th>Status</th>
                <th>Technician</th>
                <th>Progress</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {localTickets.length === 0 && (
                <tr>
                  <td colSpan="8">No tickets are currently available.</td>
                </tr>
              )}
              {localTickets.map((ticket) => {
                const assignment = ticketAssignments[ticket.id] || {};
                return (
                  <tr key={ticket.id}>
                    <td>
                      <strong>{ticket.id}</strong>
                    </td>
                    <td>{ticket.userName || "Unknown user"}</td>
                    <td>{ticket.subject}</td>
                    <td>
                      <Priority value={ticket.priority} />
                    </td>
                    <td>
                      <Status value={ticket.status} />
                    </td>
                    <td>{assignment.assignedTechnician || "Pending assignment"}</td>
                    <td>{assignment.progress || "Queued"}</td>
                    <td>
                      <button
                        className="table-button"
                        disabled={ticket.status === "Resolved"}
                        onClick={() => handleResolve(ticket.id)}
                      >
                        {ticket.status === "Resolved" ? "Resolved" : "Resolve"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
function ManageRequests({
  tickets = [],
  users = [],
  ticketAssignments = {},
  setTicketAssignments,
  showMessage,
  refreshData,
}) {
  const [assignDialog, setAssignDialog] = useState(null);
  const [viewDialog, setViewDialog] = useState(null);
  const technicians = users.filter((user) =>
    /technician/i.test(user.role || ""),
  );

  const handleAssign = async (ticketId) => {
    const ticket = tickets.find((item) => item.id === ticketId);
    if (!ticket) return;
    setAssignDialog({ ticketId, subject: ticket.subject });
  };

  const handleView = (ticketId) => {
    const ticket = tickets.find((item) => item.id === ticketId);
    if (!ticket) return;
    setViewDialog({
      ...ticket,
      assignment: ticketAssignments[ticket.id] || {},
    });
  };

  const confirmAssign = async (ticketId, technician, slot) => {
    try {
      await api.updateTicketStatus(ticketId, "In Progress");
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
                    <td>{assignment.assignedTechnician || "Unassigned"}</td>
                    <td>{assignment.progress || "Queued"}</td>
                    <td>
                      <div className="inline-actions">
                        <button
                          className="table-button light"
                          onClick={() => handleView(ticket.id)}
                        >
                          View
                        </button>
                        <button
                          className="table-button"
                          onClick={() => handleAssign(ticket.id)}
                        >
                          {ticket.status === "In Progress" ? "In progress" : "Assign"}
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
                technicians.map((technician, index) => {
                  const slot = ["9:00 AM - 11:00 AM", "1:00 PM - 3:00 PM", "4:00 PM - 6:00 PM"][index % 3];
                  return (
                    <button
                      key={technician.id}
                      className="assignment-card"
                      onClick={() => confirmAssign(assignDialog.ticketId, technician, slot)}
                    >
                      <span className="assignment-name">{technician.name}</span>
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
              <div><strong>Technician:</strong> {viewDialog.assignment.assignedTechnician || "Not assigned"}</div>
              <div><strong>Availability:</strong> {viewDialog.assignment.assignedTime || "Awaiting schedule"}</div>
              <div><strong>Progress:</strong> {viewDialog.assignment.progress || "Queued"}</div>
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
function UsersPage() {
  const [users, setUsers] = useState([]);
  const [selectedType, setSelectedType] = useState("student");

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
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="5">No registered {selectedType} users yet.</td>
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
    </>
  );
}
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

function countBy(items, getKey) {
  const map = new Map();
  items.forEach((item) => {
    const key = getKey(item) || "Unspecified";
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function BarList({ rows, tone = "" }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  if (!rows.length) return <p className="report-empty">No data for this filter.</p>;
  return (
    <div className="bar-list">
      {rows.map(([label, n]) => (
        <div className="bar-row" key={label}>
          <span className="bar-label" title={label}>{label}</span>
          <span className="bar-track">
            <span className={`bar-fill ${tone}`} style={{ width: `${(n / max) * 100}%` }}></span>
          </span>
          <b>{n}</b>
        </div>
      ))}
    </div>
  );
}

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

function SuperAdminDashboard({ setPage, tickets = [], users = [], activities = [] }) {
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
    ["Resolved tickets", String(resolved), `${total - resolved} still active`],
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

const TIME_RANGES = [
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["all", "All time"],
];

function ReportManager({ tickets = [], users = [] }) {
  const [now] = useState(() => Date.now());
  const [category, setCategory] = useState("all");
  const [range, setRange] = useState("all");
  const [role, setRole] = useState("all");

  const categories = [...new Set(tickets.map((t) => t.category).filter(Boolean))].sort();
  const roles = [...new Set(tickets.map((t) => t.userRole).filter(Boolean))].sort();

  const cutoff = range === "all" ? 0 : now - Number(range) * 86400000;
  const filtered = tickets.filter(
    (t) =>
      (category === "all" || t.category === category) &&
      (role === "all" || t.userRole === role) &&
      (!cutoff || (t.createdAt && new Date(t.createdAt).getTime() >= cutoff)),
  );

  const total = filtered.length;
  const resolved = filtered.filter((t) => t.status === "Resolved").length;
  const backlog = total - resolved;
  const high = filtered.filter((t) => t.priority === "High").length;
  const statusRows = ["Open", "In Progress", "Resolved"].map((s) => [
    s,
    filtered.filter((t) => t.status === s).length,
  ]);
  const statusColors = ["#bd8128", "#39759d", "#1c6b56"];
  let acc = 0;
  const donut = statusRows
    .map(([, n], i) => {
      const start = acc;
      acc += total ? (n / total) * 100 : 0;
      return `${statusColors[i]} ${start}% ${acc}%`;
    })
    .join(", ");

  const dayKey = (d) => d.toISOString().slice(0, 10);
  const trend = (() => {
    const dated = filtered.filter((t) => t.createdAt);
    const buckets = new Map();
    if (range === "all") {
      dated.forEach((t) => {
        const k = dayKey(new Date(t.createdAt)).slice(0, 7);
        buckets.set(k, (buckets.get(k) || 0) + 1);
      });
      return [...buckets.entries()].sort();
    }
    const days = Number(range);
    for (let i = days - 1; i >= 0; i--) buckets.set(dayKey(new Date(now - i * 86400000)), 0);
    dated.forEach((t) => {
      const k = dayKey(new Date(t.createdAt));
      if (buckets.has(k)) buckets.set(k, buckets.get(k) + 1);
    });
    return [...buckets.entries()].map(([k, n]) => [k.slice(5), n]);
  })();
  const trendMax = Math.max(1, ...trend.map(([, n]) => n));

  const locationRows = countBy(filtered, (t) => t.location).slice(0, 12);
  const locMax = Math.max(1, ...locationRows.map(([, n]) => n));
  const userRoleRows = countBy(users, (u) => u.role);

  const kpis = [
    ["Resolution rate", `${pct(resolved, total)}%`],
    ["Open backlog", String(backlog)],
    ["High-priority share", `${pct(high, total)}%`],
    ["Tickets in view", String(total)],
  ];

  return (
    <>
      <PageHeader
        eyebrow="SYSTEM / 02"
        title="Report manager"
        description="Graphs, maps and KPIs across the system. Filter by category, time range and role."
      />
      <section className="panel report-filters">
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>
          Time range
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            {TIME_RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>
          Requester role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="all">All roles</option>
            {roles.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <button
          type="button"
          className="button button-primary"
          onClick={() => { setCategory("all"); setRange("all"); setRole("all"); }}
        >
          Reset
        </button>
      </section>
      <div className="stats-grid">
        {kpis.map(([label, value]) => (
          <div className="stat-card" key={label}>
            <span>KPI · {label}</span>
            <strong><CountUp value={value} /></strong>
          </div>
        ))}
      </div>
      <div className="report-grid">
        <ReportCard title="1 · Tickets by status" note="Donut chart">
          <div className="donut-wrap">
            <div className="donut" style={{ background: total ? `conic-gradient(${donut})` : "#e2e8e4" }}>
              <span>{total}</span>
            </div>
            <ul className="legend">
              {statusRows.map(([s, n], i) => (
                <li key={s}><i style={{ background: statusColors[i] }}></i>{s} <b>{n}</b></li>
              ))}
            </ul>
          </div>
        </ReportCard>
        <ReportCard title="2 · Tickets by category" note="Bar graph">
          <BarList rows={countBy(filtered, (t) => t.category)} />
        </ReportCard>
        <ReportCard title="3 · Tickets by priority" note="Bar graph">
          <BarList
            rows={["High", "Medium", "Low"].map((p) => [p, filtered.filter((t) => t.priority === p).length])}
            tone="gold"
          />
        </ReportCard>
        <ReportCard title="4 · Requests by requester role" note="Bar graph">
          <BarList rows={countBy(filtered, (t) => t.userRole)} tone="blue" />
        </ReportCard>
        <ReportCard title="5 · Ticket volume over time" note={range === "all" ? "Per month" : "Per day"} wide>
          {trend.length ? (
            <div className="column-chart">
              {trend.map(([label, n]) => (
                <div className="column" key={label} title={`${label}: ${n}`}>
                  <b>{n || ""}</b>
                  <span style={{ height: `${(n / trendMax) * 100}%` }}></span>
                  <small>{label}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="report-empty">No data for this filter.</p>
          )}
        </ReportCard>
        <ReportCard title="6 · Campus location map" note="Heat map of where requests come from" wide>
          {locationRows.length ? (
            <div className="heat-map">
              {locationRows.map(([loc, n]) => (
                <div
                  className="heat-cell"
                  key={loc}
                  style={{ background: `rgba(28, 107, 86, ${0.12 + (n / locMax) * 0.88})`, color: n / locMax > 0.45 ? "#fff" : "var(--ink)" }}
                >
                  <strong>{n}</strong>
                  <span>{loc}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="report-empty">No data for this filter.</p>
          )}
        </ReportCard>
        <ReportCard title="7 · Registered users by role" note="Not affected by filters">
          <BarList rows={userRoleRows} tone="blue" />
        </ReportCard>
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
