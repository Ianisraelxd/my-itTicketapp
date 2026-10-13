import { useCallback, useEffect, useState } from "react";

// The sign-in safety steps, remembered for the tab so a refresh cannot skip them:
//   1. five wrong attempts in a row start a short cooldown (the form is locked with a countdown),
//   2. once it ends, another wrong attempt reveals the "Forgot password?" option.
const KEY = "helpdesk-login-guard";
export const ATTEMPTS_BEFORE_COOLDOWN = 5;
export const COOLDOWN_SECONDS = 10;
const EMPTY = { failures: 0, cooldownUntil: 0, showForgot: false };

function read() {
  try {
    return { ...EMPTY, ...JSON.parse(sessionStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...EMPTY };
  }
}

function write(state) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage blocked: the guard still works until the page is refreshed
  }
}

export default function useLoginGuard() {
  const [state, setState] = useState(read);
  const [now, setNow] = useState(() => Date.now());
  const counting = state.cooldownUntil > now;

  // Tick only while a cooldown is running.
  useEffect(() => {
    if (!counting) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [counting]);

  const update = useCallback((change) => {
    setState((current) => {
      const next = change(current);
      write(next);
      return next;
    });
  }, []);

  // A wrong password: count it, start the cooldown on the fifth, reveal "Forgot password?" afterwards.
  const recordFailure = useCallback(
    (seconds) =>
      update((current) => {
        const moment = Date.now();
        const failures = current.failures + 1;
        const cooling = current.cooldownUntil > moment;
        if (!cooling && failures >= ATTEMPTS_BEFORE_COOLDOWN && current.cooldownUntil === 0) {
          setNow(moment);
          return { ...current, failures, cooldownUntil: moment + (seconds || COOLDOWN_SECONDS) * 1000 };
        }
        return { ...current, failures, showForgot: current.showForgot || (!cooling && current.cooldownUntil > 0) };
      }),
    [update],
  );

  // The server asked the browser to wait (for example the account was in its own cooldown).
  const recordWait = useCallback(
    (seconds) =>
      update((current) => {
        const moment = Date.now();
        setNow(moment);
        return { ...current, cooldownUntil: moment + Math.max(1, seconds || COOLDOWN_SECONDS) * 1000 };
      }),
    [update],
  );

  const reset = useCallback(() => update(() => ({ ...EMPTY })), [update]);

  return {
    failures: state.failures,
    showForgot: state.showForgot,
    secondsLeft: counting ? Math.ceil((state.cooldownUntil - now) / 1000) : 0,
    recordFailure,
    recordWait,
    reset,
  };
}
