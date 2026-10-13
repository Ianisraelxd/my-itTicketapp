-- Indexes for the status filters, KPI date ranges and agent workload counts. Run once on an existing database.
ALTER TABLE tickets ADD KEY idx_ticket_status (status, ticket_pk);
ALTER TABLE tickets ADD KEY idx_ticket_created (created_at);
ALTER TABLE tickets ADD KEY idx_ticket_assigned (assigned_to, status);
