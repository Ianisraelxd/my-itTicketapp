-- Campus HelpDesk database schema + seed data
-- Run with: mysql -u root -p < server/schema.sql
--
-- NOTE: Passwords are stored in plaintext here to match the existing
-- prototype. For any real deployment, hash them with bcrypt and compare
-- hashes in the login route instead.

CREATE DATABASE IF NOT EXISTS helpdesk
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE helpdesk;

-- Drop in dependency order so re-running the script is safe.
DROP VIEW IF EXISTS tickets_all;
DROP TABLE IF EXISTS archive_runs;
DROP TABLE IF EXISTS cancellation_requests_archive;
DROP TABLE IF EXISTS ticket_messages_archive;
DROP TABLE IF EXISTS tickets_archive;
DROP TABLE IF EXISTS kpi_selections;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS cancellation_requests;
DROP TABLE IF EXISTS ticket_messages;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS activities;
DROP TABLE IF EXISTS password_requests;
DROP TABLE IF EXISTS email_log;
DROP TABLE IF EXISTS ticket_events_archive;
DROP TABLE IF EXISTS ticket_attachments_archive;
DROP TABLE IF EXISTS kb_articles;
DROP TABLE IF EXISTS ticket_attachments;
DROP TABLE IF EXISTS ticket_events;
DROP TABLE IF EXISTS ticket_assignments;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS password_history;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  user_pk    INT AUTO_INCREMENT PRIMARY KEY,
  id_number  VARCHAR(32)  NOT NULL,
  password   VARCHAR(255) NOT NULL,
  name       VARCHAR(120) NOT NULL,
  role       VARCHAR(32)  NOT NULL,          -- student | staff | agent | admin | superadmin | report_viewer (read-only)
  role_name  VARCHAR(120) NOT NULL,
  email      VARCHAR(160) NULL,
  skills     VARCHAR(255) NOT NULL DEFAULT '',  -- comma-separated ticket categories an agent is recommended for
  failed_logins  INT NOT NULL DEFAULT 0,        -- wrong passwords in a row (5 = cooldown, 10 = lock)
  locked_until   DATETIME NULL,                 -- set while the account is locked
  mfa_enabled    TINYINT(1) NOT NULL DEFAULT 0, -- two-step verification (authenticator app)
  mfa_secret     VARCHAR(64) NULL,
  last_login_at  TIMESTAMP NULL,
  last_seen_at   TIMESTAMP NULL,                -- last API call by an agent/admin (presence for the assistant)
  phone          VARCHAR(32) NULL,              -- optional, for text-message alerts
  email_alerts   TINYINT(1) NOT NULL DEFAULT 1, -- 0 = no alert emails
  must_change_password TINYINT(1) NOT NULL DEFAULT 0, -- 1 = must choose a new password before doing anything else
  password_changed_at  TIMESTAMP NULL,           -- NULL = never changed since the account was seeded
  lock_level   TINYINT NOT NULL DEFAULT 0,       -- progressive lockout: how many times in a row the account was locked
  last_failed_at TIMESTAMP NULL,                 -- when the last wrong password was typed
  token_version INT NOT NULL DEFAULT 0,          -- raised on a password change: signs every other session out
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_role (id_number, role)
);

-- Campus locations: the source of truth for the Campus zone > Building > Room dropdown.
CREATE TABLE locations (
  location_id   INT AUTO_INCREMENT PRIMARY KEY,
  campus_zone   VARCHAR(80)  NOT NULL,
  building_name VARCHAR(120) NOT NULL,
  room_name     VARCHAR(120) NOT NULL,
  room_type     VARCHAR(40)  NOT NULL,
  UNIQUE KEY uq_location (campus_zone, building_name, room_name),
  KEY idx_location_zone (campus_zone, building_name)
);

