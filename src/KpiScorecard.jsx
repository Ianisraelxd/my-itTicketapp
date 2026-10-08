import { useState } from "react";

import { api } from "./api";
import {
  STATUS_LABEL,
  formatKpiDelta,
  formatKpiValue,
  kpiAttainment,
  kpiDelta,
  kpiStatus,
  monthLabel,
  recentMonths,
} from "./kpiFormat";
import useKpiData from "./useKpiData";

const CATEGORY_ORDER = ["Speed", "Quality", "Volume & backlog", "Team"];
const MAX_KPIS = 15;

function unitHint(unit) {
  if (unit === "minutes") return "minutes";
  if (unit === "percent") return "%";
  if (unit === "days") return "days";
  if (unit === "ratio") return "per technician";
  return "tickets";
}

function KpiCard({ metric, reading, target, previousLabel }) {
  const value = reading?.value ?? null;
  const status = kpiStatus(metric, value, target);
  const delta = kpiDelta(metric, value, reading?.previous);
  const attainment = kpiAttainment(metric, value, target);
  const comparator = metric.direction === "higher" ? "at least" : "at most";

  return (
    <article className={`kpi-card kpi-${status}`}>
      <header>
        <span className="kpi-name" title={`${metric.description}\n\n${metric.formula}`}>
          {metric.name}
        </span>
        <span className={`kpi-pill kpi-pill-${status}`}>{STATUS_LABEL[status]}</span>
      </header>
      <strong className="kpi-value">{formatKpiValue(value, metric.unit)}</strong>
      <div className="kpi-bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${attainment ?? 0})` }}></span>
      </div>
      <div className="kpi-meta">
        {target !== null && target !== undefined ? (
          <span>
            Target: {comparator} {formatKpiValue(target, metric.unit)}
          </span>
        ) : (
          <span>No target (context)</span>
        )}
        {delta === null ? (
          <span className="kpi-delta">No data for {previousLabel}</span>
        ) : delta.change === 0 ? (
          <span className="kpi-delta">Same as {previousLabel}</span>
        ) : (
          <span className={`kpi-delta ${delta.better === null ? "" : delta.better ? "better" : "worse"}`}>
            {delta.change > 0 ? "▲" : "▼"} {formatKpiDelta(Math.abs(delta.change), metric.unit)} vs {previousLabel}
          </span>
        )}
      </div>
      <small className="kpi-sample">
        {reading?.sample ? `Based on ${reading.sample} ticket${reading.sample === 1 ? "" : "s"}` : "No tickets to measure yet"}
      </small>
    </article>
  );
}

function KpiSkeleton() {
  return (
    <div className="kpi-grid" aria-busy="true" role="status" aria-label="Loading KPIs">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="kpi-card kpi-skeleton" key={index} style={{ animationDelay: `${index * 80}ms` }}>
          <i></i>
          <b></b>
          <i></i>
        </div>
      ))}
    </div>
  );
}

