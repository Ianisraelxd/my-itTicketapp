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
DROP TABLE IF EXISTS activities;
DROP TABLE IF EXISTS password_requests;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  user_pk    INT AUTO_INCREMENT PRIMARY KEY,
  id_number  VARCHAR(32)  NOT NULL,
  password   VARCHAR(255) NOT NULL,
  name       VARCHAR(120) NOT NULL,
  role       VARCHAR(32)  NOT NULL,          -- student | employee | technician | admin | superadmin
  role_name  VARCHAR(120) NOT NULL,
  email      VARCHAR(160) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_role (id_number, role)
);

CREATE TABLE tickets (
  ticket_pk   INT AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(16)  NOT NULL UNIQUE,  -- e.g. #HD001
  subject     VARCHAR(200) NOT NULL,
  category    VARCHAR(80)  NOT NULL,
  priority    VARCHAR(20)  NOT NULL,         -- Low | Medium | High
  status      VARCHAR(20)  NOT NULL DEFAULT 'Open', -- Open | In Progress | Resolved
  location    VARCHAR(160) NULL,
  description TEXT NULL,
  created_by  INT NULL,
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