CREATE TABLE tickets (
  ticket_pk   INT AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(16)  NOT NULL UNIQUE,  -- e.g. #HD001
  subject     VARCHAR(200) NOT NULL,
  category    VARCHAR(80)  NOT NULL,
  priority    VARCHAR(20)  NOT NULL,         -- Low | Medium | High
  status      VARCHAR(20)  NOT NULL DEFAULT 'Open', -- Open | In Progress | Resolved | Cancelled
  location    VARCHAR(160) NULL,
  description TEXT NULL,
  created_by  INT NULL,
  assigned_to INT NULL,                      -- agent assigned by an admin
  reopen_count INT NOT NULL DEFAULT 0,       -- times the requester reopened it after Resolved
  assigned_at TIMESTAMP NULL,                -- first time an admin assigned it (KPI: TTA, AHT)
  first_response_at TIMESTAMP NULL,          -- first IT reply or assignment (KPI: FRT)
  resolved_at TIMESTAMP NULL,                -- when it was marked Resolved (KPI: AHT, ART, SLA)
  csat_rating TINYINT NULL,                  -- 1-5 stars the requester gave via the assistant
  csat_at     TIMESTAMP NULL,
  location_id   INT NULL,                    -- structured location (replaces free-text entry)
  impact_level  ENUM('Organization', 'Department', 'Individual') NULL,  -- who is affected
  urgency_level ENUM('High', 'Medium', 'Low') NULL,                     -- when it is needed
  priority_tier ENUM('P1', 'P2', 'P3', 'P4') NULL,                      -- calculated by server/priority.js
  assignment_started_at TIMESTAMP NULL,      -- start of the current assignment (auto-assign expires it after 30 min)
  assigned_manually TINYINT(1) NOT NULL DEFAULT 0,  -- 1 = an admin assigned it, so it is never moved automatically
  auto_assign_count INT NOT NULL DEFAULT 0,  -- how many times the engine assigned or reassigned it
  client_token VARCHAR(64) NULL,            -- stops a double click or a retry from creating the request twice
  closed_at TIMESTAMP NULL,                  -- a resolved ticket is closed for good (no reopening) a few days later
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ticket_tier (priority_tier),
  UNIQUE KEY uq_ticket_token (client_token),
  KEY idx_ticket_status (status, ticket_pk),
  KEY idx_ticket_created (created_at),
  KEY idx_ticket_assigned (assigned_to, status),
  CONSTRAINT fk_ticket_user FOREIGN KEY (created_by)
    REFERENCES users(user_pk) ON DELETE SET NULL,
  CONSTRAINT fk_ticket_location FOREIGN KEY (location_id)
    REFERENCES locations(location_id) ON DELETE SET NULL
);

