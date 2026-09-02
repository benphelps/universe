import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { clocksFor, DURATIONS, rateFor, REAL_TIME, type FocusClocks } from '../clocks';
import { setTimeScale, type AppSnapshot } from '../store';

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

/**
 * The clock control: pause, then which of the focus's clocks to run
 * and how long one turn of it should take on screen. The rate is
 * whatever those two name, so it follows the body — the same setting
 * is a slow day at a world and a whole year on the system map.
 */
const NO_CLOCKS: FocusClocks = { owner: '', clocks: [REAL_TIME] };

export function TimeControls({ snap }: { snap: AppSnapshot | null }): ReactNode {
  const { owner, clocks } = useMemo(() => (snap ? clocksFor(snap) : NO_CLOCKS), [snap]);
  const [clockIndex, setClockIndex] = useState(1);
  const [durationIndex, setDurationIndex] = useState(1);
  const [paused, setPaused] = useState(false);
  // A focus with fewer clocks keeps the nearest one it has.
  const chosen = Math.min(clockIndex, clocks.length - 1);
  const clock = clocks[chosen];
  const duration = DURATIONS[durationIndex];

  useEffect(() => {
    setTimeScale(paused ? 0 : rateFor(clock, duration.seconds));
  }, [paused, clock, duration]);

  const pauseTip = paused ? 'resume time' : 'pause time';
  const still = clocks.length === 1;
  return (
    <>
      <span className="eyebrow">
        time{owner && <span className="owner"> · {owner}</span>}
      </span>
      <div className="row">
      <button
        id="time-pause"
        className={paused ? 'active' : ''}
        data-tip={pauseTip}
        aria-label={pauseTip}
        onClick={() => setPaused(!paused)}
      >
        {paused ? PLAY : PAUSE}
      </button>
      <div id="time-clocks">
        {still ? (
          <span className="still">real time · nothing here turns</span>
        ) : (
          <>
            <div className="seg" role="radiogroup" aria-label="clock">
              {clocks.map((option, index) => (
                <button
                  key={option.label}
                  className={index === chosen ? 'active' : ''}
                  role="radio"
                  aria-checked={index === chosen}
                  onClick={() => setClockIndex(index)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <span className="tag">every</span>
            <div
              className={`seg${clock.periodDays === null ? ' idle' : ''}`}
              role="radiogroup"
              aria-label="how long one turn takes"
            >
              {DURATIONS.map((option, index) => (
                <button
                  key={option.label}
                  className={index === durationIndex ? 'active' : ''}
                  role="radio"
                  aria-checked={index === durationIndex}
                  disabled={clock.periodDays === null}
                  onClick={() => setDurationIndex(index)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      </div>
    </>
  );
}
