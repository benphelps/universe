export interface TimeSeedCallbacks {
  /** Effective rate, days of sim time per real second — 0 while paused. */
  onTimeScale: (daysPerSecond: number) => void;
  onRandom: () => void;
}

/** The default pace until the surveyor speeds up: one minute a second. */
export const DEFAULT_TIME_SCALE = 1 / 1440;

/** The slider's detents, log-spaced from real time to a decade a
 *  second; the labeled ones carry the scale. */
const DETENTS: Array<{ daysPerSecond: number; label?: string }> = [
  { daysPerSecond: 1 / 86400, label: 'rt' },
  { daysPerSecond: 10 / 86400 },
  { daysPerSecond: 30 / 86400 },
  { daysPerSecond: 1 / 1440, label: '1m' },
  { daysPerSecond: 5 / 1440 },
  { daysPerSecond: 15 / 1440 },
  { daysPerSecond: 1 / 24, label: '1h' },
  { daysPerSecond: 3 / 24 },
  { daysPerSecond: 6 / 24 },
  { daysPerSecond: 0.5 },
  { daysPerSecond: 1, label: '1d' },
  { daysPerSecond: 3 },
  { daysPerSecond: 7 },
  { daysPerSecond: 30.44, label: '1mo' },
  { daysPerSecond: 91.3 },
  { daysPerSecond: 365.25, label: '1yr' },
  { daysPerSecond: 1095.75 },
  { daysPerSecond: 3652.5, label: '10y' },
];

const DETENT_EXPS = DETENTS.map(({ daysPerSecond }) => Math.log10(daysPerSecond));
const MIN_EXP = DETENT_EXPS[0];
const MAX_EXP = DETENT_EXPS[DETENT_EXPS.length - 1];

const PAUSE = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5.5 3.5v9M10.5 3.5v9"/></svg>`;
const PLAY = `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M5 3.1v9.8L13 8z" fill="currentColor"/></svg>`;
const COPY = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M10.5 3H4.2A1.2 1.2 0 0 0 3 4.2v6.3"/></svg>`;
const DICE = `<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4"/><circle cx="5.4" cy="5.4" r="1" fill="currentColor" stroke="none"/><circle cx="10.6" cy="5.4" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="5.4" cy="10.6" r="1" fill="currentColor" stroke="none"/><circle cx="10.6" cy="10.6" r="1" fill="currentColor" stroke="none"/></svg>`;

function formatRate(daysPerSecond: number): string {
  const trim = (v: number): string =>
    v < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v));
  const secondsPerSecond = daysPerSecond * 86400;
  if (secondsPerSecond < 1.6) return 'real time';
  if (secondsPerSecond < 55) return `${trim(secondsPerSecond)} s/s`;
  const minutes = secondsPerSecond / 60;
  if (minutes < 55) return `${trim(minutes)} min/s`;
  const hours = minutes / 60;
  if (hours < 23) return `${trim(hours)} hr/s`;
  if (daysPerSecond < 26) return `${trim(daysPerSecond)} d/s`;
  const months = daysPerSecond / 30.44;
  if (months < 11.5) return `${trim(months)} mo/s`;
  return `${trim(daysPerSecond / 365.25)} yr/s`;
}

/**
 * The clock-and-seed strip in the viewport's lower-left: pause, the
 * time throttle on a labeled log scale with a live rate readout, the
 * universe seed as a click-to-copy chip, and the dice for a fresh one.
 */
export class TimeSeedControls {
  private readonly pauseButton: HTMLButtonElement;
  private readonly rateEl: HTMLElement;
  private readonly range: HTMLInputElement;
  private readonly seedText: HTMLElement;
  private seedHex = '';
  private rate = DEFAULT_TIME_SCALE;
  private paused = false;
  private copyTimer = 0;

  constructor(
    element: HTMLElement,
    private readonly callbacks: TimeSeedCallbacks,
  ) {
    const ticks = DETENTS.map(({ label, daysPerSecond }) => {
      const at = ((Math.log10(daysPerSecond) - MIN_EXP) / (MAX_EXP - MIN_EXP)) * 100;
      const mark = `<i style="left:${at.toFixed(1)}%"></i>`;
      return label ? `${mark}<span style="left:${at.toFixed(1)}%">${label}</span>` : mark;
    }).join('');
    element.innerHTML = `
      <button id="time-pause" title="pause time" aria-label="pause time">${PAUSE}</button>
      <div id="time-slider">
        <span id="time-rate"></span>
        <div class="track-wrap">
          <input id="time-range" type="range" min="${MIN_EXP}" max="${MAX_EXP}" step="0.001"
            value="${Math.log10(DEFAULT_TIME_SCALE)}" aria-label="time scale" />
          <div class="ticks">${ticks}</div>
        </div>
      </div>
      <button id="seed-chip" title="copy seed"><span id="seed-text"></span>${COPY}</button>
      <button id="seed-dice" title="new universe" aria-label="new universe">${DICE}</button>
    `;
    this.pauseButton = element.querySelector<HTMLButtonElement>('#time-pause')!;
    this.rateEl = element.querySelector<HTMLElement>('#time-rate')!;
    this.range = element.querySelector<HTMLInputElement>('#time-range')!;
    this.seedText = element.querySelector<HTMLElement>('#seed-text')!;
    this.rateEl.textContent = formatRate(this.rate);

    this.pauseButton.addEventListener('click', () => this.setPaused(!this.paused));
    this.range.addEventListener('input', () => {
      // Snap the drag to the nearest detent: the useful rates are a
      // ladder, not a continuum.
      const raw = Number(this.range.value);
      let nearest = DETENT_EXPS[0];
      for (const exp of DETENT_EXPS) {
        if (Math.abs(exp - raw) < Math.abs(nearest - raw)) nearest = exp;
      }
      this.range.value = String(nearest);
      this.rate = 10 ** nearest;
      if (this.paused) this.setPaused(false);
      else this.apply();
    });

    element.querySelector('#seed-chip')!.addEventListener('click', () => {
      void navigator.clipboard.writeText(this.seedHex);
      this.seedText.textContent = 'copied';
      this.seedText.classList.add('copied');
      window.clearTimeout(this.copyTimer);
      this.copyTimer = window.setTimeout(() => {
        this.seedText.textContent = this.seedHex;
        this.seedText.classList.remove('copied');
      }, 900);
    });
    element.querySelector('#seed-dice')!.addEventListener('click', callbacks.onRandom);
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.pauseButton.innerHTML = paused ? PLAY : PAUSE;
    const title = paused ? 'resume time' : 'pause time';
    this.pauseButton.title = title;
    this.pauseButton.setAttribute('aria-label', title);
    this.pauseButton.classList.toggle('active', paused);
    this.apply();
  }

  private apply(): void {
    this.rateEl.textContent = this.paused ? 'paused' : formatRate(this.rate);
    this.rateEl.classList.toggle('paused', this.paused);
    this.callbacks.onTimeScale(this.paused ? 0 : this.rate);
  }

  set seed(seedHex: string) {
    this.seedHex = seedHex;
    if (!this.seedText.classList.contains('copied')) {
      this.seedText.textContent = seedHex;
    }
  }
}
