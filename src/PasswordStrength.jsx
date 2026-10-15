// Live checklist and strength meter for the password rules (the server enforces the same file).
import { evaluatePassword } from "../shared/passwordPolicy.js";
import Icon from "./icons";

const COLORS = ["var(--bad-fg, #b42318)", "var(--bad-fg, #b42318)", "var(--warn-fg, #b54708)", "var(--good-fg, #067647)", "var(--good-fg, #067647)"];

export function PasswordStrength({ password, context }) {
  if (!password) return null;
  const result = evaluatePassword(password, context);
  return (
    <div className="pw-strength" aria-live="polite">
      <div className="pw-meter" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} style={{ background: i < result.score ? COLORS[result.score] : "var(--line)" }} />
        ))}
      </div>
      <strong style={{ color: COLORS[result.score] }}>{result.label}</strong>
      <ul className="pw-checks">
        {result.checks.map((check) => (
          <li key={check.key} className={check.ok ? "pw-ok" : "pw-todo"}>
            <Icon name={check.ok ? "check" : "info"} size={14} /> {check.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
