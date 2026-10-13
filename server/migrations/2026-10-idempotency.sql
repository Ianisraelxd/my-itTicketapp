-- A request can carry a one-time token so that a double click, a slow connection or a retry creates it only once.
ALTER TABLE tickets ADD COLUMN client_token VARCHAR(64) NULL, ADD UNIQUE KEY uq_ticket_token (client_token);
ALTER TABLE tickets_archive ADD COLUMN client_token VARCHAR(64) NULL;

-- tickets_all selects *, so re-create it to pick up the new column.
CREATE OR REPLACE VIEW tickets_all AS
  SELECT * FROM tickets
  UNION ALL
  SELECT * FROM tickets_archive;