CREATE TABLE activities (
  activity_pk INT AUTO_INCREMENT PRIMARY KEY,
  actor_name  VARCHAR(120) NOT NULL,
  actor_role  VARCHAR(120) NOT NULL,
  action      VARCHAR(255) NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users file a "ticket" asking an admin to change their password. The admin
-- approves or declines it; on approval the account password is updated.
-- NOTE: new_password is stored in plaintext to match the users.password
-- prototype above. Hash it (bcrypt) before any real deployment.
CREATE TABLE password_requests (
  request_pk   INT AUTO_INCREMENT PRIMARY KEY,
  code         VARCHAR(16)  NOT NULL UNIQUE,      -- e.g. #PW001
  user_pk      INT          NOT NULL,
  new_password VARCHAR(255) NOT NULL,
  reason       VARCHAR(500) NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'Pending', -- Pending | Approved | Rejected
  review_note  VARCHAR(500) NULL,
  reviewed_by  INT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at  TIMESTAMP NULL,
  CONSTRAINT fk_pwreq_user FOREIGN KEY (user_pk)
    REFERENCES users(user_pk) ON DELETE CASCADE,
  CONSTRAINT fk_pwreq_reviewer FOREIGN KEY (reviewed_by)
    REFERENCES users(user_pk) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Seed data (mirrors the hardcoded values previously in App.jsx)
-- ---------------------------------------------------------------------------

-- The accounts are created by the server on the first start (server/seed.js): realistic IDs, random strong passwords.

INSERT INTO activities (actor_name, actor_role, action, created_at) VALUES
  ('System', 'System', 'Database initialized', '2026-08-30 10:30:00');

-- Extran agents with different skills, so recommendations are visible.







-- Who had each ticket and how it got to them (manual, auto, expired); used to rotate between specialists.
CREATE TABLE ticket_assignments (
  assignment_pk INT AUTO_INCREMENT PRIMARY KEY,
  ticket_pk     INT NOT NULL,
  agent_pk      INT NOT NULL,
  assigned_by   INT NULL,                        -- the admin, or NULL when the engine did it
  method        ENUM('manual', 'auto', 'expired') NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_assign_agent (agent_pk, created_at),
  KEY idx_assign_ticket (ticket_pk),
  CONSTRAINT fk_assign_ticket FOREIGN KEY (ticket_pk) REFERENCES tickets(ticket_pk) ON DELETE CASCADE,
  CONSTRAINT fk_assign_agent FOREIGN KEY (agent_pk) REFERENCES users(user_pk) ON DELETE CASCADE,
  CONSTRAINT fk_assign_by FOREIGN KEY (assigned_by) REFERENCES users(user_pk) ON DELETE SET NULL
);

-- Rooms offered in the ticket form.
INSERT INTO locations (campus_zone, building_name, room_name, room_type) VALUES
  ('Main Campus', 'Administration Building', 'Registrar''s Office', 'Office'),
  ('Main Campus', 'Administration Building', 'Dean''s Office', 'Office'),
  ('Main Campus', 'Administration Building', 'Faculty Room', 'Office'),
  ('Main Campus', 'Library', 'Reading Hall', 'Library'),
  ('Main Campus', 'Library', 'Computer Section', 'Computer Lab'),
  ('Academic Zone', 'IT Building', 'Computer Laboratory 1', 'Computer Lab'),
  ('Academic Zone', 'IT Building', 'Computer Laboratory 2', 'Computer Lab'),
  ('Academic Zone', 'IT Building', 'Computer Laboratory 3', 'Computer Lab'),
  ('Academic Zone', 'IT Building', 'Server Room', 'Server Room'),
  ('Academic Zone', 'IT Building', 'Lecture Room 201', 'Classroom'),
  ('Academic Zone', 'Science Building', 'Chemistry Laboratory', 'Laboratory'),
  ('Academic Zone', 'Science Building', 'Physics Laboratory', 'Laboratory'),
  ('Academic Zone', 'Science Building', 'Lecture Room 101', 'Classroom'),
  ('Academic Zone', 'Engineering Building', 'Drafting Room', 'Laboratory'),
  ('Academic Zone', 'Engineering Building', 'Engineering Laboratory', 'Laboratory'),
  ('Academic Zone', 'Engineering Building', 'Lecture Room 301', 'Classroom'),
  ('Student Services Zone', 'Student Center', 'Student Lounge', 'Common Area'),
  ('Student Services Zone', 'Student Center', 'Cafeteria', 'Common Area'),
  ('Student Services Zone', 'Student Center', 'Clinic', 'Office'),
  ('Student Services Zone', 'Gymnasium', 'Main Court', 'Common Area'),
  ('Student Services Zone', 'Gymnasium', 'Auditorium', 'Auditorium');

-- Instant messages between admins and agents (chat dock).
CREATE TABLE messages (
  message_pk   INT AUTO_INCREMENT PRIMARY KEY,
  sender_pk    INT NOT NULL,
  recipient_pk INT NOT NULL,
  body         VARCHAR(1000) NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  read_at      TIMESTAMP NULL,
  KEY idx_msg_pair (sender_pk, recipient_pk),
  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_pk) REFERENCES users(user_pk) ON DELETE CASCADE,
  CONSTRAINT fk_msg_recipient FOREIGN KEY (recipient_pk) REFERENCES users(user_pk) ON DELETE CASCADE
);

-- Per-ticket conversation between the requester and staff. The same table holds
-- general chat (kind = 'chat') and cancellation requests for tickets that are
-- already In Progress (kind = 'cancellation_request').
CREATE TABLE ticket_messages (
  message_pk   INT AUTO_INCREMENT PRIMARY KEY,
  ticket_pk    INT NOT NULL,
  sender_pk    INT NOT NULL,
  message_text VARCHAR(1000) NOT NULL,
  kind         VARCHAR(24)   NOT NULL DEFAULT 'chat',  -- chat | cancellation_request | cancellation_decision | reopen | assignment | bot | bot_choice | bot_note
  meta         TEXT NULL,                              -- JSON quick-reply options on assistant messages
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ticket_msg (ticket_pk, message_pk),
  CONSTRAINT fk_tmsg_ticket FOREIGN KEY (ticket_pk) REFERENCES tickets(ticket_pk) ON DELETE CASCADE,
  CONSTRAINT fk_tmsg_sender FOREIGN KEY (sender_pk) REFERENCES users(user_pk) ON DELETE CASCADE
);

-- Requesters cannot cancel directly; they file a request an admin approves or rejects.
CREATE TABLE cancellation_requests (
  request_pk   INT AUTO_INCREMENT PRIMARY KEY,
  code         VARCHAR(16)  NOT NULL UNIQUE,      -- e.g. #CR001
  ticket_pk    INT NOT NULL,
  requested_by INT NOT NULL,
  reason       VARCHAR(500) NOT NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'Pending', -- Pending | Approved | Rejected
  review_note  VARCHAR(500) NULL,
  reviewed_by  INT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at  TIMESTAMP NULL,
  CONSTRAINT fk_cr_ticket FOREIGN KEY (ticket_pk) REFERENCES tickets(ticket_pk) ON DELETE CASCADE,
  CONSTRAINT fk_cr_requester FOREIGN KEY (requested_by) REFERENCES users(user_pk) ON DELETE CASCADE,
  CONSTRAINT fk_cr_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(user_pk) ON DELETE SET NULL
);

-- In-app notifications (ticket updates, assignments, cancellation decisions, ...).
CREATE TABLE notifications (
  notification_pk INT AUTO_INCREMENT PRIMARY KEY,
  user_pk         INT NOT NULL,
  type            VARCHAR(32)  NOT NULL,
  title           VARCHAR(160) NOT NULL,
  body            VARCHAR(400) NOT NULL,
  ticket_code     VARCHAR(16)  NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  read_at         TIMESTAMP NULL,
  KEY idx_notif_user (user_pk, notification_pk),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_pk) REFERENCES users(user_pk) ON DELETE CASCADE
);

