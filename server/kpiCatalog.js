// The KPI catalog: every metric the system can calculate from ticket data.
// The super admin picks which ones to show on the dashboard for each month
// (stored in the kpi_selections table); this file defines what they mean.
//
//   unit       "minutes" | "percent" | "count" | "days" | "ratio"
//   direction  "lower"  = smaller is better (times, rates of bad things)
//              "higher" = bigger is better
//              "info"   = context only, no good/bad
//   target     default target, editable per month when picking KPIs

// Resolution targets by priority, in minutes. Used by SLA Compliance (SLA).
export const SLA_MINUTES = { High: 240, Medium: 480, Low: 1440 };

export const KPI_CATALOG = [
  // ---- Speed ----------------------------------------------------------------
  {
    key: "AHT",
    category: "Speed",
    name: "Average Handling Time (AHT)",
    unit: "minutes",
    direction: "lower",
    target: 480,
    description: "How long a technician takes to fix a ticket once it is assigned to them.",
    formula: "Average of (resolved time - assigned time) for tickets created this month that are Resolved.",
  },
  {
    key: "ART",
    category: "Speed",
    name: "Average Resolution Time (ART)",
    unit: "minutes",
    direction: "lower",
    target: 1440,
    description: "The full wait from the moment a user submits a ticket until it is fixed.",
    formula: "Average of (resolved time - submitted time) for tickets created this month that were resolved.",
  },
  {
    key: "FRT",
    category: "Speed",
    name: "First Response Time (FRT)",
    unit: "minutes",
    direction: "lower",
    target: 30,
    description: "How quickly someone from IT first acts on a new ticket (assigns it or replies).",
    formula: "Average of (first IT reply or assignment, whichever is first - submitted time).",
  },
  {
    key: "TTA",
    category: "Speed",
    name: "Time to Assign (TTA)",
    unit: "minutes",
    direction: "lower",
    target: 60,
    description: "How long a ticket waits before an admin gives it to a technician.",
    formula: "Average of (assigned time - submitted time) for assigned tickets.",
  },
  {
    key: "SLA",
    category: "Speed",
    name: "SLA Compliance",
    unit: "percent",
    direction: "higher",
    target: 90,
    description: "Share of tickets fixed within their priority's target time (High 4 h, Medium 8 h, Low 24 h).",
    formula: "Tickets resolved within the priority target / tickets resolved.",
  },
  // ---- Quality --------------------------------------------------------------
  {
    key: "RR",
    category: "Quality",
    name: "Resolution Rate",
    unit: "percent",
    direction: "higher",
    target: 85,
    description: "How many of the month's tickets actually got fixed.",
    formula: "Resolved tickets / tickets created this month (cancelled tickets excluded).",
  },
  {
    key: "FCR",
    category: "Quality",
    name: "First-Time Fix Rate (FCR)",
    unit: "percent",
    direction: "higher",
    target: 90,
    description: "Share of fixed tickets that stayed fixed, with no reopen.",
    formula: "Resolved tickets never reopened / tickets that were ever resolved.",
  },
  {
    key: "REO",
    category: "Quality",
    name: "Reopen Rate",
    unit: "percent",
    direction: "lower",
    target: 10,
    description: "How often the user said the problem was still there after IT marked it fixed.",
    formula: "Tickets reopened at least once / tickets that were ever resolved.",
  },
  {
    key: "HPR",
    category: "Quality",
    name: "High-Priority Resolution Rate",
    unit: "percent",
    direction: "higher",
    target: 95,
    description: "How well IT handles the urgent tickets.",
    formula: "High-priority tickets resolved / high-priority tickets created (cancelled excluded).",
  },
  {
    key: "SKM",
    category: "Quality",
    name: "Skill Match Rate",
    unit: "percent",
    direction: "higher",
    target: 80,
    description: "How often a ticket is given to a technician whose skills fit its category.",
    formula: "Assigned tickets whose category is in the technician's skills / assigned tickets (Others category and technicians without skills excluded).",
  },
  // ---- Volume & backlog -----------------------------------------------------
  {
    key: "VOL",
    category: "Volume & backlog",
    name: "Ticket Volume",
    unit: "count",
    direction: "info",
    target: null,
    description: "How many tickets were submitted this month. Context for every other metric.",
    formula: "Count of tickets created in the month.",
  },
  {
    key: "CAN",
    category: "Volume & backlog",
    name: "Cancellation Rate",
    unit: "percent",
    direction: "lower",
    target: 10,
    description: "Tickets users gave up on or withdrew. High values can mean slow service or unclear requests.",
    formula: "Cancelled tickets / tickets created this month.",
  },
  {
    key: "BKL",
    category: "Volume & backlog",
    name: "Open Backlog",
    unit: "count",
    direction: "lower",
    target: 10,
    description: "Tickets still waiting or being worked on at the end of the month (right now for the current month).",
    formula: "Tickets created before the cut-off that are not resolved or cancelled by then.",
  },
  {
    key: "AGE",
    category: "Volume & backlog",
    name: "Backlog Age",
    unit: "days",
    direction: "lower",
    target: 3,
    description: "How long the unfinished tickets have been waiting on average.",
    formula: "Average age in days of the tickets counted in Open Backlog.",
  },
  // ---- Team -----------------------------------------------------------------
  {
    key: "TPT",
    category: "Team",
    name: "Tickets Resolved per Technician",
    unit: "ratio",
    direction: "higher",
    target: 15,
    description: "Average output per technician: how many tickets each one closed this month.",
    formula: "Tickets resolved during the month / number of technicians.",
  },
];

// Shown until the super admin picks something for a month (and nothing earlier exists).
export const DEFAULT_SELECTION = ["AHT", "FRT", "SLA", "FCR", "RR", "BKL"];

export const KPI_KEYS = KPI_CATALOG.map((metric) => metric.key);
