import { Fragment, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_TIME_SCALE, randomSeed, setTimeScale } from '../store';

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

const PAUSE = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M5.5 3.5v9M10.5 3.5v9" />
  </svg>
);
const PLAY = (
  <svg viewBox="0 0 16 16" width="16" height="16">
    <path d="M5 3.1v9.8L13 8z" fill="currentColor" />
  </svg>
);
const COPY = (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
    <path d="M10.5 3H4.2A1.2 1.2 0 0 0 3 4.2v6.3" />
  </svg>
);
const DICE = (
  <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
    <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" />
    <circle cx="5.4" cy="5.4" r="1" fill="currentColor" stroke="none" />
    <circle cx="10.6" cy="5.4" r="1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="5.4" cy="10.6" r="1" fill="currentColor" stroke="none" />
    <circle cx="10.6" cy="10.6" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const TICKS = DETENTS.map(({ label, daysPerSecond }) => {
  const at = `${(((Math.log10(daysPerSecond) - MIN_EXP) / (MAX_EXP - MIN_EXP)) * 100).toFixed(1)}%`;
  return (
    <Fragment key={daysPerSecond}>
      <i style={{ left: at }} />
      {label && <span style={{ left: at }}>{label}</span>}
    </Fragment>
  );
});

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
export function TimeSeedControls({ seedHex }: { seedHex: string }): ReactNode {
  const [exp, setExp] = useState(Math.log10(DEFAULT_TIME_SCALE));
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(0);

  const setRunning = (nextExp: number, nextPaused: boolean): void => {
    setExp(nextExp);
    setPaused(nextPaused);
    setTimeScale(nextPaused ? 0 : 10 ** nextExp);
  };

  const onRange = (raw: number): void => {
    // Snap the drag to the nearest detent: the useful rates are a
    // ladder, not a continuum.
    let nearest = DETENT_EXPS[0];
    for (const detent of DETENT_EXPS) {
      if (Math.abs(detent - raw) < Math.abs(nearest - raw)) nearest = detent;
    }
    setRunning(nearest, false);
  };

  const onCopy = (): void => {
    void navigator.clipboard.writeText(seedHex);
    setCopied(true);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 900);
  };

  const pauseTitle = paused ? 'resume time' : 'pause time';
  return (
    <div id="timeseed">
      <button
        id="time-pause"
        className={paused ? 'active' : ''}
        title={pauseTitle}
        aria-label={pauseTitle}
        onClick={() => setRunning(exp, !paused)}
      >
        {paused ? PLAY : PAUSE}
      </button>
      <div id="time-slider">
        <span id="time-rate" className={paused ? 'paused' : ''}>
          {paused ? 'paused' : formatRate(10 ** exp)}
        </span>
        <div className="track-wrap">
          <input
            id="time-range"
            type="range"
            min={MIN_EXP}
            max={MAX_EXP}
            step={0.001}
            value={exp}
            aria-label="time scale"
            onChange={(event) => onRange(Number(event.currentTarget.value))}
          />
          <div className="ticks">{TICKS}</div>
        </div>
      </div>
      <button id="seed-chip" title="copy seed" onClick={onCopy}>
        <span id="seed-text" className={copied ? 'copied' : ''}>
          {copied ? 'copied' : seedHex}
        </span>
        {COPY}
      </button>
      <button id="seed-dice" title="new universe" aria-label="new universe" onClick={randomSeed}>
        {DICE}
      </button>
    </div>
  );
}