-- Which KPI metrics (and targets) the super admin chose to show for each month.
-- A month with no rows inherits the latest earlier month's choice.
CREATE TABLE kpi_selections (
  month      CHAR(7)      NOT NULL,              -- e.g. 2026-10
  metric_key VARCHAR(16)  NOT NULL,              -- see server/kpiCatalog.js
  target     DECIMAL(10,2) NULL,                 -- NULL = use the catalog default
  position   INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (month, metric_key)
);

-- Data archiving (see server/migrations/2026-10-enterprise.sql for the explanation).
-- Same structure as the live tables; if you add a column to one of them, add it here too.
CREATE TABLE tickets_archive LIKE tickets;
CREATE TABLE ticket_messages_archive LIKE ticket_messages;
CREATE TABLE cancellation_requests_archive LIKE cancellation_requests;

CREATE TABLE archive_runs (
  run_pk        INT AUTO_INCREMENT PRIMARY KEY,
  run_by        INT NULL,
  before_date   DATE NOT NULL,
  ticket_count  INT NOT NULL,
  message_count INT NOT NULL,
  request_count INT NOT NULL,
  json_file     VARCHAR(255) NOT NULL,
  csv_file      VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_archive_run_user FOREIGN KEY (run_by) REFERENCES users(user_pk) ON DELETE SET NULL
);

