// Creates public/sounds/login.wav: a short, soft three-note chime (C, E, G) for a successful sign-in.
// It is synthesised here, so the sound has no licensing questions. Run: node scripts/make-login-sound.mjs
import fs from "node:fs";

const RATE = 44100;
const NOTES = [
  { freq: 523.25, start: 0.0 }, // C5
  { freq: 659.25, start: 0.13 }, // E5
  { freq: 783.99, start: 0.26 }, // G5
];
const LENGTH = 1.1;
const samples = new Float32Array(Math.floor(RATE * LENGTH));

for (const { freq, start } of NOTES) {
  const from = Math.floor(start * RATE);
  for (let i = from; i < samples.length; i += 1) {
    const t = (i - from) / RATE;
    const attack = Math.min(1, t / 0.008); // no click at the start
    const decay = Math.exp(-t * 4.2); // bell-like fade
    // a pure tone with a quiet second and third harmonic gives a soft, glassy bell
    const wave = Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(2 * Math.PI * freq * 2 * t) * Math.exp(-t * 7) + 0.12 * Math.sin(2 * Math.PI * freq * 3 * t) * Math.exp(-t * 11);
    samples[i] += wave * attack * decay * 0.3;
  }
}
// fade the very end to silence and normalise
for (let i = 0; i < 2000; i += 1) samples[samples.length - 1 - i] *= i / 2000;
const peak = Math.max(...samples.map(Math.abs)) || 1;

const data = Buffer.alloc(samples.length * 2);
samples.forEach((value, i) => data.writeInt16LE(Math.round((value / peak) * 0.85 * 32767), i * 2));
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);
fs.writeFileSync(new URL("../public/sounds/login.wav", import.meta.url), Buffer.concat([header, data]));
console.log(`public/sounds/login.wav written (${((header.length + data.length) / 1024).toFixed(0)} KB, ${LENGTH}s)`);
