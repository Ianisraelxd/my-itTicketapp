-- Priority automation (P1-P4), structured locations and queue-safe cancellation.
-- Run once on an existing database (schema.sql already contains all of this).

-- 1. Source of truth for the cascading Campus zone > Building > Room dropdown.
CREATE TABLE IF NOT EXISTS locations (
  location_id   INT AUTO_INCREMENT PRIMARY KEY,
  campus_zone   VARCHAR(80)  NOT NULL,
  building_name VARCHAR(120) NOT NULL,
  room_name     VARCHAR(120) NOT NULL,
  room_type     VARCHAR(40)  NOT NULL,
  UNIQUE KEY uq_location (campus_zone, building_name, room_name),
  KEY idx_location_zone (campus_zone, building_name)
);

INSERT IGNORE INTO locations (campus_zone, building_name, room_name, room_type) VALUES
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

-- 2. Tickets: structured location, intake answers and the calculated tier.
--    The old free-text `location` column stays as a read-only snapshot of the chosen
--    room's name (reports and the heat map group by it, and old tickets keep their text).
ALTER TABLE tickets ADD COLUMN location_id    INT NULL;
ALTER TABLE tickets ADD COLUMN impact_level   ENUM('Organization', 'Department', 'Individual') NULL;
ALTER TABLE tickets ADD COLUMN urgency_level  ENUM('High', 'Medium', 'Low') NULL;
ALTER TABLE tickets ADD COLUMN priority_tier  ENUM('P1', 'P2', 'P3', 'P4') NULL;
ALTER TABLE tickets ADD KEY idx_ticket_tier (priority_tier);
ALTER TABLE tickets ADD CONSTRAINT fk_ticket_location FOREIGN KEY (location_id) REFERENCES locations(location_id) ON DELETE SET NULL;

-- The archive table must have the same columns in the same order (no foreign key needed).
ALTER TABLE tickets_archive ADD COLUMN location_id    INT NULL;
ALTER TABLE tickets_archive ADD COLUMN impact_level   ENUM('Organization', 'Department', 'Individual') NULL;
ALTER TABLE tickets_archive ADD COLUMN urgency_level  ENUM('High', 'Medium', 'Low') NULL;
ALTER TABLE tickets_archive ADD COLUMN priority_tier  ENUM('P1', 'P2', 'P3', 'P4') NULL;

-- tickets_all selects *, so re-create it to pick up the new columns.
CREATE OR REPLACE VIEW tickets_all AS
  SELECT * FROM tickets
  UNION ALL
  SELECT * FROM tickets_archive;
