import { useState } from "react";

// Presentation only: all data and actions come in through `archive` (useArchive).

const PRESETS = [
  ["1 year", 1],
  ["2 years", 2],
  ["3 years", 3],
  ["5 years", 5],
];

function yearsAgo(years) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

const formatDate = (value) => (value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never");

function StatSkeleton() {
  return <span className="gov-skeleton gov-skeleton-stat" aria-hidden="true"></span>;
}

export function TableSkeleton({ rows = 3, columns = 5 }) {
  return (
    <div className="table-skeleton" role="status" aria-busy="true" aria-label="Loading table">
      {Array.from({ length: rows }, (_, row) => (
        <div className="table-skeleton-row" key={row} style={{ animationDelay: `${row * 90}ms` }}>
          {Array.from({ length: columns }, (_, column) => (
            <span key={column} style={{ flex: column === 0 ? 2 : 1 }}></span>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function ArchivePanel({ archive }) {
  const [before, setBefore] = useState(() => yearsAgo(3));
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState(null);

  const { overview, runs, preview, busy, isLoading, error } = archive;
  const maxDate = (() => {
    const date = new Date();
    date.setDate(date.getDate() - (overview?.minRetentionDays ?? 30));
    return date.toISOString().slice(0, 10);
  })();

  async function confirmArchive() {
    const outcome = await archive.runArchive(before);
    setConfirming(false);
    setTyped("");
    if (outcome) setResult(outcome);
  }

  const stats = [
    ["Active tickets", overview?.activeTickets],
    ["Archived tickets", overview?.archivedTickets],
    ["Archive runs", overview?.archiveRuns],
    ["Last archive", overview ? formatDate(overview.lastArchiveAt) : undefined],
  ];

  return (
    <section className="panel gov-panel" aria-label="Data archiving">
      <div className="gov-head">
        <div>
          <span className="eyebrow">DATA RETENTION</span>
          <h2>Archive old tickets, never lose them</h2>
          <p>
            Finished tickets older than your retention date are copied to the archive together with
            their conversations, saved as a backup file you can download, and only then removed from
            the live list.
          </p>
        </div>
      </div>

      <div className="gov-stats">
        {stats.map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            {isLoading ? <StatSkeleton /> : <strong>{error ? "–" : value ?? "–"}</strong>}
          </div>
        ))}
      </div>

      {error && (
        <p className="gov-error" role="alert">
          {error}{" "}
          <button type="button" className="link-button" onClick={archive.reload}>
            Try again
          </button>
        </p>
      )}

      <div className="gov-policy">
        <label className="field-label">
          Archive finished tickets last active before
          <input
            type="date"
            value={before}
            max={maxDate}
            onChange={(event) => {
              setBefore(event.target.value);
              archive.clearPreview();
              setResult(null);
            }}
          />
        </label>
        <div className="kpi-chips" role="group" aria-label="Retention presets">
          {PRESETS.map(([label, years]) => (
            <button
              key={label}
              type="button"
              className={before === yearsAgo(years) ? "active" : ""}
              onClick={() => {
                setBefore(yearsAgo(years));
                archive.clearPreview();
                setResult(null);
              }}
            >
              Older than {label}
            </button>
          ))}
        </div>
        <p className="gov-hint">
          Resolved and cancelled tickets only; open tickets are never archived. At least the last{" "}
          {overview?.minRetentionDays ?? 30} days always stay.
        </p>

        <div className="gov-actions">
          <button
            type="button"
            className="button button-outline"
            disabled={!before || busy !== null}
            onClick={() => archive.previewCutoff(before)}
          >
            {busy === "preview" ? "Checking…" : "Check what would move"}
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={!before || busy !== null || (preview && preview.tickets === 0)}
            onClick={() => setConfirming(true)}
          >
            Mass Export &amp; Archive
          </button>
        </div>

        {preview && (
          <p className={`gov-preview ${preview.tickets === 0 ? "none" : ""}`} role="status">
            {preview.tickets === 0
              ? "Nothing to archive before that date."
              : `${preview.tickets} ticket${preview.tickets === 1 ? "" : "s"} and ${preview.messages} message${preview.messages === 1 ? "" : "s"} would be archived.`}
          </p>
        )}
        {result && (
          <div className="gov-result" role="status">
            <strong>
              {result.archived === 0
                ? "Nothing needed archiving."
                : `Archived ${result.archived} ticket${result.archived === 1 ? "" : "s"}, ${result.messages} message${result.messages === 1 ? "" : "s"}.`}
            </strong>
            {result.runId && (
              <div className="gov-actions">
                <button type="button" className="table-button" onClick={() => archive.downloadRun(result.runId, "json")}>
                  Download JSON backup
                </button>
                <button type="button" className="table-button light" onClick={() => archive.downloadRun(result.runId, "csv")}>
                  Download CSV
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="gov-history">
        <span className="eyebrow">ARCHIVE HISTORY</span>
        {isLoading ? (
          <TableSkeleton rows={3} columns={5} />
        ) : runs.length === 0 ? (
          <p className="report-empty">No archive has been run yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Run by</th>
                  <th>Before</th>
                  <th>Tickets</th>
                  <th>Messages</th>
                  <th>Backup</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{formatDate(run.createdAt)}</td>
                    <td>{run.runBy || "—"}</td>
                    <td>{run.beforeDate}</td>
                    <td>
                      <strong>{run.tickets}</strong>
                    </td>
                    <td>{run.messages}</td>
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="table-button"
                          disabled={!run.jsonAvailable}
                          onClick={() => archive.downloadRun(run.id, "json")}
                        >
                          JSON
                        </button>
                        <button
                          type="button"
                          className="table-button light"
                          disabled={!run.csvAvailable}
                          onClick={() => archive.downloadRun(run.id, "csv")}
                        >
                          CSV
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirming && (
        <div className="modal-backdrop" onClick={() => busy === null && setConfirming(false)}>
          <form
            className="modal-box"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              if (typed === "ARCHIVE") confirmArchive();
            }}
          >
            <div className="modal-icon warn-icon">!</div>
            <h3>Archive tickets before {before}?</h3>
            <p>
              {preview
                ? `${preview.tickets} ticket${preview.tickets === 1 ? "" : "s"} will be exported to a backup file, copied to the archive and removed from the live list.`
                : "Finished tickets before that date will be exported to a backup file, copied to the archive and removed from the live list."}{" "}
              Nothing is permanently deleted.
            </p>
            <label className="field-label dialog-note">
              Type <b>ARCHIVE</b> to continue
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                autoFocus
              />
            </label>
            <div className="dialog-actions">
              <button type="button" className="button button-outline" disabled={busy !== null} onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button type="submit" className="button button-primary" disabled={typed !== "ARCHIVE" || busy !== null}>
                {busy === "archive" ? "Archiving…" : "Export & archive"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
