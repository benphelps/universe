import { useEffect, useRef, useState, type ReactNode } from 'react';
import { generationStatus } from '../store';

export interface GenerationStatus {
  surveying: boolean;
  terrain: number;
  worlds: number;
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

const KEYS = ['survey', 'terrain', 'worlds', 'sky', 'skyStage'] as const;
type Key = (typeof KEYS)[number];

interface RowView {
  hidden: boolean;
  text: string;
  sweep: boolean;
  width: string;
  linger: number;
}

const FOLDED: RowView = { hidden: true, text: '', sweep: false, width: '', linger: 99 };

/** −1 marks an indeterminate task: known to run, unknown how far along. */
function stepRow(prev: RowView, text: string, state: number | null): RowView {
  if (state === null) {
    // Freshly drained: hold the bar at full for a beat, then fold.
    if (!prev.hidden && prev.linger < 2) {
      const linger = prev.linger + 1;
      return { ...prev, linger, sweep: false, width: '100%', hidden: linger >= 2 };
    }
    return prev;
  }
  return {
    hidden: false,
    text,
    linger: 0,
    sweep: state < 0,
    width: state < 0 ? '' : `${Math.round(state * 100)}%`,
  };
}

/**
 * The generation readout under the sidebar's framing scales: one row
 * per background producer — the focused world's climate survey, the
 * terrain tiles the view still wants, distant-world bakes, and sky
 * fields — each with a label and a thin progress bar. Countable queues
 * fill as they drain; one-shot builds sweep. A finished bar holds at
 * full for a beat before the row folds away.
 */
export function GenerationIndicator(): ReactNode {
  const [rows, setRows] = useState<Record<Key, RowView>>({
    survey: FOLDED,
    terrain: FOLDED,
    worlds: FOLDED,
    sky: FOLDED,
    skyStage: FOLDED,
  });
  const tracks = useRef({ terrain: new BurstTrack(), worlds: new BurstTrack() });

  useEffect(() => {
    const id = window.setInterval(() => {
      const status = generationStatus();
      if (!status) return;
      const { terrain, worlds } = tracks.current;
      setRows((prev) => ({
        survey: stepRow(prev.survey, 'climate survey', status.surveying ? -1 : null),
        terrain: stepRow(prev.terrain, `terrain · ${status.terrain}`, terrain.update(status.terrain)),
        worlds: stepRow(prev.worlds, `worlds · ${status.worlds}`, worlds.update(status.worlds)),
        sky: stepRow(prev.sky, 'sky field', status.skies > 0 ? status.skyProgress : null),
        skyStage: stepRow(
          prev.skyStage,
          status.skyStage,
          status.skies > 0 && status.skyStage !== ''
            ? status.skyStageProgress < 0
              ? -1
              : status.skyStageProgress
            : null,
        ),
      }));
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  return (
    <>
      {KEYS.map((key) => {
        const row = rows[key];
        return (
          <div
            key={key}
            className={key === 'skyStage' ? 'gen-row gen-sub' : 'gen-row'}
            hidden={row.hidden}
          >
            <span className="gen-label">{row.text}</span>
            <div className="gen-bar">
              <div
                className={row.sweep ? 'gen-fill sweep' : 'gen-fill'}
                style={{ width: row.width }}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}
