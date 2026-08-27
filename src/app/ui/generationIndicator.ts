export interface GenerationStatus {
  surveying: boolean;
  terrain: number;
  worlds: number;
  skies: number;
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

/** −1 marks an indeterminate task: known to run, unknown how far along. */
type RowState = number | null;

interface Row {
  element: HTMLElement;
  label: HTMLElement;
  fill: HTMLElement;
  linger: number;
}

/**
 * The generation readout under the sidebar's framing scales: one row
 * per background producer — the focused world's climate survey, the
 * terrain tiles the view still wants, distant-world bakes, and sky
 * fields — each with a label and a thin progress bar. Countable queues
 * fill as they drain; one-shot builds sweep. A finished bar holds at
 * full for a beat before the row folds away.
 */
export class GenerationIndicator {
  private readonly rows = new Map<string, Row>();
  private readonly terrainTrack = new BurstTrack();
  private readonly worldsTrack = new BurstTrack();

  constructor(private readonly panel: HTMLElement) {
    for (const key of ['survey', 'terrain', 'worlds', 'sky']) {
      const element = document.createElement('div');
      element.className = 'gen-row';
      element.hidden = true;
      const label = document.createElement('span');
      label.className = 'gen-label';
      const bar = document.createElement('div');
      bar.className = 'gen-bar';
      const fill = document.createElement('div');
      fill.className = 'gen-fill';
      bar.append(fill);
      element.append(label, bar);
      panel.append(element);
      this.rows.set(key, { element, label, fill, linger: 99 });
    }
  }

  update(status: GenerationStatus): void {
    this.setRow('survey', 'climate survey', status.surveying ? -1 : null);
    this.setRow(
      'terrain',
      `terrain · ${status.terrain}`,
      this.terrainTrack.update(status.terrain),
    );
    this.setRow('worlds', `worlds · ${status.worlds}`, this.worldsTrack.update(status.worlds));
    this.setRow('sky', 'sky field', status.skies > 0 ? -1 : null);
  }

  private setRow(key: string, text: string, state: RowState): void {
    const row = this.rows.get(key)!;
    if (state === null) {
      // Freshly drained: hold the bar at full for a beat, then fold.
      if (!row.element.hidden && row.linger < 2) {
        row.linger++;
        row.fill.classList.remove('sweep');
        row.fill.style.width = '100%';
        if (row.linger >= 2) row.element.hidden = true;
      }
      return;
    }
    row.linger = 0;
    row.element.hidden = false;
    row.label.textContent = text;
    if (state < 0) {
      row.fill.classList.add('sweep');
      row.fill.style.width = '';
    } else {
      row.fill.classList.remove('sweep');
      row.fill.style.width = `${Math.round(state * 100)}%`;
    }
  }
}
