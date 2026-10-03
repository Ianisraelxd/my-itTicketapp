import { defaultReportFilters, toISODate } from "./reportDefaults";

const PRESETS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "All time", days: null },
];

function presetFilters(days) {
  if (days === null) return { from: "", to: toISODate(new Date()) };
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  return { from: toISODate(start), to: toISODate(end) };
}

export default function ReportFilters({
  filters,
  onChange,
  categories,
  roles,
  onExport,
  canExport,
}) {
  const update = (patch) => onChange({ ...filters, ...patch });
  const activePreset = PRESETS.find((preset) => {
    const expected = presetFilters(preset.days);
    return expected.from === filters.from && expected.to === filters.to;
  });

  return (
    <section className="panel report-filters" aria-label="Report filters">
      <label>
        From
        <input
          type="date"
          value={filters.from}
          max={filters.to || undefined}
          onChange={(event) => update({ from: event.target.value })}
        />
      </label>
      <label>
        To
        <input
          type="date"
          value={filters.to}
          min={filters.from || undefined}
          onChange={(event) => update({ to: event.target.value })}
        />
      </label>
      <label>
        Category
        <select value={filters.category} onChange={(event) => update({ category: event.target.value })}>
          <option value="All">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>
      <label>
        Requester role
        <select value={filters.role} onChange={(event) => update({ role: event.target.value })}>
          <option value="All">All roles</option>
          {roles.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <div className="filter-presets" role="group" aria-label="Quick date ranges">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={activePreset === preset ? "active" : ""}
            onClick={() => update(presetFilters(preset.days))}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="filter-actions">
        <button
          type="button"
          className="button button-outline"
          onClick={() => onChange(defaultReportFilters())}
        >
          Reset
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={!canExport}
          onClick={onExport}
        >
          Export to CSV
        </button>
      </div>
    </section>
  );
}
