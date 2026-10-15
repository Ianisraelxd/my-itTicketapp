// Live password rules (the same file the server enforces) and the change-password dialog.
import { useState } from "react";

import { evaluatePassword } from "../shared/passwordPolicy.js";
import { api, setAuthToken } from "./api";
import Icon from "./icons";

const COLORS = ["var(--bad-fg, #b42318)", "var(--bad-fg, #b42318)", "var(--warn-fg, #b54708)", "var(--good-fg, #067647)", "var(--good-fg, #067647)"];

export function PasswordStrength({ password, context }) {
  if (!password) return null;
  const result = evaluatePassword(password, context);
  return (
    <div className="pw-strength" aria-live="polite">
      <div className="pw-meter" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} style={{ background: i < result.score ? COLORS[result.score] : "var(--line)" }} />
        ))}
      </div>
      <strong style={{ color: COLORS[result.score] }}>{result.label}</strong>
      <ul className="pw-checks">
        {result.checks.map((check) => (
          <li key={check.key} className={check.ok ? "pw-ok" : "pw-todo"}>
            <Icon name={check.ok ? "check" : "info"} size={14} /> {check.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PasswordInput({ label, value, onChange, autoComplete }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field-label">
      {label}
      <span className="password-input">
        <input
          type={visible ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          required
        />
        <button
          type="button"
          className="eye-button pw-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          title={visible ? "Hide password" : "Show password"}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );
}

/** forced = a new account must choose its own password before using the app (no way to close it). */
export function ChangePasswordModal({ user, forced, onDone, onClose }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const context = { id: user.id, name: user.name, email: user.email };
  const result = evaluatePassword(form.next, context);
  const mismatch = form.confirm && form.confirm !== form.next;

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    if (!result.ok) return setError(result.problems[0]);
    if (form.next !== form.confirm) return setError("The two new passwords do not match.");
    setSaving(true);
    setError("");
    try {
      const reply = await api.changePassword({ currentPassword: form.current, newPassword: form.next });
      setAuthToken(reply.token);
      onDone();
    } catch (e) {
      setError(e.message || "Could not change the password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={forced ? undefined : onClose}>
      <form className="modal-box profile-form" onClick={(event) => event.stopPropagation()} onSubmit={submit}>
        <div className="modal-icon"><Icon name="key" size={26} /></div>
        <h3>{forced ? "Choose your own password" : "Change password"}</h3>
        <p>
          {forced
            ? "You are using a temporary password. Choose a new one before you continue."
            : "Other devices will be signed out when you change it."}
        </p>
        <PasswordInput label={forced ? "Temporary password" : "Current password"} value={form.current} autoComplete="current-password" onChange={(v) => setForm({ ...form, current: v })} />
        <PasswordInput label="New password" value={form.next} autoComplete="new-password" onChange={(v) => setForm({ ...form, next: v })} />
        <PasswordStrength password={form.next} context={context} />
        <PasswordInput label="Confirm new password" value={form.confirm} autoComplete="new-password" onChange={(v) => setForm({ ...form, confirm: v })} />
        {mismatch && <p className="form-error">The two new passwords do not match.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary full-width" type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save new password"}
        </button>
        {!forced && (
          <button type="button" className="button button-outline full-width" onClick={onClose}>Cancel</button>
        )}
      </form>
    </div>
  );
}
