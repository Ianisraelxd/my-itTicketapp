// Browser-side preferences, persisted in localStorage.
export const APP_VERSION = "v1.0.2";
export const APP_DESCRIPTION =
  "Campus HelpDesk is a role-based IT support desk. Students and employees submit and track technical requests, technicians work their queue, and admins keep everything moving.";

const STORAGE_KEY = "helpdesk-settings-v1";

export const THEMES = ["light", "dark", "system"];
// "on"     = always animate (even if the device asks for reduced motion)
// "device" = follow the device's reduce-motion setting
// "off"    = no animations
export const MOTION_MODES = ["on", "device", "off"];

export const DEFAULT_SETTINGS = { muted: false, volume: 0.8, theme: "light", motion: "on" };

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
      theme: THEMES.includes(saved.theme) ? saved.theme : DEFAULT_SETTINGS.theme,
      motion: MOTION_MODES.includes(saved.motion) ? saved.motion : DEFAULT_SETTINGS.motion,
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

// --- Appearance ------------------------------------------------------------
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");
const reduceQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)");

// True when the device itself asks for less motion.
export function deviceReducesMotion() {
  try {
    return reduceQuery().matches;
  } catch {
    return false;
  }
}

// Should JS-driven animations (like the number count-up) run right now?
export function motionAllowed(settings = loadSettings()) {
  if (settings.motion === "off") return false;
  if (settings.motion === "device") return !deviceReducesMotion();
  return true;
}

// Sets <html data-theme="light|dark" data-motion="on|device|off">; the CSS does the rest.
export function applyAppearance(settings = loadSettings()) {
  const root = document.documentElement;
  let theme = settings.theme;
  if (theme === "system") {
    try {
      theme = darkQuery().matches ? "dark" : "light";
    } catch {
      theme = "light";
    }
  }
  root.dataset.theme = theme;
  root.dataset.motion = settings.motion;
  root.style.colorScheme = theme;
}

// Run once at startup: apply the saved look and follow the OS theme live
// while "System" is selected.
export function initAppearance() {
  applyAppearance();
  try {
    darkQuery().addEventListener("change", () => applyAppearance());
  } catch {
    // Older browsers: the theme is simply applied once.
  }
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) applyAppearance();
  });
}
