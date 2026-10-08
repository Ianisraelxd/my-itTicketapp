-- Enterprise Super Admin controls: archiving, read-only Report Viewer role,
-- account lockout and two-step verification.
-- Run once on an existing database:  mysql -u root helpdesk < server/migrations/2026-10-enterprise.sql
-- (A fresh `npm run db:init` already includes all of this through server/schema.sql.)

-- 1. Data archiving -----------------------------------------------------------------
-- Same columns and indexes as the live tables (CREATE TABLE ... LIKE copies the
-- structure, not the foreign keys), so `INSERT ... SELECT *` can move rows as they are.
-- Remember: if you ever add a column to tickets / ticket_messages /
-- cancellation_requests, add it to the matching *_archive table too.
CREATE TABLE IF NOT EXISTS tickets_archive LIKE tickets;
CREATE TABLE IF NOT EXISTS ticket_messages_archive LIKE ticket_messages;
CREATE TABLE IF NOT EXISTS cancellation_requests_archive LIKE cancellation_requests;

-- One row per "Mass Export & Archive" run (who, what cut-off, how much, which export files).
CREATE TABLE IF NOT EXISTS archive_runs (
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

-- 2. Role segregation + account security ---------------------------------------------
-- users.role is a VARCHAR(32), not an ENUM, so the new 'report_viewer' role needs no
-- ALTER: it is simply a new value. Read-only is enforced by the API (verifyReportViewer).
ALTER TABLE users
  ADD COLUMN failed_logins  INT NOT NULL DEFAULT 0,
  ADD COLUMN locked_until   DATETIME NULL,
  ADD COLUMN mfa_enabled    TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN mfa_secret     VARCHAR(64) NULL,
  ADD COLUMN last_login_at  TIMESTAMP NULL;

-- 3. Demo Report Viewer account (ID 2404154, password 123456viewer) -------------------
INSERT INTO users (id_number, password, name, role, role_name, email) VALUES
  ('2404154', '123456viewer', 'Report Viewer', 'report_viewer', 'Report Viewer', 'viewer@campus.edu');
