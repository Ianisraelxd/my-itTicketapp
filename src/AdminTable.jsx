import { useState } from "react";

import { TableSkeleton } from "./ArchivePanel";

// Presentation only: data and actions come from useAdminManagement via `management`.

const formatDate = (value) => (value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never");

export default function AdminTable({ management }) {
  const { admins, candidates, isLoading, error, busyId } = management;
  const [confirm, setConfirm] = useState(null); // { account, action }
  const [grantTo, setGrantTo] = useState("");
  const [grantAs, setGrantAs] = useState("grant");

  const locked = admins.filter((account) => account.locked).length;

  async function runConfirmed() {
    const { account, action } = confirm;
    setConfirm(null);
    await management.act(account.userId, action, account.name);
  }

  async function grant(event) {
    event.preventDefault();
    const person = candidates.find((item) => String(item.userId) === grantTo);
    if (!person) return;
    const done = await management.act(person.userId, grantAs, person.name);
    if (done) setGrantTo("");
  }

  return (
    <section className="panel gov-panel" aria-label="Privileged accounts">
      <div className="gov-head">
        <div>
          <span className="eyebrow">ACCESS CONTROL</span>
          <h2>IT Ops Admins &amp; Report Viewers</h2>
          <p>
            Grant or revoke admin access, give people read-only dashboard access, and clear a lockout
            or two-step verification for someone who is stuck.
          </p>
        </div>
        {!isLoading && locked > 0 && <span className="gov-badge warn">{locked} locked</span>}
      </div>

      {error && (
        <p className="gov-error" role="alert">
          {error}{" "}
          <button type="button" className="link-button" onClick={management.reload}>
            Try again
          </button>
        </p>
      )}

      {isLoading ? (
        <TableSkeleton rows={3} columns={6} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Access</th>
                <th>Two-step</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {admins.length === 0 && (
                <tr>
                  <td colSpan={6}>No admin or viewer accounts yet.</td>
                </tr>
              )}
              {admins.map((account) => {
                const busy = busyId === account.userId;
                return (
                  <tr key={account.userId}>
                    <td>
                      <strong>{account.name}</strong>
                      <div className="cell-sub">
                        {account.id} · {account.email || "no email"}
                      </div>
                    </td>
                    <td>
                      <span className={`gov-badge ${account.role === "admin" ? "info" : "muted"}`}>
                        {account.role === "admin" ? "Admin" : "Report Viewer"}
                      </span>
                    </td>
                    <td>
                      <span className={`gov-badge ${account.mfaEnabled ? "good" : "muted"}`}>
                        {account.mfaEnabled ? "On" : "Off"}
                      </span>
                    </td>
                    <td>
                      <span className={`gov-badge ${account.locked ? "bad" : "good"}`}>
                        {account.locked ? "Locked" : "Active"}
                      </span>
                    </td>
                    <td>{formatDate(account.lastLoginAt)}</td>
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="table-button"
                          disabled={!account.locked || busy}
                          onClick={() => management.act(account.userId, "unlock", account.name)}
                        >
                          Override lockout
                        </button>
                        <button
                          type="button"
                          className="table-button light"
                          disabled={!account.mfaEnabled || busy}
                          onClick={() => setConfirm({ account, action: "reset_mfa" })}
                        >
                          Reset MFA
                        </button>
                        <button
                          type="button"
                          className="table-button danger"
                          disabled={busy}
                          onClick={() => setConfirm({ account, action: "revoke" })}
                        >
                          Revoke access
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <form className="gov-grant" onSubmit={grant}>
        <span className="eyebrow">GIVE ACCESS</span>
        <div className="gov-grant-row">
          <label className="field-label">
            Person
            <select value={grantTo} onChange={(event) => setGrantTo(event.target.value)} disabled={isLoading}>
              <option value="">Choose an employee or technician…</option>
              {candidates.map((person) => (
                <option key={person.userId} value={person.userId}>
                  {person.name} ({person.roleName})
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Access
            <select value={grantAs} onChange={(event) => setGrantAs(event.target.value)}>
              <option value="grant">Admin (manage requests and users)</option>
              <option value="grant_viewer">Report Viewer (read-only dashboards)</option>
            </select>
          </label>
          <button type="submit" className="button button-primary" disabled={!grantTo || busyId !== null}>
            Grant access
          </button>
        </div>
      </form>

      {confirm && (
        <div className="modal-backdrop" onClick={() => setConfirm(null)}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()}>
            <div className="modal-icon warn-icon">!</div>
            <h3>{confirm.action === "revoke" ? "Revoke access?" : "Reset two-step verification?"}</h3>
            <p>
              {confirm.action === "revoke"
                ? `${confirm.account.name} becomes a regular Employee and loses ${confirm.account.role === "admin" ? "admin" : "dashboard"} access straight away. Their history is kept.`
                : `${confirm.account.name} will be asked to set up two-step verification again from their profile.`}
            </p>
            <div className="dialog-actions">
              <button type="button" className="button button-outline" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button type="button" className="button button-primary" onClick={runConfirmed}>
                {confirm.action === "revoke" ? "Revoke access" : "Reset"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
