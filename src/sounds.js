// Small sound-effect helper. Files live in public/sounds/.
const FILES = {
  login: "/sounds/login.mp3",
  signup: "/sounds/sign-up.mp3",
  sent: "/sounds/message-sent.mp3",
  received: "/sounds/message-received.mp3",
  notification: "/sounds/notification.mp3",
};

const cache = {};
const lastPlayed = {};

// The same sound never retriggers within this window (polling can report one
// event twice), and a message "ding" is skipped right after a notification.
const COOLDOWN_MS = 800;
const NOTIFICATION_SHADOW_MS = 1200;

export function playSound(name, volume = 0.7) {
  try {
    const now = Date.now();
    if (now - (lastPlayed[name] || 0) < COOLDOWN_MS) return;
    if (name === "received" && now - (lastPlayed.notification || 0) < NOTIFICATION_SHADOW_MS) return;
    lastPlayed[name] = now;
    const audio = cache[name] || (cache[name] = new Audio(FILES[name]));
    audio.volume = volume;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch {
    // Audio unavailable; ignore.
  }
}
