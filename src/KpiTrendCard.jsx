import { useState } from "react";

import { formatKpiValue } from "./kpiFormat";
import ReportChartContainer from "./ReportChartContainer";

const shortMonth = (month) => {
  const [year, number] = month.split("-").map(Number);
  return new Date(year, number - 1, 1).toLocaleString([], { month: "short" });
};

// One chosen KPI over the last months, with its target as a dashed line.
// Chips switch between the month's chosen KPIs.
export default function KpiTrendCard({ cards, trend, isLoading }) {
  const [picked, setPicked] = useState(null);
  const active = cards.find((card) => card.metric.key === picked) || cards[0];

  const data =
    active && trend
      ? trend.months.map((month, index) => ({
          label: shortMonth(month),
          value: trend.series[active.metric.key]?.[index] ?? null,
        }))
      : [];

  return (
    <ReportChartContainer
      title="KPI trend"
      note="Last 6 months"
      type="line"
      data={data}
      series={[{ key: "value", label: active?.metric.name || "KPI", color: "#1c6b56" }]}
      valueFormatter={active ? (value) => formatKpiValue(value, active.metric.unit) : undefined}
      referenceLine={
        active && active.target !== null && active.target !== undefined
          ? { value: Number(active.target), label: "Target" }
          : undefined
      }
      isLoading={isLoading}
      emptyMessage="Not enough history for this KPI yet."
      wide
      height={240}
      toolbar={
        <div className="kpi-chips" role="tablist" aria-label="Choose a KPI to chart">
          {cards.map((card) => (
            <button
              key={card.metric.key}
              type="button"
              role="tab"
              aria-selected={card.metric.key === active?.metric.key}
              className={card.metric.key === active?.metric.key ? "active" : ""}
              onClick={() => setPicked(card.metric.key)}
            >
              {card.metric.key}
            </button>
          ))}
        </div>
      }
    />
  );
}
