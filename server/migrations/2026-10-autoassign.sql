-- Auto-assignment with a 30-minute expiry. Run once on an existing database.

ALTER TABLE tickets ADD COLUMN assignment_started_at TIMESTAMP NULL;
ALTER TABLE tickets ADD COLUMN assigned_manually TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN auto_assign_count INT NOT NULL DEFAULT 0;

ALTER TABLE tickets_archive ADD COLUMN assignment_started_at TIMESTAMP NULL;
ALTER TABLE tickets_archive ADD COLUMN assigned_manually TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE tickets_archive ADD COLUMN auto_assign_count INT NOT NULL DEFAULT 0;

-- Tickets an admin already assigned stay with that agent (they are "pinned").
UPDATE tickets SET assigned_manually = 1, assignment_started_at = COALESCE(assigned_at, created_at)
WHERE assigned_to IS NOT NULL;

CREATE TABLE IF NOT EXISTS ticket_assignments (
  assignment_pk INT AUTO_INCREMENT PRIMARY KEY,
  ticket_pk     INT NOT NULL,
  agent_pk      INT NOT NULL,
  assigned_by   INT NULL,
  method        ENUM('manual', 'auto', 'expired') NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_assign_agent (agent_pk, created_at),
  KEY idx_assign_ticket (ticket_pk),
  CONSTRAINT fk_assign_ticket FOREIGN KEY (ticket_pk) REFERENCES tickets(ticket_pk) ON DELETE CASCADE,
  CONSTRAINT fk_assign_agent FOREIGN KEY (agent_pk) REFERENCES users(user_pk) ON DELETE CASCADE,
  CONSTRAINT fk_assign_by FOREIGN KEY (assigned_by) REFERENCES users(user_pk) ON DELETE SET NULL
);

-- tickets_all selects *, so re-create it to pick up the new columns.
CREATE OR REPLACE VIEW tickets_all AS
  SELECT * FROM tickets
  UNION ALL
  SELECT * FROM tickets_archive;
