import { useEffect, useState } from "react";

import { api } from "./api";

// Last few months of every KPI (for sparklines and the trend chart). Failures
// are silent: the scorecard works fine without the little charts.
export default function useKpiTrend(month, userId, count = 6) {
  const key = `${month}|${userId}|${count}`;
  const [result, setResult] = useState({ key: null, data: null });

  useEffect(() => {
    let active = true;
    api
      .getKpiTrend(userId, month, count)
      .then((data) => active && setResult({ key, data }))
      .catch(() => active && setResult({ key, data: null }));
    return () => {
      active = false;
    };
  }, [key, month, userId, count]);

  return result.key === key ? result.data : null;
}
