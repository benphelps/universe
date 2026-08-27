export interface TimeSeedCallbacks {
  /** Effective rate, days of sim time per real second — 0 while paused. */
  onTimeScale: (daysPerSecond: number) => void;
  onRandom: () => void;
}

/** Slowest slider stop — the default pace until the surveyor speeds up. */
export const SLOWEST_TIME_EXP = -3;

/** Slider bounds, log10 of days-per-second: real time up to ~27 yr/s. */
const MIN_EXP = Math.log10(1 / 86400);
const MAX_EXP = 4;

/** The labeled stops along the slider's log scale. */
const STOPS: Array<{ label: string; daysPerSecond: number }> = [
  { label: 'rt', daysPerSecond: 1 / 86400 },
  { label: '1m', daysPerSecond: 1 / 1440 },
  { label: '1h', daysPerSecond: 1 / 24 },
  { label: '1d', daysPerSecond: 1 },
  { label: '1mo', daysPerSecond: 30.44 },
  { label: '1yr', daysPerSecond: 365.25 },
  { label: '10y', daysPerSecond: 3652.5 },
];

const PAUSE = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5.5 3.5v9M10.5 3.5v9"/></svg>`;
const PLAY = `<svg viewBox="0 0 16 16" width="14" height="14"><path d="M5 3.1v9.8L13 8z" fill="currentColor"/></svg>`;
const COPY = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M10.5 3H4.2A1.2 1.2 0 0 0 3 4.2v6.3"/></svg>`;
const DICE = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4"/><circle cx="5.4" cy="5.4" r="1" fill="currentColor" stroke="none"/><circle cx="10.6" cy="5.4" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="5.4" cy="10.6" r="1" fill="currentColor" stroke="none"/><circle cx="10.6" cy="10.6" r="1" fill="currentColor" stroke="none"/></svg>`;

function formatRate(daysPerSecond: number): string {
  const trim = (v: number): string =>
    v < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v));
  const secondsPerSecond = daysPerSecond * 86400;
  if (secondsPerSecond < 1.6) return 'real time';
  if (secondsPerSecond < 90) return `${trim(secondsPerSecond)} s/s`;
  const minutes = secondsPerSecond / 60;
  if (minutes < 90) return `${trim(minutes)} min/s`;
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
  private rate = 10 ** SLOWEST_TIME_EXP;
  private paused = false;
  private copyTimer = 0;

  constructor(
    element: HTMLElement,
    private readonly callbacks: TimeSeedCallbacks,
  ) {
    const ticks = STOPS.map(({ label, daysPerSecond }) => {
      const at = ((Math.log10(daysPerSecond) - MIN_EXP) / (MAX_EXP - MIN_EXP)) * 100;
      return `<span style="left:${at.toFixed(1)}%">${label}</span>`;
    }).join('');
    element.innerHTML = `
      <button id="time-pause" title="pause time" aria-label="pause time">${PAUSE}</button>
      <div id="time-slider">
        <span id="time-rate"></span>
        <div class="track-wrap">
          <input id="time-range" type="range" min="${MIN_EXP}" max="${MAX_EXP}" step="0.01"
            value="${SLOWEST_TIME_EXP}" aria-label="time scale" />
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
      this.rate = 10 ** Number(this.range.value);
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
