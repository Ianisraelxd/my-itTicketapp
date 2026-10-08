// Formatting and status helpers for the KPI scorecard.

export function formatKpiValue(value, unit) {
  if (value === null || value === undefined) return "n/a";
  const number = Number(value);
  switch (unit) {
    case "minutes": {
      const total = Math.round(number);
      if (total < 60) return `${total} min`;
      if (total < 1440) {
        const hours = Math.floor(total / 60);
        const minutes = total % 60;
        return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
      }
      const days = Math.floor(total / 1440);
      const hours = Math.round((total % 1440) / 60);
      return hours ? `${days}d ${hours}h` : `${days}d`;
    }
    case "percent":
      return `${number}%`;
    case "days":
      return `${number} d`;
    case "ratio":
      return `${number}`;
    default:
      return String(Math.round(number));
  }
}

// Size of a month-over-month change: percentages move in points, not percent.
export function formatKpiDelta(amount, unit) {
  return unit === "percent" ? `${amount} pts` : formatKpiValue(amount, unit);
}

// good / warn / bad against the target, "info" when there is no target to hit,
// "na" when there is no data yet.
export function kpiStatus(metric, value, target) {
  if (value === null || value === undefined) return "na";
  if (metric.direction === "info" || target === null || target === undefined) return "info";
  if (metric.direction === "higher") {
    if (value >= target) return "good";
    return value >= target * 0.85 ? "warn" : "bad";
  }
  if (value <= target) return "good";
  return value <= target * 1.2 ? "warn" : "bad";
}

export const STATUS_LABEL = {
  good: "On target",
  warn: "Close",
  bad: "Off target",
  info: "Context",
  na: "No data",
};

// 0..1 progress toward the target (1 = target met or beaten).
export function kpiAttainment(metric, value, target) {
  if (value === null || value === undefined || !target) return null;
  if (metric.direction === "higher") return Math.max(0, Math.min(1, value / target));
  if (metric.direction === "lower") return value <= 0 ? 1 : Math.max(0, Math.min(1, target / value));
  return null;
}

// Change versus the previous month, and whether that change is an improvement.
export function kpiDelta(metric, value, previous) {
  if (value === null || previous === null || value === undefined || previous === undefined) return null;
  const change = Math.round((value - previous) * 10) / 10;
  if (change === 0) return { change: 0, better: null };
  let better = null;
  if (metric.direction === "higher") better = change > 0;
  if (metric.direction === "lower") better = change < 0;
  return { change, better };
}

export function monthLabel(month) {
  const [year, number] = month.split("-").map(Number);
  return new Date(year, number - 1, 1).toLocaleString([], { month: "long", year: "numeric" });
}

export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// The last 12 months, newest first.
export function recentMonths(count = 12) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) =>
    monthKey(new Date(now.getFullYear(), now.getMonth() - index, 1)),
  );
}
