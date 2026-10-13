import { useEffect, useState } from "react";

import { api } from "./api";

// "Email and text alerts" inside the profile dialog.
export default function AlertSettings({ onBack, showMessage }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getAlerts()
      .then((data) => active && setForm(data))
      .catch(() => showMessage("Could not load your alert settings", "Please try again."));
    return () => {
      active = false;
    };
  }, [showMessage]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.saveAlerts({ emailAlerts: form.emailAlerts, phone: form.phone });
      showMessage("Saved", "Your alert settings were updated.");
      onBack();
    } catch (error) {
      showMessage("Could not save", error.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <p className="history-note">Loading…</p>;
  return (
    <form className="alert-settings" onSubmit={save}>
      <h3>Email and text alerts</h3>
      <p className="history-note">
        We can email you when an agent is assigned, a request is urgent or your problem is resolved.
        {form.emailMode === "off" && " Emails are not set up on this server yet, so nothing will be sent until the administrator turns them on."}
      </p>
      <label className="check-row">
        <input type="checkbox" checked={form.emailAlerts} onChange={(event) => setForm({ ...form, emailAlerts: event.target.checked })} />
        Send alerts to {form.email || "my email"}
      </label>
      <label className="field-label">
        Mobile number for urgent text messages (optional)
        <input
          type="tel"
          inputMode="tel"
          placeholder="+63 912 345 6789"
          value={form.phone}
          onChange={(event) => setForm({ ...form, phone: event.target.value })}
        />
      </label>
      {!form.smsConfigured && form.phone && <p className="history-note">Text messages are not set up on this server yet; your number is stored for when they are.</p>}
      <div className="profile-actions">
        <button type="submit" className="button button-primary full-width" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="button button-outline full-width" onClick={onBack}>
          Back
        </button>
      </div>
    </form>
  );
}
