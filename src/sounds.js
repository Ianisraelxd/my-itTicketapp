// Small sound-effect helper. Files live in public/sounds/.
//
// Sounds are played through the Web Audio API so each one can be normalised:
// the supplied clips differ a lot in loudness (the message sounds peak at
// roughly a sixth of full scale), so every clip is scaled to the same peak.
const FILES = {
  login: "/sounds/login.mp3",
  signup: "/sounds/sign-up.mp3",
  sent: "/sounds/message-sent.mp3",
  received: "/sounds/message-received.mp3",
  notification: "/sounds/notification.mp3",
};

const TARGET_PEAK = 0.5;
const MAX_GAIN = 6;

// The same sound never retriggers within this window (polling can report one
// event twice), and a message "ding" is skipped right after a notification.
const COOLDOWN_MS = 800;
const NOTIFICATION_SHADOW_MS = 1200;

let context = null;
const buffers = {};
const gains = {};
const lastPlayed = {};

function getContext() {
  if (!context) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
  }
  return context;
}

async function loadBuffer(name) {
  if (buffers[name]) return buffers[name];
  const ctx = getContext();
  if (!ctx) return null;
  const response = await fetch(FILES[name]);
  const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i += 1) {
      const value = Math.abs(samples[i]);
      if (value > peak) peak = value;
    }
  }
  gains[name] = Math.min(MAX_GAIN, TARGET_PEAK / Math.max(peak, 0.01));
  buffers[name] = buffer;
  return buffer;
}

function playWithElement(name, volume) {
  const audio = new Audio(FILES[name]);
  audio.volume = Math.min(1, volume);
  audio.play().catch(() => {});
}

export function playSound(name, volume = 1) {
  if (typeof window === "undefined" || !FILES[name]) return;
  const now = Date.now();
  if (now - (lastPlayed[name] || 0) < COOLDOWN_MS) return;
  if (name === "received" && now - (lastPlayed.notification || 0) < NOTIFICATION_SHADOW_MS) return;
  lastPlayed[name] = now;

  (async () => {
    try {
      const ctx = getContext();
      if (!ctx) throw new Error("no audio context");
      if (ctx.state === "suspended") await ctx.resume();
      const buffer = await loadBuffer(name);
      if (!buffer) throw new Error("no buffer");
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = (gains[name] || 1) * volume;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
    } catch {
      playWithElement(name, volume);
    }
  })();
}

// Decode every clip after the first click or key press so the first sound of
// each kind plays without a delay (browsers only allow audio after a gesture).
if (typeof window !== "undefined") {
  const warmUp = () => {
    const ctx = getContext();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    Object.keys(FILES).forEach((name) => loadBuffer(name).catch(() => {}));
  };
  window.addEventListener("pointerdown", warmUp, { once: true });
  window.addEventListener("keydown", warmUp, { once: true });
}
