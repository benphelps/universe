import { useEffect, useRef, useState, type ReactNode } from 'react';
import { generationStatus } from '../store';

export interface GenerationStatus {
  surveying: boolean;
  terrain: number;
  worlds: number;
  /** Nebula volume bakes still queued at their worker. */
  nebulae: number;
  skies: number;
  /** Rough progress of the running sky build, 0..1. */
  skyProgress: number;
  /** The build step the sky worker is on, with its own progress. */
  skyStage: string;
  skyStageProgress: number;
}

/**
 * Streaming-burst progress: outstanding work shrinks toward zero while
 * new demand can still extend the total, so the fill is done-over-peak
 * — the honest shape of a queue that discovers work as it drains.
 */
class BurstTrack {
  private total = 0;

  /** Fill fraction 0..1 while a burst runs; null once it drains. */
  update(outstanding: number): number | null {
    if (outstanding <= 0) {
      this.total = 0;
      return null;
    }
    this.total = Math.max(this.total, outstanding);
    return 1 - outstanding / this.total;
  }
}

interface StatusLine {
  text: string;
  /** How far the busiest producer has come, 0..1; null when idle. */
  fill: number | null;
}

const IDLE: StatusLine = { text: 'idle', fill: null };

/**
 * The status line along the foot of the console: one row, always
 * there, naming whatever is being built — the focused world's climate
 * survey, terrain tiles, distant-world bakes, nebula volumes, the sky
 * field — with a hairline fill under it for the busiest of them, and
 * the word idle when nothing is.
 */
export function GenerationIndicator(): ReactNode {
  const [line, setLine] = useState<StatusLine>(IDLE);
  const tracks = useRef({
    terrain: new BurstTrack(),
    worlds: new BurstTrack(),
    nebulae: new BurstTrack(),
  });

  useEffect(() => {
    const id = window.setInterval(() => {
      const status = generationStatus();
      if (!status) return;
      const { terrain, worlds, nebulae } = tracks.current;
      const parts: string[] = [];
      const fills: number[] = [];
      const note = (label: string, count: number, fill: number | null): void => {
        if (count <= 0) return;
        parts.push(`${label} ${count}`);
        if (fill !== null) fills.push(fill);
      };
      if (status.surveying) parts.push('climate survey');
      if (status.skies > 0) {
        const stage = status.skyStage ? ` · ${status.skyStage}` : '';
        parts.push(`sky ${Math.round(status.skyProgress * 100)}%${stage}`);
        fills.push(status.skyProgress);
      }
      note('nebulae', status.nebulae, nebulae.update(status.nebulae));
      note('terrain', status.terrain, terrain.update(status.terrain));
      note('worlds', status.worlds, worlds.update(status.worlds));
      setLine(
        parts.length
          ? { text: parts.join(' · '), fill: fills.length ? Math.min(...fills) : null }
          : IDLE,
      );
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  return (
    <>
      <span className="gen-label">status</span>
      <span className={`gen-text${line.text === 'idle' ? ' idle' : ''}`}>{line.text}</span>
      <span className="gen-fill" style={{ width: line.fill === null ? 0 : `${line.fill * 100}%` }} />
    </>
  );
}
