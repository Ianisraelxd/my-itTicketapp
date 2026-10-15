// The password rules, in one place. The server enforces them (signup, password changes, seeding) and the
// website imports the same file to show the live checklist and strength meter, so the two can never disagree.
// Pure functions only: no Node or browser APIs.

export const MIN_LENGTH = 10;
export const MAX_LENGTH = 128;

// Passwords people really use. A password is refused if it, or its "de-leeted" form with trailing digits and
// symbols removed, is on this list (so Password123! and P@ssw0rd2026 do not slip through).
const COMMON = new Set(`
password passw0rd pass123 password1 password12 password123 admin admin123 administrator root toor welcome welcome1 welcome123
login letmein letmein1 changeme change123 default guest user test test123 testing qwerty qwerty123 qwertyuiop asdfgh asdfghjkl
zxcvbn zxcvbnm azerty abc123 abcd1234 abcdefg 111111 000000 121212 123123 123321 654321 666666 1q2w3e 1q2w3e4r 1qaz2wsx
iloveyou iloveyou1 monkey dragon master sunshine princess football baseball soccer basketball superman batman spiderman
starwars pokemon naruto liverpool chelsea arsenal barcelona madrid shadow ninja hello hello123 freedom whatever trustno1
secret secret123 summer winter spring autumn flower lovely angel angel123 michael jennifer jessica ashley daniel andrew
charlie buster jordan hunter harley ranger thomas robert george tigger pepper cookie banana computer internet google
facebook youtube whatsapp helpdesk campus university student teacher school college philippines manila cebu davao
mamamo pinoy kapamilya mahalkita iloveyou2 babygirl lovelove ilovemom ilovedad mylove sweetie
`.split(/\s+/).filter(Boolean));

// Words that make a password weak wherever they appear inside it.
const BLOCKED_INSIDE = ["password", "passw0rd", "qwerty", "letmein", "iloveyou", "helpdesk", "123456", "abcdef", "asdfgh", "welcome", "admin123"];

const LEET = { 0: "o", 1: "l", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "!": "i" };

function deLeet(lower) {
  return [...lower].map((ch) => LEET[ch] ?? ch).join("");
}

const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];

function hasSequence(lower, run = 5) {
  const lines = [...KEYBOARD_ROWS, "abcdefghijklmnopqrstuvwxyz"];
  for (const line of lines) {
    const reversed = [...line].reverse().join("");
    for (let i = 0; i + run <= line.length; i += 1) {
      const piece = line.slice(i, i + run);
      const back = reversed.slice(i, i + run);
      if (lower.includes(piece) || lower.includes(back)) return true;
    }
  }
  return false;
}

const hasRepeat = (text) => /(.)\1{3,}/.test(text); // aaaa, 1111

function isCommon(lower) {
  if (COMMON.has(lower)) return true;
  const plain = deLeet(lower);
  if (COMMON.has(plain)) return true;
  // strip trailing digits / symbols and a leading digit run: "Password2026!" -> "password"
  const stripped = plain.replace(/[^a-z]+$/, "").replace(/^[^a-z]+/, "");
  if (stripped.length >= 4 && COMMON.has(stripped)) return true;
  return BLOCKED_INSIDE.some((word) => plain.includes(deLeet(word)));
}

function personalTokens({ id, name, email } = {}) {
  const tokens = new Set();
  const add = (value) => {
    const text = String(value ?? "").toLowerCase();
    if (text.replace(/[^a-z0-9]/g, "").length >= 4) tokens.add(text.replace(/[^a-z0-9]/g, ""));
  };
  add(id);
  for (const part of String(name ?? "").toLowerCase().split(/[^a-z0-9]+/)) if (part.length >= 4) tokens.add(part);
  add(String(email ?? "").split("@")[0]);
  return [...tokens];
}

/**
 * @param {string} password
 * @param {{id?: string, name?: string, email?: string}} who  the account, so its own details are refused
 * @returns {{ok: boolean, score: number, label: string, checks: {key: string, label: string, ok: boolean}[], problems: string[]}}
 */
export function evaluatePassword(password, who = {}) {
  const text = typeof password === "string" ? password : "";
  const lower = text.toLowerCase();
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(text)).length;
  const squashed = lower.replace(/[^a-z0-9]/g, "");
  const personal = personalTokens(who).some((token) => squashed.includes(token));

  const checks = [
    { key: "length", label: `At least ${MIN_LENGTH} characters`, ok: text.length >= MIN_LENGTH && text.length <= MAX_LENGTH },
    { key: "mix", label: "Three of these: lowercase, UPPERCASE, number, symbol", ok: classes >= 3 },
    { key: "common", label: "Not a common or easy-to-guess password", ok: text.length > 0 && !isCommon(lower) },
    { key: "personal", label: "Does not contain your name, ID or email", ok: text.length > 0 && !personal },
    { key: "pattern", label: "No repeated characters or sequences (aaaa, 12345, qwerty)", ok: text.length > 0 && !hasRepeat(lower) && !hasSequence(lower) },
  ];
  const ok = checks.every((check) => check.ok);

  let score = 0;
  if (text.length >= MIN_LENGTH) score += 1;
  if (text.length >= 14) score += 1;
  if (classes >= 3) score += 1;
  if (classes === 4 && new Set(text).size >= 8) score += 1;
  if (!ok) score = Math.min(score, 1);
  const labels = ["Too weak", "Weak", "Fair", "Good", "Strong"];
  return {
    ok,
    score,
    label: text ? labels[score] : "",
    checks,
    problems: checks.filter((check) => !check.ok).map((check) => check.label),
  };
}

/** One sentence for an error message, or null when the password is fine. */
export function passwordProblem(password, who) {
  const result = evaluatePassword(password, who);
  if (result.ok) return null;
  return `Choose a stronger password: ${result.problems.join("; ")}.`;
}
