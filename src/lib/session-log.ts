// A lightweight per-session activity log: what changed, who did it, when.
// Kept in sessionStorage so it clears when the browser tab session ends.

export type SessionChange = {
  id: string;
  actor: string;
  text: string;
  at: string; // ISO timestamp
};

const ENTRIES_KEY = "mh-session-log";
const ACTOR_KEY = "mh-session-actor";
const listeners = new Set<() => void>();

function read(): SessionChange[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(ENTRIES_KEY);
    return raw ? (JSON.parse(raw) as SessionChange[]) : [];
  } catch {
    return [];
  }
}

function write(entries: SessionChange[]) {
  try {
    window.sessionStorage.setItem(ENTRIES_KEY, JSON.stringify(entries.slice(0, 50)));
  } catch {
    /* storage unavailable — the log is a convenience, never critical */
  }
  listeners.forEach((fn) => fn());
}

export function setSessionActor(name: string) {
  if (typeof window === "undefined" || !name) return;
  try {
    window.sessionStorage.setItem(ACTOR_KEY, name);
  } catch {
    /* ignore */
  }
}

export function getSessionActor(): string {
  if (typeof window === "undefined") return "Someone";
  try {
    return window.sessionStorage.getItem(ACTOR_KEY) || "Someone";
  } catch {
    return "Someone";
  }
}

export function logChange(text: string) {
  if (typeof window === "undefined") return;
  write([
    { id: crypto.randomUUID(), actor: getSessionActor(), text, at: new Date().toISOString() },
    ...read(),
  ]);
}

export function clearSessionLog() {
  write([]);
}

export function getSessionLog() {
  return read();
}

export function subscribeSessionLog(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
