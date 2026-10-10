# Report Manager metrics and ERD

## What appears in the Report Manager

The Report Manager (Super Admin and Report Viewer) shows three things, top to bottom.

### 1. The chosen KPIs (the highlighted cards)

The super admin picks which metrics show for each month with **Choose KPIs**. Until a choice is saved, these **6 default KPIs** appear:

| Key | KPI | Unit | Better when | Target | What it measures |
|-----|-----|------|-------------|--------|------------------|
| AHT | Average Handling Time | minutes | lower | 480 | Time from assignment to resolved |
| FRT | First Response Time | minutes | lower | 30 | Time until IT first replies or assigns |
| SLA | SLA Compliance | % | higher | 90 | Tickets resolved within the priority's target (High 4 h, Medium 8 h, Low 24 h) |
| FCR | First-Time Fix Rate | % | higher | 90 | Resolved tickets that were never reopened |
| RR | Resolution Rate | % | higher | 85 | Tickets resolved out of those submitted |
| BKL | Open Backlog | count | lower | 10 | Tickets still Open or In Progress |

The other 9 metrics can be switched on in the picker: ART (Average Resolution Time), TTA (Time to Assign), REO (Reopen Rate), HPR (High-Priority Resolution Rate), SKM (Skill Match Rate), VOL (Ticket Volume), CAN (Cancellation Rate), AGE (Backlog Age), TPT (Tickets Resolved per Technician). Formulas: [KPI-METRICS.md](KPI-METRICS.md) and `server/kpiCatalog.js`.

Below the cards is the **KPI trend** chart: any chosen KPI over six months, with its target as a dashed line.

### 2. The detailed charts (follow the date, category and role filters)

| Report | Chart type |
|--------|-----------|
| Ticket volume over time | Line, per day |
| Tickets by status | Donut |
| Tickets by priority | Bar |
| Tickets by category | Bar |
| Requests by requester role | Bar |
| Campus location map | Heat map of where requests come from |
| Registered users by role | Bar (not affected by filters) |

### 3. Export

CSV export of the filtered data and the KPI values.

## ERD

```mermaid
erDiagram
    USERS ||--o{ TICKETS : "submits (created_by)"
    USERS ||--o{ TICKETS : "is assigned (assigned_to)"
    USERS ||--o{ TICKET_MESSAGES : sends
    TICKETS ||--o{ TICKET_MESSAGES : has
    USERS ||--o{ CANCELLATION_REQUESTS : "requests (requested_by)"
    USERS |o--o{ CANCELLATION_REQUESTS : "reviews (reviewed_by)"
    TICKETS ||--o{ CANCELLATION_REQUESTS : has
    USERS ||--o{ PASSWORD_REQUESTS : files
    USERS |o--o{ PASSWORD_REQUESTS : "reviews (reviewed_by)"
    USERS ||--o{ NOTIFICATIONS : receives
    USERS ||--o{ MESSAGES : "sends (chat dock)"
    USERS ||--o{ MESSAGES : "receives (chat dock)"
    USERS |o--o{ ARCHIVE_RUNS : "runs (run_by)"
    TICKETS ||--o| TICKETS_ARCHIVE : "moved to when archived"

    USERS {
        int user_pk PK
        varchar id_number
        varchar password "scrypt hash"
        varchar name
        varchar role "student employee technician admin superadmin report_viewer bot"
        varchar role_name
        varchar email
        varchar skills "technician categories"
        int failed_logins
        datetime locked_until
        tinyint mfa_enabled
        varchar mfa_secret
        timestamp last_login_at
        timestamp last_seen_at "presence"
    }
    TICKETS {
        int ticket_pk PK
        varchar code UK "#HD001"
        varchar subject
        varchar category
        varchar priority
        varchar status
        varchar location
        text description
        int created_by FK
        int assigned_to FK
        int reopen_count
        timestamp assigned_at "KPI"
        timestamp first_response_at "KPI"
        timestamp resolved_at "KPI"
        tinyint csat_rating "1-5"
        timestamp created_at
    }
    TICKET_MESSAGES {
        int message_pk PK
        int ticket_pk FK
        int sender_pk FK
        varchar message_text
        varchar kind "chat cancellation_request cancellation_decision reopen bot bot_choice bot_note"
        text meta "bot quick replies"
        timestamp created_at
    }
    CANCELLATION_REQUESTS {
        int request_pk PK
        varchar code UK "#CR001"
        int ticket_pk FK
        int requested_by FK
        varchar reason
        varchar status "Pending Approved Rejected"
        int reviewed_by FK
        timestamp reviewed_at
    }
    PASSWORD_REQUESTS {
        int request_pk PK
        varchar code UK "#PW001"
        int user_pk FK
        varchar status
        int reviewed_by FK
    }
    NOTIFICATIONS {
        int notification_pk PK
        int user_pk FK
        varchar type
        varchar title
        varchar ticket_code
        timestamp read_at
    }
    MESSAGES {
        int message_pk PK
        int sender_pk FK
        int recipient_pk FK
        varchar body
        timestamp read_at
    }
    ACTIVITIES {
        int activity_pk PK
        varchar actor_name
        varchar actor_role
        varchar action
        timestamp created_at
    }
    KPI_SELECTIONS {
        char month PK "2026-10"
        varchar metric_key PK "AHT FRT SLA ..."
        decimal target
        int position
    }
    ARCHIVE_RUNS {
        int run_pk PK
        int run_by FK
        date before_date
        int ticket_count
        varchar json_file
        varchar csv_file
    }
    TICKETS_ARCHIVE {
        int ticket_pk PK "same columns as TICKETS"
    }
```

Notes:
- `TICKET_MESSAGES_ARCHIVE` and `CANCELLATION_REQUESTS_ARCHIVE` mirror their live tables (left out of the diagram for readability). The view `tickets_all` joins live and archived tickets, so reports and KPIs never change when tickets are archived.
- `ACTIVITIES` (the activity log) and `KPI_SELECTIONS` (which KPIs show per month) are standalone: they store names and keys, not foreign keys.
- Tickets created by the HelpDesk Assistant reuse `TICKET_MESSAGES` (sender is the `bot` user).
