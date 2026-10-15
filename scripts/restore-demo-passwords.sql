-- Run this ONCE on a database that was upgraded by the (now rolled back) password-policy version.
-- That version replaced the shared demo passwords with random ones in a hash format the older code cannot read.
-- This puts the original shared demo passwords back (the older code upgrades them to hashes at the first sign-in).
-- It only touches the seeded demo accounts (IDs 2404154, 2404155, 2404156), never accounts created by people.
--
--   mysql -h HOST -P PORT -u USER -p --ssl DATABASE < scripts/restore-demo-passwords.sql
--
-- (On TiDB / Render, run the same statements in the database console of your provider.)
UPDATE users SET password = '123456student',    failed_logins = 0, locked_until = NULL WHERE id_number = '2404154' AND role = 'student';
UPDATE users SET password = '123456employee',   failed_logins = 0, locked_until = NULL WHERE id_number = '2404154' AND role = 'staff';
UPDATE users SET password = '123456technician', failed_logins = 0, locked_until = NULL WHERE id_number IN ('2404154', '2404155', '2404156') AND role = 'agent';
UPDATE users SET password = '123456admin',      failed_logins = 0, locked_until = NULL WHERE id_number = '2404154' AND role = 'admin';
UPDATE users SET password = '123456superadmin', failed_logins = 0, locked_until = NULL WHERE id_number = '2404154' AND role = 'superadmin';
UPDATE users SET password = '123456viewer',     failed_logins = 0, locked_until = NULL WHERE id_number = '2404154' AND role = 'report_viewer';
-- The leftover columns and the password_history table of the rolled back version are harmless; leave them.
