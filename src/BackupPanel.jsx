import { useEffect, useState } from "react";

import { api } from "./api";

const size = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const when = (value) => new Date(value).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Daily database backups: when they run, what exists, a button to make one now. Super admin only. */
export default function BackupPanel({ showMessage }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    api
      .getBackups()
      .then((data) => active && setInfo(data))
      .catch(() => active && setInfo({ files: [], failed: true }));
    return () => {
      active = false;
    };
  }, [version]);

  async function backUpNow() {
    setBusy(true);
    try {
      const made = await api.createBackup();
      showMessage("Backup created", `${made.name} (${size(made.size)}) was saved on the server.`);
      setVersion((value) => value + 1);
    } catch (error) {
      showMessage("Backup failed", error.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel backup-panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">BACKUPS</span>
          <h2>Database backups</h2>
          <p>
            {info?.enabled === false
              ? "Automatic backups are switched off (BACKUP=false)."
              : `A backup is made automatically every day after ${String(info?.hour ?? 2).padStart(2, "0")}:00 and the newest ${info?.keep ?? 14} are kept.`}{" "}
            Download one and keep a copy somewhere else too.
          </p>
        </div>
        <button type="button" className="button button-primary" onClick={backUpNow} disabled={busy}>
          {busy ? "Backing up…" : "Back up now"}
        </button>
      </div>
      {info?.failed && <p className="help-empty">The backup list could not be loaded.</p>}
      {info && !info.failed && info.files.length === 0 && <p className="help-empty">No backup yet. The first one is made tonight, or press Back up now.</p>}
      {info?.files.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Made</th>
                <th>Size</th>
                <th aria-label="Download" />
              </tr>
            </thead>
            <tbody>
              {info.files.map((file) => (
                <tr key={file.name}>
                  <td>{file.name}</td>
                  <td>{when(file.createdAt)}</td>
                  <td>{size(file.size)}</td>
                  <td>
                    <button type="button" className="table-button" onClick={() => api.downloadBackup(file.name).catch((e) => showMessage("Download failed", e.message))}>
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="history-note">
        To restore: stop the server, then run <code>node scripts/restore-backup.mjs backups/daily/&lt;file&gt;</code>.
      </p>
    </section>
  );
}
