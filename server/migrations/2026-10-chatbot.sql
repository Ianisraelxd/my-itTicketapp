-- HelpDesk Assistant (ticket chatbot). Run once on an existing database.
-- The assistant user is also created automatically by the API if it is missing.

-- Presence: technicians/admins who made an API call in the last 90 seconds count as available.
ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMP NULL;

ALTER TABLE tickets ADD COLUMN csat_rating TINYINT NULL, ADD COLUMN csat_at TIMESTAMP NULL;
ALTER TABLE tickets_archive ADD COLUMN csat_rating TINYINT NULL, ADD COLUMN csat_at TIMESTAMP NULL;

ALTER TABLE ticket_messages ADD COLUMN meta TEXT NULL;
ALTER TABLE ticket_messages_archive ADD COLUMN meta TEXT NULL;

INSERT INTO users (id_number, password, name, role, role_name, email)
SELECT 'assistant', 'scrypt$locked$locked', 'HelpDesk Assistant', 'bot', 'Assistant Bot', NULL
WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'bot');

-- tickets_all selects *, so re-create it to pick up the new columns.
CREATE OR REPLACE VIEW tickets_all AS
  SELECT * FROM tickets
  UNION ALL
  SELECT * FROM tickets_archive;
