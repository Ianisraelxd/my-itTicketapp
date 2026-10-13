-- Photo attachments, ticket history (audit), knowledge base and auto-closing of resolved tickets.
-- Run once on an existing database (the server does this by itself at startup).

-- A resolved ticket is closed for good a few days later (closed_at). It stays "Resolved" so reports
-- and KPIs do not change, but it can no longer be reopened.
ALTER TABLE tickets ADD COLUMN closed_at TIMESTAMP NULL;
ALTER TABLE tickets_archive ADD COLUMN closed_at TIMESTAMP NULL;

ALTER TABLE users ADD COLUMN phone VARCHAR(32) NULL;
ALTER TABLE users ADD COLUMN email_alerts TINYINT(1) NOT NULL DEFAULT 1;

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
CREATE TABLE IF NOT EXISTS ticket_events (
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
CREATE TABLE IF NOT EXISTS ticket_attachments (
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
CREATE TABLE IF NOT EXISTS ticket_events_archive LIKE ticket_events;
CREATE TABLE IF NOT EXISTS ticket_attachments_archive LIKE ticket_attachments;

-- Help articles admins write; the chatbot and the Help articles page use them.
CREATE TABLE IF NOT EXISTS kb_articles (
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

-- tickets_all selects *, so re-create it to pick up the new column.
CREATE OR REPLACE VIEW tickets_all AS
  SELECT * FROM tickets
  UNION ALL
  SELECT * FROM tickets_archive;
