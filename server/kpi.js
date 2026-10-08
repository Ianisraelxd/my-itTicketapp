// Monthly KPI scorecard: calculates every catalog metric from ticket data and
// stores which metrics (and targets) the super admin chose for each month.
import { pool, query } from "./db.js";
import { DEFAULT_SELECTION, KPI_CATALOG, KPI_KEYS, SLA_MINUTES } from "./kpiCatalog.js";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

function previousMonth(month) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(year, number - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const round = (value, digits = 1) => {
  if (value === null || value === undefined) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
};
const ratio = (part, whole) => (Number(whole) > 0 ? round((Number(part) / Number(whole)) * 100) : null);

// SLA target (minutes) by priority, built from the catalog constants (numbers only).
const slaCase = `CASE t.priority WHEN 'High' THEN ${Number(SLA_MINUTES.High)} WHEN 'Medium' THEN ${Number(SLA_MINUTES.Medium)} ELSE ${Number(SLA_MINUTES.Low)} END`;

// Every number for one month. Tickets are grouped by the month they were
// created in ("cohort"), except throughput (by resolved date) and backlog
// (a snapshot at the end of the month, or right now for the current month).
async function computeMonth(month) {
  const start = `${month}-01`;

  const [cohort] = await query(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(t.status = 'Resolved'), 0) AS resolved,
       COALESCE(SUM(t.status = 'Cancelled'), 0) AS cancelled,
       COALESCE(SUM(t.priority = 'High' AND t.status <> 'Cancelled'), 0) AS highTotal,
       COALESCE(SUM(t.priority = 'High' AND t.status = 'Resolved'), 0) AS highResolved,
       COALESCE(SUM(t.status = 'Resolved' OR t.reopen_count > 0), 0) AS everResolved,
       COALESCE(SUM(t.status = 'Resolved' AND t.reopen_count = 0), 0) AS fixedFirstTime,
       COALESCE(SUM(t.reopen_count > 0), 0) AS reopened,
       AVG(CASE WHEN t.status = 'Resolved' AND t.assigned_at IS NOT NULL AND t.resolved_at IS NOT NULL
                THEN TIMESTAMPDIFF(MINUTE, t.assigned_at, t.resolved_at) END) AS aht,
       SUM(CASE WHEN t.status = 'Resolved' AND t.assigned_at IS NOT NULL AND t.resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS ahtSample,
       AVG(CASE WHEN t.resolved_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, t.created_at, t.resolved_at) END) AS art,
       AVG(CASE WHEN t.first_response_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, t.created_at, t.first_response_at) END) AS frt,
       SUM(CASE WHEN t.first_response_at IS NOT NULL THEN 1 ELSE 0 END) AS frtSample,
       AVG(CASE WHEN t.assigned_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, t.created_at, t.assigned_at) END) AS tta,
       SUM(CASE WHEN t.assigned_at IS NOT NULL THEN 1 ELSE 0 END) AS ttaSample,
       SUM(CASE WHEN t.resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS timedResolved,
       SUM(CASE WHEN t.resolved_at IS NOT NULL
                 AND TIMESTAMPDIFF(MINUTE, t.created_at, t.resolved_at) <= ${slaCase} THEN 1 ELSE 0 END) AS withinSla,
       SUM(CASE WHEN t.assigned_to IS NOT NULL AND t.category <> 'Others' AND a.skills <> '' THEN 1 ELSE 0 END) AS skillEligible,
       SUM(CASE WHEN t.assigned_to IS NOT NULL AND t.category <> 'Others' AND a.skills <> ''
                 AND FIND_IN_SET(t.category, a.skills) > 0 THEN 1 ELSE 0 END) AS skillMatched
     FROM tickets t LEFT JOIN users a ON a.user_pk = t.assigned_to
     WHERE t.created_at >= ? AND t.created_at < DATE_ADD(?, INTERVAL 1 MONTH)`,
    [start, start],
  );

  // Snapshot at min(now, end of month).
  const [backlog] = await query(
    `SELECT COUNT(*) AS n,
       AVG(TIMESTAMPDIFF(HOUR, created_at, LEAST(NOW(), DATE_ADD(?, INTERVAL 1 MONTH)))) / 24 AS ageDays
     FROM tickets
     WHERE created_at < LEAST(NOW(), DATE_ADD(?, INTERVAL 1 MONTH))
       AND status <> 'Cancelled'
       AND (status IN ('Open', 'In Progress')
            OR (resolved_at IS NOT NULL AND resolved_at >= LEAST(NOW(), DATE_ADD(?, INTERVAL 1 MONTH))))`,
    [start, start, start],
  );

  const [throughput] = await query(
    `SELECT COUNT(*) AS n FROM tickets
     WHERE resolved_at >= ? AND resolved_at < DATE_ADD(?, INTERVAL 1 MONTH)`,
    [start, start],
  );
  const [staff] = await query("SELECT COUNT(*) AS n FROM users WHERE role = 'technician'");

  const total = Number(cohort.total);
  const cancelled = Number(cohort.cancelled);
  const everResolved = Number(cohort.everResolved);
  const ticketsForRate = total - cancelled;

  const value = {
    AHT: { value: round(cohort.aht), sample: Number(cohort.ahtSample) },
    ART: { value: round(cohort.art), sample: Number(cohort.timedResolved) },
    FRT: { value: round(cohort.frt), sample: Number(cohort.frtSample) },
    TTA: { value: round(cohort.tta), sample: Number(cohort.ttaSample) },
    SLA: { value: ratio(cohort.withinSla, cohort.timedResolved), sample: Number(cohort.timedResolved) },
    RR: { value: ratio(cohort.resolved, ticketsForRate), sample: ticketsForRate },
    FCR: { value: ratio(cohort.fixedFirstTime, everResolved), sample: everResolved },
    REO: { value: ratio(cohort.reopened, everResolved), sample: everResolved },
    HPR: { value: ratio(cohort.highResolved, cohort.highTotal), sample: Number(cohort.highTotal) },
    SKM: { value: ratio(cohort.skillMatched, cohort.skillEligible), sample: Number(cohort.skillEligible) },
    VOL: { value: total, sample: total },
    CAN: { value: ratio(cancelled, total), sample: total },
    BKL: { value: Number(backlog.n), sample: Number(backlog.n) },
    AGE: { value: round(backlog.ageDays), sample: Number(backlog.n) },
    TPT: {
      value: Number(staff.n) > 0 ? round(Number(throughput.n) / Number(staff.n)) : null,
      sample: Number(throughput.n),
    },
  };
  return value;
}

// The metrics shown for a month: the month's own choice, else the most recent
// earlier choice (carried over), else the built-in default set.
async function selectionFor(month) {
  const own = await query(
    "SELECT metric_key AS `key`, target FROM kpi_selections WHERE month = ? ORDER BY position",
    [month],
  );
  if (own.length > 0) return { rows: own, source: month };

  const earlier = await query(
    "SELECT month FROM kpi_selections WHERE month < ? ORDER BY month DESC LIMIT 1",
    [month],
  );
  if (earlier[0]) {
    const rows = await query(
      "SELECT metric_key AS `key`, target FROM kpi_selections WHERE month = ? ORDER BY position",
      [earlier[0].month],
    );
    return { rows, source: earlier[0].month };
  }
  return { rows: DEFAULT_SELECTION.map((key) => ({ key, target: null })), source: null };
}

async function requireSuperAdmin(userId) {
  const rows = await query(
    "SELECT user_pk, name, role, role_name FROM users WHERE user_pk = ? LIMIT 1",
    [userId ?? 0],
  );
  return rows[0] && rows[0].role === "superadmin" ? rows[0] : null;
}

export function registerKpiRoutes(app, wrap) {
  // Scorecard data for one month: every metric's value (and last month's), plus
  // which ones are selected for the dashboard.
  app.get("/api/kpi", wrap(async (req, res) => {
    const admin = await requireSuperAdmin(req.query.userId);
    if (!admin) return res.status(403).json({ error: "Only the super admin can view KPIs." });

    const month = MONTH.test(req.query.month ?? "") ? req.query.month : currentMonth();
    const prior = previousMonth(month);
    const [values, previous, selection] = await Promise.all([
      computeMonth(month),
      computeMonth(prior),
      selectionFor(month),
    ]);

    const targets = new Map(selection.rows.map((row) => [row.key, row.target]));
    res.json({
      month,
      previousMonth: prior,
      isCurrentMonth: month === currentMonth(),
      selectionSource: selection.source,
      catalog: KPI_CATALOG,
      metrics: KPI_CATALOG.map((metric) => ({
        key: metric.key,
        value: values[metric.key].value,
        sample: values[metric.key].sample,
        previous: previous[metric.key].value,
      })),
      selected: selection.rows.map((row) => ({
        key: row.key,
        target: targets.get(row.key) === null || targets.get(row.key) === undefined
          ? null
          : Number(targets.get(row.key)),
      })),
    });
  }));

  // Choose the KPIs (and optional targets) for a month.
  app.put("/api/kpi/selection", wrap(async (req, res) => {
    const admin = await requireSuperAdmin(req.body?.userId);
    if (!admin) return res.status(403).json({ error: "Only the super admin can choose KPIs." });

    const month = String(req.body?.month ?? "");
    if (!MONTH.test(month)) return res.status(400).json({ error: "month must look like 2026-10." });

    const picked = Array.isArray(req.body?.metrics) ? req.body.metrics : [];
    const seen = new Set();
    const rows = [];
    for (const item of picked) {
      const key = String(item?.key ?? "");
      if (!KPI_KEYS.includes(key) || seen.has(key)) continue;
      seen.add(key);
      const target = item.target === null || item.target === undefined || item.target === ""
        ? null
        : Number(item.target);
      if (target !== null && (!Number.isFinite(target) || target < 0)) {
        return res.status(400).json({ error: `Target for ${key} must be a positive number.` });
      }
      rows.push([month, key, target, rows.length]);
    }
    if (rows.length === 0) return res.status(400).json({ error: "Pick at least one KPI." });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute("DELETE FROM kpi_selections WHERE month = ?", [month]);
      for (const row of rows) {
        await conn.execute(
          "INSERT INTO kpi_selections (month, metric_key, target, position) VALUES (?, ?, ?, ?)",
          row,
        );
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    await query(
      "INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)",
      [admin.name, admin.role_name, `Chose ${rows.length} KPIs for ${month}`],
    );
    res.json({ ok: true, month, count: rows.length });
  }));
}
