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
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  user_pk    INT AUTO_INCREMENT PRIMARY KEY,
  id_number  VARCHAR(32)  NOT NULL,
  password   VARCHAR(255) NOT NULL,
  name       VARCHAR(120) NOT NULL,
  role       VARCHAR(32)  NOT NULL,          -- student | employee | technician | admin | superadmin | report_viewer (read-only)
  role_name  VARCHAR(120) NOT NULL,
  email      VARCHAR(160) NULL,
  skills     VARCHAR(255) NOT NULL DEFAULT '',  -- comma-separated ticket categories a technician is recommended for
  failed_logins  INT NOT NULL DEFAULT 0,        -- wrong passwords in a row (5 locks the account)
  locked_until   DATETIME NULL,                 -- set while the account is locked
  mfa_enabled    TINYINT(1) NOT NULL DEFAULT 0, -- two-step verification (authenticator app)
  mfa_secret     VARCHAR(64) NULL,
  last_login_at  TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_role (id_number, role)
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
  assigned_to INT NULL,                      -- technician assigned by an admin
  reopen_count INT NOT NULL DEFAULT 0,       -- times the requester reopened it after Resolved
  assigned_at TIMESTAMP NULL,                -- first time an admin assigned it (KPI: TTA, AHT)
  first_response_at TIMESTAMP NULL,          -- first IT reply or assignment (KPI: FRT)
  resolved_at TIMESTAMP NULL,                -- when it was marked Resolved (KPI: AHT, ART, SLA)
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ticket_user FOREIGN KEY (created_by)
    REFERENCES users(user_pk) ON DELETE SET NULL
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

INSERT INTO users (id_number, password, name, role, role_name, email) VALUES
  ('2404154', '123456student',    'Student User', 'student',    'Student',                    'student@campus.edu'),
  ('2404154', '123456employee',   'Employee User','employee',   'Employee',                   'employee@campus.edu'),
  ('2404154', '123456technician', 'Technician User','technician','Technician',                'technician@campus.edu'),
  ('2404154', '123456admin',      'Users Admin',  'admin',      'Student / Employee Admin',   'admin@campus.edu'),
  ('2404154', '123456superadmin', 'Super Admin',  'superadmin', 'Super Admin',                'superadmin@campus.edu');

INSERT INTO activities (actor_name, actor_role, action, created_at) VALUES
  ('System', 'System', 'Database initialized', '2026-08-30 10:30:00');

-- Extra technicians with different skills, so recommendations are visible.
INSERT INTO users (id_number, password, name, role, role_name, email, skills) VALUES
  ('2404155', '123456technician', 'Software Technician', 'technician', 'Technician', 'software.tech@campus.edu', 'Software,Account / Login'),
  ('2404156', '123456technician', 'Network Technician',  'technician', 'Technician', 'network.tech@campus.edu',  'Network / Internet');
UPDATE users SET skills = 'Hardware,Printer' WHERE id_number = '2404154' AND role = 'technician';

-- Read-only account for dashboards (kept after the technicians so existing user ids stay the same).
INSERT INTO users (id_number, password, name, role, role_name, email) VALUES
  ('2404154', '123456viewer', 'Report Viewer', 'report_viewer', 'Report Viewer', 'viewer@campus.edu');

-- Instant messages between admins and technicians (chat dock).
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
  kind         VARCHAR(24)   NOT NULL DEFAULT 'chat',  -- chat | cancellation_request | cancellation_decision | reopen
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
