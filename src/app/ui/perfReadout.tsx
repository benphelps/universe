import { useEffect, useState, type ReactNode } from 'react';
import { perfStats } from '../store';

export interface PerfStats {
  fps: number;
  /** Smoothed interval between frames, ms. */
  frameMs: number;
  /** The smoothed cost the residency controller answers to, ms. */
  costMs: number;
  /** The pipeline's GPU time for a frame, ms; null without the timer
   *  extension. */
  gpuMs: number | null;
  /** The frame's script time, ms. */
  scriptMs: number;
  drawCalls: number;
  triangles: number;
  /** Star points standing in the scene as glints. */
  glints: number;
  /** Nebula volumes standing, and the cap the controller allows. */
  volumes: number;
  volumeCap: number;
  /** Nebula sprites the sky carries. */
  sprites: number;
  /** Volume bakes still queued. */
  bakes: number;
  /** Terrain tiles still in flight. */
  terrain: number;
}

const fixed = (value: number, digits = 1): string => value.toFixed(digits);
const thousands = (value: number): string =>
  value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e4 ? `${(value / 1e3).toFixed(0)}k` : `${value}`;

/**
 * The frame's instruments, in the viewport's top-left: rate and the
 * timings behind it, what the renderer drew, and what the sky tiers
 * are carrying. Polled a few times a second rather than every frame —
 * a readout that redraws at frame rate would be part of the cost it
 * reports.
 */
export function PerfReadout(): ReactNode {
  const [stats, setStats] = useState<PerfStats | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setStats(perfStats()), 250);
    return () => window.clearInterval(id);
  }, []);
  if (!stats) return null;
  // Nothing measured yet, or the document is hidden and no frame
  // counts: a dash, not a zero that reads as a stalled frame.
  const live = stats.frameMs > 0;
  const rows: Array<[string, string]> = [
    ['fps', live ? fixed(stats.fps, 0) : '—'],
    ['frame', live ? `${fixed(stats.frameMs)} ms` : '—'],
    ['gpu', stats.gpuMs === null ? '—' : `${fixed(stats.gpuMs)} ms`],
    ['script', `${fixed(stats.scriptMs)} ms`],
    ['draws', `${stats.drawCalls} · ${thousands(stats.triangles)} tri`],
    ['glints', thousands(stats.glints)],
    ['nebulae', `${stats.volumes} / ${stats.volumeCap} vol · ${stats.sprites} spr`],
  ];
  if (stats.bakes > 0) rows.push(['bakes', `${stats.bakes}`]);
  if (stats.terrain > 0) rows.push(['terrain', `${stats.terrain}`]);
  return (
    <div id="perf" aria-label="performance readout">
      {rows.map(([label, value]) => (
        <div className="perf-row" key={label}>
          <span className="perf-label">{label}</span>
          <span className="perf-value">{value}</span>
        </div>
      ))}
    </div>
  );
}
