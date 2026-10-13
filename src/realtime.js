import { api } from "./api";

// Live updates from the server (Server-Sent Events). While the connection is up the pages refresh the
// moment something happens; if it drops, the slower regular checks in each page keep everything current.
let source = null;
let connected = false;
let wanted = false;
let attempts = 0;
let timer = null;
const listeners = new Set();

export const subscribeRealtime = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const realtimeConnected = () => connected;

async function open() {
  if (!wanted || source) return;
  try {
    const { ticket } = await api.eventTicket(); // single-use, so the session token never goes in the address
    if (!wanted) return;
    source = new EventSource(`/api/events?ticket=${ticket}`);
    source.onopen = () => {
      connected = true;
      attempts = 0;
    };
    source.onmessage = (event) => {
      let data = null;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      listeners.forEach((listener) => listener(data));
    };
    source.onerror = () => {
      connected = false;
      source?.close();
      source = null;
      retry();
    };
  } catch {
    retry();
  }
}

function retry() {
  if (!wanted) return;
  clearTimeout(timer);
  attempts += 1;
  timer = setTimeout(open, Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)));
}

export function startRealtime() {
  wanted = true;
  open();
}

export function stopRealtime() {
  wanted = false;
  connected = false;
  clearTimeout(timer);
  source?.close();
  source = null;
}