function KpiPicker({ data, month, me, onClose, onSaved, showMessage }) {
  const selectedByKey = new Map(data.selected.map((item) => [item.key, item.target]));
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(
      data.catalog.map((metric) => [
        metric.key,
        {
          on: selectedByKey.has(metric.key),
          target: String(selectedByKey.get(metric.key) ?? metric.target ?? ""),
        },
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const count = Object.values(draft).filter((item) => item.on).length;

  function patch(key, change) {
    setDraft((current) => ({ ...current, [key]: { ...current[key], ...change } }));
  }

  async function save() {
    if (count === 0 || count > MAX_KPIS || saving) return;
    setSaving(true);
    try {
      await api.saveKpiSelection({
        userId: me.userId,
        month,
        metrics: data.catalog
          .filter((metric) => draft[metric.key].on)
          .map((metric) => ({
            key: metric.key,
            target: metric.direction === "info" || draft[metric.key].target === "" ? null : Number(draft[metric.key].target),
          })),
      });
      showMessage("KPIs saved", `${count} KPI${count === 1 ? "" : "s"} will show for ${monthLabel(month)}. Later months use this choice until you change it.`);
      onSaved();
    } catch (error) {
      showMessage("Could not save KPIs", error.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box kpi-picker" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h3>Choose KPIs for {monthLabel(month)}</h3>
        <p className="kpi-picker-hint">
          Pick the metrics that matter this month and adjust their targets. Later months keep this
          choice until you change it.
        </p>
        <div className="kpi-picker-body">
          {CATEGORY_ORDER.map((category) => (
            <section key={category}>
              <span className="eyebrow">{category.toUpperCase()}</span>
              {data.catalog
                .filter((metric) => metric.category === category)
                .map((metric) => {
                  const item = draft[metric.key];
                  return (
                    <div className={`kpi-option ${item.on ? "on" : ""}`} key={metric.key}>
                      <label className="kpi-option-main">
                        <input
                          type="checkbox"
                          checked={item.on}
                          onChange={(event) => patch(metric.key, { on: event.target.checked })}
                        />
                        <span>
                          <strong>{metric.name}</strong>
                          <small>{metric.description}</small>
                          <em>{metric.formula}</em>
                        </span>
                      </label>
                      {metric.direction !== "info" && (
                        <label className="kpi-target">
                          <span>
                            Target ({metric.direction === "higher" ? "min" : "max"})
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={item.target}
                            disabled={!item.on}
                            onChange={(event) => patch(metric.key, { target: event.target.value })}
                          />
                          <small>{unitHint(metric.unit)}</small>
                        </label>
                      )}
                    </div>
                  );
                })}
            </section>
          ))}
        </div>
        <div className="kpi-picker-footer">
          <span>
            {count} of {data.catalog.length} selected
          </span>
          <div className="dialog-actions">
            <button type="button" className="button button-outline" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="button button-primary" disabled={saving || count === 0} onClick={save}>
              Save KPIs
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Monthly KPI scorecard for the super admin dashboard.
export default function KpiScorecard({ me, showMessage }) {
  const months = recentMonths(12);
  const [month, setMonth] = useState(months[0]);
  const [picking, setPicking] = useState(false);
  const { data, isLoading, error, reload } = useKpiData(month, me.userId);

  const catalog = new Map((data?.catalog || []).map((metric) => [metric.key, metric]));
  const readings = new Map((data?.metrics || []).map((reading) => [reading.key, reading]));

  const cards = (data?.selected || [])
    .map((item) => {
      const metric = catalog.get(item.key);
      return metric ? { metric, reading: readings.get(item.key), target: item.target ?? metric.target } : null;
    })
    .filter(Boolean);

  const source =
    data && data.selectionSource === null
      ? "Showing the default KPIs. Use Choose KPIs to set this month's."
      : data && data.selectionSource !== data.month
        ? `Carried over from ${monthLabel(data.selectionSource)}. Use Choose KPIs to change it.`
        : "";

  return (
    <section className="panel kpi-section" aria-label="Monthly KPIs">
      <div className="kpi-head">
        <div>
          <span className="eyebrow">MONTHLY KPI SCORECARD</span>
          <h2>How IT is performing</h2>
        </div>
        <div className="kpi-controls">
          <label className="kpi-month">
            <span className="sr-only">Month</span>
            <select value={month} onChange={(event) => setMonth(event.target.value)}>
              {months.map((value) => (
                <option key={value} value={value}>
                  {monthLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button button-primary"
            disabled={!data}
            onClick={() => setPicking(true)}
          >
            Choose KPIs
          </button>
        </div>
      </div>

      {error ? (
        <div className="report-error" role="alert">
          <strong>Could not load the KPIs.</strong>
          <p>{error}</p>
          <button className="button button-primary" onClick={reload}>
            Try again
          </button>
        </div>
      ) : isLoading ? (
        <KpiSkeleton />
      ) : (
        <>
          <div className="kpi-grid">
            {cards.map(({ metric, reading, target }) => (
              <KpiCard
                key={metric.key}
                metric={metric}
                reading={reading}
                target={target}
                previousLabel={monthLabel(data.previousMonth).split(" ")[0]}
              />
            ))}
          </div>
          {source && <p className="kpi-source">{source}</p>}
        </>
      )}

      {picking && data && (
        <KpiPicker
          data={data}
          month={month}
          me={me}
          showMessage={showMessage}
          onClose={() => setPicking(false)}
          onSaved={() => {
            setPicking(false);
            reload();
          }}
        />
      )}
    </section>
  );
}
