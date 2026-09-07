/** Audit-only milestones in visible DOM, measured from the sky request.
 * A bounded history also records cancelled journeys for travel checks. */
import type { NebulaPatch } from '../universe/galaxy/skyfield';

interface LoadingAudit {
  seed: string; started: number; firstStarsMs?: number; baseMs?: number;
  atlasSha256?: string; metadataSha256?: string;
  portraits: { tile: number; elapsedMs: number }[]; completeMs?: number; cancelledMs?: number;
}
const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has('benchmark');
const history: LoadingAudit[] = [];
let text = '';
export function recordSkyLoading(seed: string, event: 'start' | 'stars' | 'base' | 'portrait' | 'complete' | 'cancel', tile?: number): void {
  if (!enabled) return;
  const now = performance.now();
  if (event === 'start') {
    history.push({ seed, started: now, portraits: [] });
    if (history.length > 8) history.shift();
  } else {
    const item = [...history].reverse().find(item => item.seed === seed && item.completeMs === undefined && item.cancelledMs === undefined);
    if (!item) return;
    const elapsed = now - item.started;
    if (event === 'stars') item.firstStarsMs ??= elapsed;
    if (event === 'base') item.baseMs ??= elapsed;
    if (event === 'portrait') item.portraits.push({ tile: tile!, elapsedMs: elapsed });
    if (event === 'complete') item.completeMs = elapsed;
    if (event === 'cancel') item.cancelledMs = elapsed;
  }
  text = JSON.stringify(history, null, 2);
}
export function skyLoadingAuditText(): string { return text; }

/** Hash only audit payloads, asynchronously after the completion milestone. */
export async function recordSkyPortraitOutput(seed: string, atlas: Float32Array, patches: NebulaPatch[]): Promise<void> {
  if (!enabled) return;
  const item = [...history].reverse().find(item => item.seed === seed);
  if (!item) return;
  const metadata = new TextEncoder().encode(JSON.stringify(patches, (_, value) => typeof value === 'bigint' ? value.toString() : value));
  const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
  const [pixels, properties] = await Promise.all([crypto.subtle.digest('SHA-256', new Uint8Array(atlas.buffer as ArrayBuffer, atlas.byteOffset, atlas.byteLength)), crypto.subtle.digest('SHA-256', metadata)]);
  item.atlasSha256 = hex(pixels); item.metadataSha256 = hex(properties);
  text = JSON.stringify(history, null, 2);
}
