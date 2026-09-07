/** Bounded main-thread attribution, enabled only in explicit audit mode. */
const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has('benchmark');
const spans: { name: string; startTime: number; duration: number }[] = [];
export function beginLoadingWork(): number { return enabled ? performance.now() : 0; }
export function endLoadingWork(name: string, startTime: number): void {
  if (!enabled) return;
  spans.push({ name, startTime, duration: performance.now() - startTime });
  if (spans.length > 512) spans.shift();
}
export function loadingWorkSpans(): typeof spans { return spans; }
