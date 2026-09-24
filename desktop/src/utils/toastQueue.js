// Spec I §5.2 Punkt 4 -- Zeitgeber-Logik der Hinweisleiste, ohne React: immer nur EINE Leiste (eine
// neue ersetzt die alte), sie laeuft nach `ms` ab und pausiert, solange Maus oder Fokus auf ihr liegen.

export const TOAST_MS = 6000;

export function showToast(prev, { text, action = null, ms = TOAST_MS }, now) {
  return { id: (prev?.id || 0) + 1, text, action, ms, deadline: now + ms, paused: false, remaining: ms };
}

export function pauseToast(t, now) {
  if (!t || t.paused) return t;
  return { ...t, paused: true, remaining: Math.max(0, t.deadline - now) };
}

export function resumeToast(t, now) {
  if (!t || !t.paused) return t;
  return { ...t, paused: false, deadline: now + t.remaining };
}

export function isExpired(t, now) {
  return !!t && !t.paused && now >= t.deadline;
}