-- Live + archived tickets together, for reports and KPIs, so archiving does not change history.
-- If you ever add a column to tickets, add it to tickets_archive AND re-run this statement
-- (views expand SELECT * when they are created).
CREATE OR REPLACE VIEW tickets_all AS
  SELECT * FROM tickets
  UNION ALL
  SELECT * FROM tickets_archive;

-- Email alerts: a switch and an optional phone number per person, and a log of what was sent.
CREATE TABLE IF NOT EXISTS email_log (
  log_pk     INT AUTO_INCREMENT PRIMARY KEY,
  user_pk    INT NULL,
  to_email   VARCHAR(160) NOT NULL,
  subject    VARCHAR(200) NOT NULL,
  status     VARCHAR(12)  NOT NULL,   -- sent | failed | logged
  detail     VARCHAR(300) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_email_created (created_at)
);

-- Who changed what on a ticket.
CREATE TABLE ticket_events (
  event_pk    INT AUTO_INCREMENT PRIMARY KEY,
  ticket_pk   INT NOT NULL,
  actor_pk    INT NULL,
  actor_name  VARCHAR(120) NOT NULL,
  actor_role  VARCHAR(120) NOT NULL,
  action      VARCHAR(40)  NOT NULL,
  detail      VARCHAR(500) NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_event_ticket (ticket_pk, event_pk),
  CONSTRAINT fk_event_ticket FOREIGN KEY (ticket_pk) REFERENCES tickets(ticket_pk) ON DELETE CASCADE
);

-- Photos added to a ticket (the files live in server/uploads).
CREATE TABLE ticket_attachments (
  attachment_pk INT AUTO_INCREMENT PRIMARY KEY,
  ticket_pk     INT NOT NULL,
  uploaded_by   INT NULL,
  original_name VARCHAR(160) NOT NULL,
  stored_name   VARCHAR(80)  NOT NULL,
  mime          VARCHAR(40)  NOT NULL,
  size_bytes    INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_attach_ticket (ticket_pk),
  CONSTRAINT fk_attach_ticket FOREIGN KEY (ticket_pk) REFERENCES tickets(ticket_pk) ON DELETE CASCADE
);

-- Archiving moves history and attachment records along with the ticket.
CREATE TABLE ticket_events_archive LIKE ticket_events;
CREATE TABLE ticket_attachments_archive LIKE ticket_attachments;

-- Help articles admins write; the chatbot and the Help articles page use them.
CREATE TABLE kb_articles (
  article_pk   INT AUTO_INCREMENT PRIMARY KEY,
  title        VARCHAR(160) NOT NULL,
  category     VARCHAR(80)  NOT NULL DEFAULT 'General',
  summary      VARCHAR(300) NOT NULL DEFAULT '',
  body         TEXT NOT NULL,
  keywords     VARCHAR(300) NOT NULL DEFAULT '',
  published    TINYINT(1) NOT NULL DEFAULT 1,
  views        INT NOT NULL DEFAULT 0,
  helpful_yes  INT NOT NULL DEFAULT 0,
  helpful_no   INT NOT NULL DEFAULT 0,
  created_by   INT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_kb_category (category, published),
  CONSTRAINT fk_kb_author FOREIGN KEY (created_by) REFERENCES users(user_pk) ON DELETE SET NULL
);

