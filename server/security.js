// Password hashing, JWT sessions and TOTP two-step verification.
// Uses Node's built-in crypto (scrypt, HMAC) plus jsonwebtoken for tokens.
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import jwt from "jsonwebtoken";

// --- Passwords -----------------------------------------------------------------
// scrypt (memory-hard, so graphics cards and custom chips gain little), a fresh random 16-byte salt per
// password, and the cost settings stored inside every hash:
//
//     scrypt$<N>$<r>$<p>$<salt hex>$<hash hex>
//
// Because the settings travel with the hash, the cost can be raised later: needsRehash() tells the sign-in
// code to quietly store a stronger hash the next time the person types their correct password. Older formats
// ("scrypt$<salt>$<hash>" with the old settings, or plaintext from very early seed data) are still accepted
// once and upgraded the same way.
export const SCRYPT_PARAMS = { N: 32768, r: 8, p: 3 }; // OWASP's recommended N = 2^15, r = 8, p = 3 (32 MiB)
const LEGACY_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const MAX_MEMORY = 128 * 1024 * 1024;

function scrypt(password, salt, params, keyLength) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, keyLength, { ...params, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export const isHashed = (stored) => typeof stored === "string" && stored.startsWith("scrypt$");

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT_PARAMS, KEY_LENGTH);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

function parseHash(stored) {
  const parts = stored.split("$");
  if (parts.length === 6) {
    const [, N, r, p, saltHex, hashHex] = parts;
    return { params: { N: Number(N), r: Number(r), p: Number(p) }, saltHex, hashHex };
  }
  if (parts.length === 3 && /^[0-9a-f]+$/.test(parts[1]) && /^[0-9a-f]+$/.test(parts[2])) {
    return { params: LEGACY_PARAMS, saltHex: parts[1], hashHex: parts[2] };
  }
  return null;
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof password !== "string") return false;
  if (!isHashed(stored)) {
    // Plaintext row from the earliest seed data: constant-time compare, then it gets hashed.
    const a = Buffer.from(String(password));
    const b = Buffer.from(String(stored));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const parsed = parseHash(stored);
  if (!parsed || !/^[0-9a-f]+$/.test(parsed.saltHex) || !/^[0-9a-f]+$/.test(parsed.hashHex)) return false;
  const expected = Buffer.from(parsed.hashHex, "hex");
  const key = await scrypt(password, Buffer.from(parsed.saltHex, "hex"), parsed.params, expected.length);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/** True when a stored password should be re-hashed with today's settings (plaintext, old format, weaker cost). */
export function needsRehash(stored) {
  if (!isHashed(stored)) return true;
  const parsed = parseHash(stored);
  if (!parsed) return false; // a locked marker such as scrypt$locked$locked is never rehashed
  return (
    parsed.params.N < SCRYPT_PARAMS.N ||
    parsed.params.r < SCRYPT_PARAMS.r ||
    parsed.params.p < SCRYPT_PARAMS.p ||
    parsed.hashHex.length < KEY_LENGTH * 2
  );
}

// An unknown ID must take as long as a wrong password, otherwise the response time tells an attacker which
// IDs exist. Verifying against this throw-away hash costs the same.
let decoy = null;
export async function spendPasswordTime(password) {
  decoy ??= await hashPassword(crypto.randomBytes(12).toString("hex"));
  await verifyPassword(password, decoy);
  return false;
}

// --- Sessions (JWT) --------------------------------------------------------------
// The signing secret comes from JWT_SECRET. If it is not set, one is generated the first time
// the API starts and kept in server/.jwt-secret (gitignored), so sessions survive restarts.
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = fileURLToPath(new URL("./.jwt-secret", import.meta.url));
  try {
    const saved = fs.readFileSync(file, "utf8").trim();
    if (saved.length >= 32) return saved;
  } catch {
    // not created yet
  }
  const generated = crypto.randomBytes(48).toString("hex");
  try {
    fs.writeFileSync(file, generated, { mode: 0o600 });
    console.log("Created server/.jwt-secret for signing sessions (set JWT_SECRET to use your own).");
  } catch {
    console.warn("Could not save a JWT secret: sessions will end when the API restarts.");
  }
  return generated;
}
const secret = loadSecret();

const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 8;

export function signSession(user) {
  return jwt.sign(
    { sub: String(user.user_pk), role: user.role, name: user.name, tv: Number(user.token_version) || 0, purpose: "session" },
    secret,
    { expiresIn: `${SESSION_HOURS}h` },
  );
}

// Short-lived token proving the password step passed; only good for the MFA code step.
export function signMfaChallenge(user) {
  return jwt.sign({ sub: String(user.user_pk), purpose: "mfa" }, secret, { expiresIn: "5m" });
}

export function verifyToken(token, purpose) {
  try {
    const payload = jwt.verify(token, secret);
    return payload.purpose === purpose ? payload : null;
  } catch {
    return null;
  }
}

// --- TOTP (RFC 6238, as used by Google Authenticator, Microsoft Authenticator, Authy) ---
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(text) {
  let bits = "";
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index >= 0) bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totpAt(secretText, counter) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secretText)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

// Accepts the current 30-second code and one step either side for clock drift.
export function verifyTotp(secretText, code) {
  const clean = String(code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean) || !secretText) return false;
  const counter = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((step) => {
    const expected = Buffer.from(totpAt(secretText, counter + step));
    const given = Buffer.from(clean);
    return crypto.timingSafeEqual(expected, given);
  });
}

export const otpauthUrl = (secretText, account) =>
  `otpauth://totp/${encodeURIComponent(`Campus HelpDesk:${account}`)}?secret=${secretText}&issuer=${encodeURIComponent("Campus HelpDesk")}&digits=6&period=30`;
