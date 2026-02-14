export function newEventId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // ignore
  }
  return `e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
