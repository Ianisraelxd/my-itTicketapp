import { useEffect, useState, useSyncExternalStore } from "react";

import { getBusy, subscribeBusy } from "./api";

/** A small spinning ring for buttons and short waits. */
export function Spinner({ size = 16, label }) {
  return (
    <span className="spinner" style={{ width: size, height: size }} role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : "true"} />
  );
}

/** Button content that swaps to a spinner and a "...ing" text while `busy` is true. */
export function BusyLabel({ busy, busyText, children }) {
  return busy ? (
    <>
      <Spinner />
      <span>{busyText}</span>
    </>
  ) : (
    children
  );
}

/** Placeholder rows shown while a list is loading the first time. */
export function TableSkeleton({ rows = 5, columns = 6 }) {
  return (
    <div className="table-skeleton" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, row) => (
        <div className="table-skeleton-row" key={row} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }, (_, column) => (
            <i key={column} style={{ width: `${55 + ((row * 7 + column * 13) % 40)}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The page-wide feedback: a bar along the top while anything is loading, and a note at the bottom
 * while something is being saved. After a few seconds the note tells people to be patient and NOT to
 * press the button again (a slow connection looks like a frozen page).
 */
export default function BusyIndicator() {
  const busy = useSyncExternalStore(subscribeBusy, getBusy);
  const writing = busy.writing > 0;
  const [stage, setStage] = useState(0); // 0 hidden, 1 "Saving", 2 "Taking longer than usual"

  useEffect(() => {
    if (!writing) return undefined;
    const showSoon = setTimeout(() => setStage(1), 350);
    const showSlow = setTimeout(() => setStage(2), 4000);
    return () => {
      clearTimeout(showSoon);
      clearTimeout(showSlow);
      setStage(0);
    };
  }, [writing]);

  return (
    <>
      <div className={`top-progress ${busy.pending > 0 ? "on" : ""}`} role="progressbar" aria-hidden={busy.pending === 0} aria-label="Loading">
        <i />
      </div>
      {writing && stage > 0 && (
        <div className={`busy-pill ${stage === 2 ? "slow" : ""}`} role="status" aria-live="polite">
          <Spinner size={16} />
          <span>
            {stage === 2
              ? "This is taking longer than usual (slow connection?). Please wait, and do not press the button again."
              : "Working on it…"}
          </span>
        </div>
      )}
    </>
  );
}
