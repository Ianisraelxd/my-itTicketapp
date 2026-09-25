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
    ["usersPage", "♙", "Users"],
  ],
  superadmin: [
    ["superAdminDashboard", "◈", "Dashboard"],
    ["usersPage", "♙", "Manage Users"],
    ["manageRequestsPage", "▤", "Manage Requests"],
    ["activityLogPage", "◷", "Activity Logs"],
  ],
};

const ASSIGNMENT_STORAGE_KEY = "helpdesk-ticket-assignments-v1";

function readTicketAssignments() {
  try {
    const raw = localStorage.getItem(ASSIGNMENT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
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

  function logout() {
    setUser(null);
    setAuthPage("login");
    setCredentials({ id: "", password: "", role: "student" });
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
        <div className="sidebar-user">
          <span className="avatar">{user.name.charAt(0)}</span>
          <div>
            <strong>{user.name}</strong>
            <span>{user.roleName}</span>
          </div>
        </div>
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
          <button onClick={logout}>Log out</button>
        </header>
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
        {(page === "adminDashboard" || page === "superAdminDashboard") && (
          <AdminDashboard
            type={page === "superAdminDashboard" ? "super" : "admin"}
            setPage={setPage}
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
        {page === "activityLogPage" && <ActivityLog activities={activities} />}
      </main>
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
                <Field
                  label="Password"
                  type="password"
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
function StatCard({ label, value, tone = "" }) {
  return (
    <div className={`stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
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
function AdminDashboard({ type, setPage, tickets = [], users = [] }) {
  const totalUsers = users.length;
  const totalTickets = tickets.length;
  const resolvedTickets = tickets.filter((ticket) => ticket.status === "Resolved").length;
  const openTickets = tickets.filter((ticket) => ticket.status === "Open").length;
  const inProgressTickets = tickets.filter((ticket) => ticket.status === "In Progress").length;
  const technicianCount = users.filter((user) => /technician/i.test(user.role || "")).length;
  const studentCount = users.filter((user) => /student/i.test(user.role || "")).length;
  const employeeCount = users.filter((user) => /employee/i.test(user.role || "")).length;

  const stats =
    type === "super"
      ? [
          ["Total users", String(totalUsers)],
          ["Total tickets", String(totalTickets)],
          ["Technicians", String(technicianCount)],
          ["Resolved tickets", String(resolvedTickets)],
        ]
      : [
          ["Students", String(studentCount)],
          ["Employees", String(employeeCount)],
          ["Pending requests", String(openTickets + inProgressTickets)],
          ["Resolved requests", String(resolvedTickets)],
        ];
  return (
    <>
      <PageHeader
        eyebrow={type === "super" ? "SYSTEM / 01" : "ADMIN / 01"}
        title={type === "super" ? "System overview." : "Users administration."}
        description={
          type === "super"
            ? "A pulse check across the entire HelpDesk system."
            : "Manage student and employee requests from one place."
        }
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
          {type === "super" && (
            <button type="button" onClick={() => setPage("activityLogPage")}>
              <span>◷</span>
              <strong>Activity logs</strong>
              <small>See recent system actions</small>
              <span className="action-arrow" aria-label="Open activity logs">↗</span>
            </button>
          )}
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
function ActivityLog({ activities }) {
  return (
    <>
      <PageHeader
        eyebrow="SYSTEM / 04"
        title="Activity log"
        description="Recent actions performed across the HelpDesk system."
      />
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
              {activities.map((activity, index) => (
                <tr key={`${activity[0]}-${index}`}>
                  {activity.map((item) => (
                    <td key={item}>{item}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default App;
