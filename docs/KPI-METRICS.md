# KPI metrics

The super admin dashboard has a **Monthly KPI Scorecard**. The system can calculate **15 metrics** from ticket data; each month the super admin picks the ones that matter for the company (and sets their targets) with **Choose KPIs**, and only those appear on the dashboard.

![Monthly KPI scorecard](screenshots/26-superadmin-dashboard.png)

## How the monthly selection works

- Use the **month picker** on the scorecard to look at any of the last 12 months.
- **Choose KPIs** lets you tick any of the 15 metrics and change each target. The choice is saved for that month.
- A month you have not configured **inherits the most recent earlier choice**, so you only touch it when the company's priorities change. Before any choice exists, a default set is shown: AHT, FRT, SLA, FCR, RR and BKL.
- Each card shows the value, the target, a status (**On target**, **Close**, **Off target**), a bar for how close the target is, the change versus the previous month (green = improvement), and how many tickets the number is based on.
- Status rules: for "higher is better" metrics, on target = at or above the target and close = within 15% below it. For "lower is better" metrics, on target = at or below the target and close = within 20% above it. Context metrics (Ticket Volume) have no target.

![Choosing the month's KPIs](screenshots/30-kpi-picker.png)

## The 15 metrics

All time values are shown as minutes, hours or days. "Tickets created this month" is the group each metric looks at, except where noted.

### Speed

| Key | Metric | What it tells you | Formula | Better | Default target |
| --- | --- | --- | --- | --- | --- |
| AHT | **Average Handling Time** | How long a technician needs to fix a ticket once it is theirs | average of (resolved time - assigned time) for resolved tickets | lower | 8 h |
| ART | **Average Resolution Time** | The user's full wait from submitting to fixed | average of (resolved time - submitted time) for resolved tickets | lower | 1 day |
| FRT | **First Response Time** | How quickly IT first reacts to a new ticket | average of (first IT reply or assignment, whichever is first - submitted time) | lower | 30 min |
| TTA | **Time to Assign** | How long a ticket waits before an admin gives it to a technician | average of (assigned time - submitted time) | lower | 60 min |
| SLA | **SLA Compliance** | Share of tickets fixed within the target for their priority | tickets resolved within target / tickets resolved. Targets: High 4 h, Medium 8 h, Low 24 h | higher | 90% |

### Quality

| Key | Metric | What it tells you | Formula | Better | Default target |
| --- | --- | --- | --- | --- | --- |
| RR | **Resolution Rate** | How many of the month's tickets got fixed | resolved / created (cancelled excluded) | higher | 85% |
| FCR | **First-Time Fix Rate** | How often a fix stays fixed | resolved tickets never reopened / tickets ever resolved | higher | 90% |
| REO | **Reopen Rate** | How often users say the problem is still there | tickets reopened at least once / tickets ever resolved | lower | 10% |
| HPR | **High-Priority Resolution Rate** | How well urgent tickets are handled | high-priority resolved / high-priority created (cancelled excluded) | higher | 95% |
| SKM | **Skill Match Rate** | Whether tickets go to technicians with the right skills | assigned tickets whose category is in the technician's skills / assigned tickets ("Others" and technicians without skills excluded) | higher | 80% |

### Volume and backlog

| Key | Metric | What it tells you | Formula | Better | Default target |
| --- | --- | --- | --- | --- | --- |
| VOL | **Ticket Volume** | Demand on IT; context for every other metric | tickets created in the month | context | none |
| CAN | **Cancellation Rate** | Tickets withdrawn or abandoned | cancelled / created | lower | 10% |
| BKL | **Open Backlog** | Work still waiting at the end of the month (right now for the current month) | tickets created before the cut-off that are not resolved or cancelled by then | lower | 10 |
| AGE | **Backlog Age** | How long unfinished tickets have been waiting | average age in days of the tickets in the backlog | lower | 3 days |

### Team

| Key | Metric | What it tells you | Formula | Better | Default target |
| --- | --- | --- | --- | --- | --- |
| TPT | **Tickets Resolved per Technician** | Average output per technician | tickets resolved during the month / number of technicians | higher | 15 |

## Suggested sets

| If this month the company cares about... | Pick |
| --- | --- |
| Speed | AHT, FRT, TTA, SLA |
| Quality of fixes | FCR, REO, RR, HPR |
| Capacity and workload | VOL, BKL, AGE, TPT |
| User experience | FRT, REO, CAN, SLA |
| Assignment quality | SKM, TTA, AHT |

## Where the numbers come from

| Ticket field | Set when | Used by |
| --- | --- | --- |
| `created_at` | the ticket is submitted | every metric (month grouping), ART, FRT, TTA, SLA |
| `assigned_at` | an admin first assigns a technician | AHT, TTA |
| `first_response_at` | the first assignment or the first reply from a technician or admin | FRT |
| `resolved_at` | a technician marks it Resolved (cleared again if it is reopened) | AHT, ART, SLA, TPT, BKL |
| `reopen_count` | the requester reopens a resolved ticket | FCR, REO |
| `status`, `priority`, `category`, `assigned_to` | during the ticket's life | RR, CAN, HPR, SKM, BKL |

Tickets that existed before these timestamps were added have no `assigned_at`, `first_response_at` or `resolved_at`, so they are left out of the time-based metrics (a card shows "n/a" or a smaller "Based on N tickets" until new tickets arrive).

## Adding or changing a metric

1. Add an entry to `server/kpiCatalog.js` (key, name, unit, direction, default target, description, formula).
2. Calculate its value in `computeMonth()` in `server/kpi.js` and add it to the returned object.
3. It then appears automatically in the **Choose KPIs** dialog and on the scorecard. SLA time limits per priority are also in `server/kpiCatalog.js` (`SLA_MINUTES`).

The values come from `GET /api/kpi?userId=&month=2026-10` and the choice is saved with `PUT /api/kpi/selection` (both super admin only).
