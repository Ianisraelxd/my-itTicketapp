import { useState } from "react";

import { api } from "./api";

// Two-step verification (authenticator app) for staff accounts, shown inside the profile dialog.
export default function MfaSettings({ enabled, onBack, onChanged, showMessage }) {
  const [setup, setSetup] = useState(null); // { secret, otpauthUrl } while enrolling
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      setSetup(await api.mfaSetup());
    } catch (error) {
      showMessage("Could not start the setup", error.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.mfaEnable(code);
      showMessage("Two-step verification is on", "From now on you will be asked for a code from your authenticator app when you sign in.");
      setSetup(null);
      setCode("");
      onChanged();
      onBack();
    } catch (error) {
      showMessage("That code did not work", error.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.mfaDisable(code);
      showMessage("Two-step verification is off", "You can turn it on again at any time.");
      setCode("");
      onChanged();
      onBack();
    } catch (error) {
      showMessage("That code did not work", error.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mfa-settings">
      <button type="button" className="text-button profile-back" onClick={onBack}>
        ← Back to profile
      </button>
      <h3>Two-step verification</h3>

      {enabled ? (
        <form onSubmit={turnOff}>
          <p className="mfa-note">
            It is <b>on</b>. To turn it off, enter the current 6-digit code from your authenticator app.
          </p>
          <label className="field-label">
            6-digit code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              required
            />
          </label>
          <button type="submit" className="button button-outline full-width" disabled={busy || code.replace(/\s/g, "").length !== 6}>
            Turn off
          </button>
        </form>
      ) : !setup ? (
        <>
          <p className="mfa-note">
            Protect your account with a code from an authenticator app (Google Authenticator, Microsoft
            Authenticator or Authy). Even if someone learns your password they cannot sign in without
            your phone.
          </p>
          <button type="button" className="button button-primary full-width" disabled={busy} onClick={start}>
            Set up two-step verification
          </button>
        </>
      ) : (
        <form onSubmit={confirm}>
          <ol className="mfa-steps">
            <li>Open your authenticator app and add an account with <b>Enter a setup key</b>.</li>
            <li>
              Paste this key (time-based):
              <code className="mfa-secret">{setup.secret}</code>
              <a className="link-button" href={setup.otpauthUrl}>
                Open in authenticator app
              </a>
            </li>
            <li>Type the 6-digit code the app shows to finish.</li>
          </ol>
          <label className="field-label">
            6-digit code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              required
              autoFocus
            />
          </label>
          <button type="submit" className="button button-primary full-width" disabled={busy || code.replace(/\s/g, "").length !== 6}>
            Turn on
          </button>
        </form>
      )}
    </div>
  );
}
