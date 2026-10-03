// Placeholder shown while a report chart loads. It mirrors the shape of the
// chart (grid lines, bars, axis) so the layout does not jump when data arrives.
const BAR_HEIGHTS = [46, 78, 58, 92, 66, 38, 72];

export default function ChartSkeleton({ height = 260, label = "Loading chart" }) {
  return (
    <div className="chart-skeleton" style={{ height }} role="status" aria-busy="true" aria-label={label}>
      <div className="chart-skeleton-grid">
        <span></span>
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div className="chart-skeleton-bars">
        {BAR_HEIGHTS.map((percent, index) => (
          <i key={index} style={{ height: `${percent}%`, animationDelay: `${index * 90}ms` }}></i>
        ))}
      </div>
      <div className="chart-skeleton-axis"></div>
    </div>
  );
}
