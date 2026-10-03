import { useEffect, useState } from "react";

import { api } from "./api";

// Loads the SQL-aggregated report for the given filters and re-loads whenever
// they change. `isLoading` is derived (the stored result belongs to a different
// filter set), so charts show their skeleton straight away without an
// effect-driven state flip.
export default function useReportData(filters, userId) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([filters, userId, attempt]);
  const [result, setResult] = useState({ key: null, data: null, error: null });

  useEffect(() => {
    let active = true;
    api
      .getReportSummary({ userId, ...filters })
      .then((data) => active && setResult({ key, data, error: null }))
      .catch((error) =>
        active && setResult({ key, data: null, error: error.message || "Could not load the report." }),
      );
    return () => {
      active = false;
    };
  }, [key, filters, userId]);

  const isCurrent = result.key === key;
  return {
    data: isCurrent ? result.data : null,
    error: isCurrent ? result.error : null,
    isLoading: !isCurrent,
    reload: () => setAttempt((value) => value + 1),
  };
}
