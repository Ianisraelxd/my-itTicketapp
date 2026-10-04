import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import ChartSkeleton from "./ChartSkeleton";

const PALETTE = ["#1c6b56", "#bd8128", "#39759d", "#bbd887", "#a7b1ac", "#104c3d"];
const AXIS_STYLE = { fontSize: 11, fill: "#78827e" };
const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid #e2e8e4",
  boxShadow: "0 8px 28px #223f3214",
  fontSize: 12,
};

/**
 * One report card: title, then a skeleton, an empty state, or a Recharts chart.
 *
 * Props
 *  - data:       array of rows, e.g. [{ label: "Hardware", value: 12 }]
 *  - type:       "bar" | "line" | "pie"
 *  - xKey:       row field used for the category axis / slice name (default "label")
 *  - series:     [{ key, label, color }] - one entry per bar / line (default: "value")
 *  - colorFor:   optional (row) => color, to colour individual bars or slices
 *  - horizontal: bar charts only - draw horizontal bars (good for long labels)
 *  - isLoading:  show <ChartSkeleton/> instead of the chart
 */
export default function ReportChartContainer({
  title,
  note,
  data,
  type = "bar",
  xKey = "label",
  series = [{ key: "value", label: "Tickets" }],
  colorFor,
  horizontal = false,
  xTickFormatter,
  isLoading = false,
  height = 260,
  wide = false,
  emptyMessage = "No data for these filters.",
}) {
  const hasData =
    Array.isArray(data) && data.some((row) => series.some((item) => Number(row[item.key]) > 0));
  const showLegend = type === "pie" || series.length > 1;

  let chart = null;
  if (!isLoading && hasData) {
    if (type === "pie") {
      const valueKey = series[0].key;
      chart = (
        <PieChart>
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Pie
            data={data.filter((row) => Number(row[valueKey]) > 0)}
            dataKey={valueKey}
            nameKey={xKey}
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={2}
            stroke="var(--card)"
          >
            {data
              .filter((row) => Number(row[valueKey]) > 0)
              .map((row, index) => (
                <Cell key={row[xKey]} fill={colorFor?.(row) || PALETTE[index % PALETTE.length]} />
              ))}
          </Pie>
        </PieChart>
      );
    } else if (type === "line") {
      chart = (
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#e9efeb" vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={AXIS_STYLE}
            tickFormatter={xTickFormatter}
            tickLine={false}
            axisLine={{ stroke: "#e2e8e4" }}
            minTickGap={24}
          />
          <YAxis allowDecimals={false} tick={AXIS_STYLE} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={xTickFormatter} />
          {showLegend && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
          {series.map((item, index) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color || PALETTE[index % PALETTE.length]}
              strokeWidth={2.5}
              dot={data.length <= 31 ? { r: 3 } : false}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      );
    } else {
      chart = (
        <BarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 12, bottom: 0, left: horizontal ? 4 : -12 }}
        >
          <CartesianGrid stroke="#e9efeb" vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" allowDecimals={false} tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey={xKey}
                width={112}
                tick={AXIS_STYLE}
                tickLine={false}
                axisLine={false}
              />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#e2e8e4" }} />
              <YAxis allowDecimals={false} tick={AXIS_STYLE} tickLine={false} axisLine={false} />
            </>
          )}
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--mint)", opacity: 0.5 }} />
          {showLegend && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
          {series.map((item, index) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.label}
              fill={item.color || PALETTE[index % PALETTE.length]}
              radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]}
              maxBarSize={36}
            >
              {colorFor &&
                data.map((row) => <Cell key={row[xKey]} fill={colorFor(row)} />)}
            </Bar>
          ))}
        </BarChart>
      );
    }
  }

  return (
    <section className={`panel report-card ${wide ? "wide" : ""}`} aria-busy={isLoading}>
      <div className="report-card-head">
        <h3>{title}</h3>
        {note && <small>{note}</small>}
      </div>
      {isLoading ? (
        <ChartSkeleton height={height} label={`Loading ${title}`} />
      ) : !hasData ? (
        <p className="report-empty chart-empty" style={{ minHeight: Math.min(height, 120) }}>
          {emptyMessage}
        </p>
      ) : (
        <div className="chart-box" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {chart}
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
