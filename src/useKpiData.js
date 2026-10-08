import { useEffect, useState } from "react";

import { api } from "./api";

// Loads the KPI scorecard for one month ("2026-10"). Like useReportData,
// isLoading is derived from which month/attempt the stored result belongs to,
// so switching month shows the skeleton immediately.
export default function useKpiData(month, userId) {
  const [attempt, setAttempt] = useState(0);
  const key = `${month}|${userId}|${attempt}`;
  const [result, setResult] = useState({ key: null, data: null, error: null });

  useEffect(() => {
    let active = true;
    api
      .getKpi(userId, month)
      .then((data) => active && setResult({ key, data, error: null }))
      .catch((error) =>
        active && setResult({ key, data: null, error: error.message || "Could not load the KPIs." }),
      );
    return () => {
      active = false;
    };
  }, [key, month, userId]);

  const isCurrent = result.key === key;
  return {
    data: isCurrent ? result.data : null,
    error: isCurrent ? result.error : null,
    isLoading: !isCurrent,
    reload: () => setAttempt((value) => value + 1),
  };
}
