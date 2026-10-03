import { useState } from "react";

import {
  APP_DESCRIPTION,
  APP_VERSION,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
} from "./settings";
import { playSound, setSoundSettings } from "./sounds";

export function AboutModal({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box about-modal" onClick={(event) => event.stopPropagation()}>
        <span className="brand-mark about-mark">+</span>
        <h3>Campus HelpDesk</h3>
        <span className="version-pill">{APP_VERSION}</span>
        <p>{APP_DESCRIPTION}</p>
        <button className="button button-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

export function SettingsModal({ onClose }) {
  const [settings, setSettings] = useState(loadSettings);
  const [aboutOpen, setAboutOpen] = useState(false);

  function update(patch) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
    setSoundSettings(next);
  }

  // Let people hear the level they just picked.
  const preview = () => playSound("notification", 1, { force: true });

  const percent = Math.round(settings.volume * 100);

  return (
    <>
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box settings-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close settings" onClick={onClose}>
          ×
        </button>
        <h3>Settings</h3>
        <p className="settings-hint">Saved in this browser only.</p>

        <section className="settings-group">
          <span className="eyebrow">SOUND</span>

          <div className="settings-row">
            <div>
              <strong>Mute sounds</strong>
              <small>Silence login, message and notification sounds.</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.muted}
              aria-label="Mute sounds"
              className={`switch ${settings.muted ? "on" : ""}`}
              onClick={() => {
                const muted = !settings.muted;
                update({ muted });
                if (!muted) setTimeout(preview, 0);
              }}
            >
              <span></span>
            </button>
          </div>

          <div className={`settings-row settings-volume ${settings.muted ? "disabled" : ""}`}>
            <div>
              <strong>Volume</strong>
              <small>{settings.muted ? "Muted" : `${percent}%`}</small>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={percent}
              disabled={settings.muted}
              aria-label="Sound volume"
              onChange={(event) => update({ volume: Number(event.target.value) / 100 })}
              onPointerUp={preview}
              onKeyUp={preview}
            />
          </div>
        </section>

        <div className="settings-actions">
          <button type="button" className="button button-outline" onClick={() => setAboutOpen(true)}>
            About HelpDesk
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => update({ ...DEFAULT_SETTINGS })}
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
    {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </>
  );
}
