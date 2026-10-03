# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server on :5173 (proxies /api -> http://localhost:3001)
npm run server     # Express API on :3001 (needs MySQL running, e.g. XAMPP)
npm run build      # Production build to dist/
npm run lint       # oxlint (config: .oxlintrc.json)
npm run db:init    # Runs server/schema.sql via XAMPP's mysql.exe (prompts for password)
```

The frontend and API must both be running for the app to work. There is no test suite.

`server/schema.sql` **drops and recreates all tables**, then seeds demo accounts. Copy `server/.env.example` to `server/.env` for DB credentials. All seeded accounts share ID `2404154` and are distinguished by role (login requires ID + password + role); passwords are in the schema file.

## Architecture

- **Frontend is a single file**: `src/App.jsx` (~2300 lines) holds the root `App` component and every page/modal component. There is no router. `page` state (a string like `"manageRequestsPage"`) decides what renders; role-based menus come from the `navFor` map at the top, and the same map feeds both the desktop sidebar and the mobile `.bottom-nav`. Adding a page means: add a nav entry in `navFor`, add a `page === ...` render branch inside `<div className="page" key={page}>`, and write the component.
- **Roles**: `student`/`employee` (map to the "user" nav), `technician`, `admin`, `superadmin`. The superadmin sees only Dashboard, Report Manager and Activity Log Reports; user/ticket/password-request management belongs to the admin role.
- **Data flow**: `App` loads tickets, activities and (for technician/admin/superadmin) users from `src/api.js` whenever `user` or `refreshKey` changes; children call `refreshData()` after mutations. Student/employee fetch only their own tickets (`mine=1`).
- **Skills & recommendations**: technician skills live in `users.skills` (comma-separated ticket categories, shared list `SKILL_OPTIONS` in App.jsx). Admins edit them on the Users page (technician filter) and can switch an account between Employee and Technician (`PATCH /api/users/:id/role`, which fails with 409 if that ID already exists in the target role); `PATCH /api/users/:id/skills` checks the actor is an admin. `skillFit()` classifies a ticket as match / mismatch / neutral for a technician: matches sort first with a "Recommended" badge, mismatches show a "do this at your own risk" warning modal before resolving. Tickets require an explicit category (no default).
- **Chat dock**: `ChatDock` (bottom-right, Facebook-style) is rendered only for admin and technician accounts. Messages live in the `messages` table via `/api/messages*`, which reject any non admin/technician sender or recipient. It polls (5s contacts, 3s open conversations) rather than using websockets.
- **Ticket conversation & cancellation**: `src/TicketChat.jsx` (`TicketDetailsModal` > `TicketChat`) is opened from My Requests (requesters) and the technician queue. The conversation behaves like a group chat: the requester, the assigned technician and all admins share one thread per ticket (technicians reach it from the queue's Chat button, admins from Manage Requests), and a new message notifies everyone else on it. Message boxes use `ChatInput.jsx` (auto-growing textarea: Enter sends, Shift+Enter adds a line). Messages live in `ticket_messages` (`kind` = `chat` | `cancellation_request` | `cancellation_decision`). Requesters can never cancel directly: `POST /api/tickets/:code/cancellation-requests` files a `cancellation_requests` row (and a chat message); admins accept/reject it from the queue at the top of Manage Requests (`PATCH /api/cancellation-requests/:code/status`), and only acceptance sets the ticket to `Cancelled` (status guard in the UPDATE). Chat is read-only once a ticket is Resolved/Done/Closed/Cancelled.
- **Assignment is stored server-side too**: `PATCH /api/tickets/:code/assign` (admin only) sets `tickets.assigned_to` and status In Progress; the time slot/progress shown in the UI still come from localStorage. `assigned_to` is what routes notifications to the right technician.
- **Notifications**: `notifications` table, written by the server-side `notify()` helper inside the route that causes the event (new ticket, assignment, status/resolved, ticket messages, cancellation requested/approved/declined, password request + decision, skills/role changes). Clients poll `GET /api/notifications?userId=` every 8s; new unread items pop a toast and trigger a data refresh. Superadmin has no notifications. Add new events by calling `notify([userIds], {type, title, body, ticketCode})`; map the `type` to an icon in `NOTIFICATION_STYLES` in App.jsx.
- **Sound effects**: `playSound(name)` in `src/sounds.js` (files in `public/sounds/`) is called for login, signup, message sent/received (chat dock and ticket chat) and new notifications. It debounces repeats and skips the message ding right after a notification sound. Incoming messages are detected by comparing the newest message id between polls.
- **Activities** travel as `[timestamp, name, role, action]` tuples (shaped in `GET /api/activities`), not objects.
- **Ticket assignments are client-only**: technician assignment is stored in `localStorage` (`helpdesk-ticket-assignments-v1`), not the database.
- **Backend**: `server/index.js` is one Express file with all routes; `server/db.js` exports a mysql2 pool and a `query()` helper (always use `?` placeholders). Tickets are keyed by a generated code (`#HD001`), password requests by `#PW001`. `/api/tickets` returns `location` and `createdAt`, which the Report Manager relies on.
- **Styling**: one stylesheet, `src/App.css`, with design tokens on `:root`, a tablet icon-rail breakpoint (≤1100px), and a phone layout (≤640px) where the sidebar is hidden and the bottom tab bar takes over. Animations respect `prefers-reduced-motion`.
- `presentation/index.html` is a standalone localStorage-based demo build, separate from the React app.

## Gotchas

- Passwords are stored and compared in plaintext (prototype); don't assume hashing exists.
- If Vite serves a blank page with "does not provide an export named 'default'", it cached a half-written `App.jsx`; restart the dev server.
