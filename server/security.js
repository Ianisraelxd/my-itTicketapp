// Password hashing, JWT sessions and TOTP two-step verification.
// Uses Node's built-in crypto (scrypt, HMAC) plus jsonwebtoken for tokens.
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import jwt from "jsonwebtoken";

// --- Passwords -----------------------------------------------------------------
// Stored as "scrypt$<salt hex>$<hash hex>". Older plaintext rows are accepted
// once and upgraded to a hash at the next successful login.
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, KEY_LENGTH, SCRYPT, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export const isHashed = (stored) => typeof stored === "string" && stored.startsWith("scrypt$");

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (!isHashed(stored)) {
    // Legacy plaintext row: constant-time compare.
    const a = Buffer.from(String(password));
    const b = Buffer.from(String(stored));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const [, saltHex, hashHex] = stored.split("$");
  const key = await scrypt(password, Buffer.from(saltHex, "hex"));
  const expected = Buffer.from(hashHex, "hex");
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
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
    { sub: String(user.user_pk), role: user.role, name: user.name, purpose: "session" },
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
