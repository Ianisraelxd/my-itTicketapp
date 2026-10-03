// Browser-side preferences, persisted in localStorage.
export const APP_VERSION = "v1.0.2";
export const APP_DESCRIPTION =
  "Campus HelpDesk is a role-based IT support desk. Students and employees submit and track technical requests, technicians work their queue, and admins keep everything moving.";

const STORAGE_KEY = "helpdesk-settings-v1";

export const DEFAULT_SETTINGS = { muted: false, volume: 0.8 };

function clampVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SETTINGS.volume;
  return Math.min(1, Math.max(0, number));
}

// Reads saved settings, falling back to defaults if storage is empty,
// blocked (private windows) or corrupted.
export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      muted: typeof saved.muted === "boolean" ? saved.muted : DEFAULT_SETTINGS.muted,
      volume: saved.volume === undefined ? DEFAULT_SETTINGS.volume : clampVolume(saved.volume),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable; the settings still apply until the page closes.
  }
}

export const SETTINGS_STORAGE_KEY = STORAGE_KEY;
