-- Role rename: Employee -> University Staff (role key `staff`), Technician -> Agent (role key `agent`).
-- Run once on an existing database. Passwords are not touched, so existing logins keep working.

UPDATE users SET role = 'staff', role_name = 'University Staff' WHERE role = 'employee';
UPDATE users SET role = 'agent', role_name = 'Agent' WHERE role = 'technician';
UPDATE users SET role_name = REPLACE(role_name, 'Employee', 'Staff') WHERE role = 'admin';

-- Keep the activity log and old notification text readable.
UPDATE activities SET actor_role = 'University Staff' WHERE actor_role = 'Employee';
UPDATE activities SET actor_role = 'Agent' WHERE actor_role = 'Technician';
UPDATE activities SET actor_role = REPLACE(actor_role, 'Employee', 'Staff') WHERE actor_role LIKE '%Employee%';
