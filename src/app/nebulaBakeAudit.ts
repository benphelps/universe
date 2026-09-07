/** Bounded generation evidence for the explicit performance recorder. */
export const nebulaAuditEnabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has('benchmark');
const events: Array<Record<string, unknown>> = [];
let changed = false, cached = '[]';
export function recordNebulaBake(event: Record<string, unknown>): void {
  if (!nebulaAuditEnabled) return;
  events.push({ atMs: performance.now(), ...event });
  if (events.length > 512) events.shift();
  changed = true;
}
export function nebulaBakeAuditText(): string {
  if (changed) { cached = JSON.stringify(events, null, 2); changed = false; }
  return cached;
}
