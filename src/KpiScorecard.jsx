import { useState } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

import { api } from "./api";
import {
  STATUS_LABEL,
  buildKpiCards,
  formatKpiDelta,
  formatKpiValue,
  kpiAttainment,
  kpiDelta,
  monthLabel,
  recentMonths,
} from "./kpiFormat";
import useKpiData from "./useKpiData";
import useKpiTrend from "./useKpiTrend";

const CATEGORY_ORDER = ["Speed", "Quality", "Volume & backlog", "Team"];
const MAX_KPIS = 15;
const TONE_COLOR = { good: "#3f9d62", warn: "#bd8128", bad: "#d9534f", info: "#39759d", na: "#a7b1ac" };

function unitHint(unit) {
  if (unit === "minutes") return "minutes";
  if (unit === "percent") return "%";
  if (unit === "days") return "days";
  if (unit === "ratio") return "per technician";
  return "tickets";
}

function Sparkline({ values, tone }) {
  const points = values.map((value, index) => ({ index, value }));
  if (values.filter((value) => value !== null && value !== undefined).length < 2) return null;
  const color = TONE_COLOR[tone] || TONE_COLOR.info;
  const gradientId = `spark-${tone}`;
  return (
    <div className="kpi-spark" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// "6 of 9 on target": one glance at how the month is going.
export function KpiHealth({ cards }) {
  const graded = cards.filter((card) => ["good", "warn", "bad"].includes(card.status));
  const good = graded.filter((card) => card.status === "good").length;
  const ratio = graded.length ? good / graded.length : 0;
  const tone = !graded.length ? "na" : ratio >= 0.75 ? "good" : ratio >= 0.5 ? "warn" : "bad";
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="kpi-health" role="img" aria-label={`${good} of ${graded.length} KPIs on target`}>
      <svg viewBox="0 0 76 76" width="76" height="76" aria-hidden="true">
        <circle className="ring-track" cx="38" cy="38" r={radius} />
        <circle
          className="ring-value"
          cx="38"
          cy="38"
          r={radius}
          stroke={TONE_COLOR[tone]}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <span className="ring-number">{graded.length ? Math.round(ratio * 100) : "–"}</span>
      <div className="ring-text">
        <strong>{graded.length ? `${good} of ${graded.length} on target` : "No targets yet"}</strong>
        <small>KPI health</small>
      </div>
    </div>
  );
}

function KpiCard({ card, previousLabel, trend }) {
  const { metric, reading, target, status } = card;
  const value = reading?.value ?? null;
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
      <div className="kpi-main">
        <strong className="kpi-value">{formatKpiValue(value, metric.unit)}</strong>
        {trend && <Sparkline values={trend} tone={status} />}
      </div>
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

export function KpiPicker({ data, month, me, onClose, onSaved, showMessage }) {
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
          Pick the metrics that matter this month and adjust their targets. They show on the
          dashboard and in the Report Manager, and later months keep this choice until you change it.
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

// The scorecard itself: health ring, month label / picker slot, and the chosen KPI cards.
export function KpiScorecardView({ data, trend, isLoading, error, reload, controls, eyebrow, title, note }) {
  const cards = buildKpiCards(data);
  const source =
    data && data.selectionSource === null
      ? "Showing the default KPIs. Use Choose KPIs to set this month's."
      : data && data.selectionSource !== data.month
        ? `Carried over from ${monthLabel(data.selectionSource)}. Use Choose KPIs to change it.`
        : "";

  return (
    <section className="panel kpi-section" aria-label="Monthly KPIs">
      <div className="kpi-head">
        <div className="kpi-title">
          {data && <KpiHealth cards={cards} />}
          <div>
            <span className="eyebrow">{eyebrow || "MONTHLY KPI SCORECARD"}</span>
            <h2>{title || "How IT is performing"}</h2>
          </div>
        </div>
        <div className="kpi-controls">{controls}</div>
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
            {cards.map((card) => (
              <KpiCard
                key={card.metric.key}
                card={card}
                previousLabel={monthLabel(data.previousMonth).split(" ")[0]}
                trend={trend?.series?.[card.metric.key]}
              />
            ))}
          </div>
          {(source || note) && <p className="kpi-source">{[source, note].filter(Boolean).join(" ")}</p>}
        </>
      )}
    </section>
  );
}

// Monthly KPI scorecard for the super admin dashboard (has its own month picker).
export default function KpiScorecard({ me, showMessage }) {
  const months = recentMonths(12);
  const [month, setMonth] = useState(months[0]);
  const [picking, setPicking] = useState(false);
  const { data, isLoading, error, reload } = useKpiData(month, me.userId);
  const trend = useKpiTrend(month, me.userId);

  return (
    <>
      <KpiScorecardView
        data={data}
        trend={trend}
        isLoading={isLoading}
        error={error}
        reload={reload}
        controls={
          <>
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
          </>
        }
      />
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
    </>
  );
}