INSERT INTO kb_articles (title, category, summary, body, keywords)
SELECT * FROM (
  SELECT 'Cannot connect to campus Wi-Fi' AS title, 'Network / Internet' AS category,
    'Forget the network, reconnect and check your device.' AS summary,
    'Try these steps in order:\n1. Turn Wi-Fi off and on, or switch Airplane mode on and off.\n2. Forget the campus network, then connect again and re-enter your login.\n3. Restart your device and check whether other devices can connect.\n4. Move closer to the access point.\n\nIf it still fails, submit a request and tell us the room and the exact message you see.' AS body,
    'wifi wi-fi wireless internet network connect connection' AS keywords
  UNION ALL SELECT 'Printer will not print', 'Printer', 'Check power and paper, clear the queue and restart the printer.',
    'Try these steps in order:\n1. Check the printer is on and online, with paper and ink or toner and no error light.\n2. Clear stuck jobs: Settings > Printers > your printer > Open queue > Cancel all documents.\n3. Turn the printer off for 30 seconds and back on.\n4. Make sure it is chosen as your default printer.\n\nStill stuck? Submit a request with the printer name or the number on its label.',
    'printer print printing paper jam toner ink queue'
  UNION ALL SELECT 'I forgot my password', 'Account / Login', 'How to get back into your account.',
    'Sign in problems:\n1. Check Caps Lock is off and that you picked the right role on the sign-in page.\n2. After 5 wrong tries the page asks you to wait 10 seconds, and then offers Forgot password.\n3. Automatic reset by email is coming in the next version. Until then, sign in with your current password and open your profile to send a password change request, which an admin approves.\n4. If your account is locked, wait 15 minutes or ask the super admin to unlock it.\n\nNever share your password with anyone, including IT staff.',
    'password forgot reset login sign in locked account'
  UNION ALL SELECT 'My computer is slow or freezing', 'Hardware', 'Free up memory and restart before calling for help.',
    'Quick fixes:\n1. Save your work and restart the computer.\n2. Close programs you are not using (Ctrl + Shift + Esc opens Task Manager).\n3. Check that the disk is not almost full (File Explorer > This PC).\n4. Install pending Windows updates and restart again.\n\nIf it is still slow after a restart, submit a request so an agent can check the hardware.',
    'slow freeze freezing lag hang computer pc laptop restart'
  UNION ALL SELECT 'Monitor or projector shows no picture', 'Hardware', 'Check cables and input, then refresh the display.',
    'Try these steps:\n1. Make sure the device is on and the cable (HDMI, VGA, DisplayPort) is firmly plugged in at both ends.\n2. Choose the right input on the monitor or projector.\n3. Press Windows + P and pick Duplicate or Extend; press Windows + Ctrl + Shift + B to refresh the display.\n4. Try another cable or port.\n\nFor a classroom projector before a class, submit a request and choose Right now for a live class so it is handled first.',
    'monitor projector screen display hdmi vga blank black no signal'
  UNION ALL SELECT 'Microsoft 365 keeps asking me to sign in', 'Software', 'Sign out of every Office app and sign in again.',
    'Steps:\n1. In any Office app choose File > Account > Sign out, then close all Office apps.\n2. Open an app again and sign in with your campus email.\n3. On Windows open Credential Manager and remove old Microsoft Office entries, then sign in again.\n4. Check your password has not expired.\n\nIf you see an error code, include it in your request.',
    'office microsoft 365 word excel teams outlook sign in login software'
  UNION ALL SELECT 'How tickets are prioritised and assigned', 'General', 'What P1 to P4 mean and when an agent is assigned.',
    'When you submit a request you tell us who is affected and when you need it. We turn that into a priority from P1 (most urgent) to P4. Words such as exam, graduation, lecture or dean raise the priority one level.\n\nAn admin can assign an agent at any time. If nobody has picked a ticket up after 30 minutes it goes automatically to an agent who specialises in that kind of problem, and if the agent has not resolved it after 30 minutes it moves to another specialist.\n\nOnce a ticket is resolved you have a few days to reopen it if the problem is still there, then it is closed for good.',
    'priority p1 p2 p3 p4 urgent assign agent how long ticket sla'
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM kb_articles);

-- The last few password hashes of each person, so a password cannot be reused.
CREATE TABLE password_history (
  history_pk    INT AUTO_INCREMENT PRIMARY KEY,
  user_pk       INT NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pwhist_user (user_pk, history_pk),
  CONSTRAINT fk_pwhist_user FOREIGN KEY (user_pk) REFERENCES users(user_pk) ON DELETE CASCADE
);
