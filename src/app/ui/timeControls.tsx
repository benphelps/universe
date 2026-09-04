import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from 'react';
import {
  clockFor,
  describeDetent,
  detentsFor,
  formatMultiplier,
  openingIndex,
  type FocusClock,
} from '../clocks';
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

const NO_CLOCK: FocusClock = { owner: '', clock: null };
/** Shift with an arrow key steps this many stops. */
const BIG_STEP = 5;
/** Wheel events closer than this are one step. */
const WHEEL_STEP_MS = 60;

/**
 * The clock: a pause orb and, beside it, the rate as a pill — the
 * multiple of real time and what that means here, "×1.2k · a day
 * every minute". The pill is the slider: press and drag sideways and
 * the rate steps between the stops — real time, then the focus's one
 * clock at every pace from a turn an hour to a turn a second, a drag
 * across the pill's width running the whole range. The pill's own
 * words are the readout; there is no scale to show. A double-click is
 * real time, a scroll steps a stop, arrows step, shift-arrows leap.
 * Each focus opens at its own pace.
 */
export function TimeControls({ snap }: { snap: AppSnapshot | null }): ReactNode {
  const { owner, clock } = snap ? clockFor(snap) : NO_CLOCK;
  const label = clock?.label;
  const periodDays = clock?.periodDays;
  const detents = useMemo(
    () => detentsFor(label !== undefined && periodDays !== undefined ? { label, periodDays } : null),
    [label, periodDays],
  );
  const [index, setIndex] = useState(() => openingIndex(detents));
  const [paused, setPaused] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const drag = useRef<{ pointerId: number; startX: number; startIndex: number; width: number } | null>(
    null,
  );
  const lastWheel = useRef(0);

  // A new focus opens at its own pace.
  const opening = openingIndex(detents);
  useEffect(() => {
    setIndex(opening);
  }, [owner, opening]);

  const last = detents.length - 1;
  const at = Math.min(index, last);
  const detent = detents[at];
  useEffect(() => {
    setTimeScale(paused ? 0 : detent.rate);
  }, [paused, detent]);

  const step = (to: number): void => setIndex(Math.max(0, Math.min(last, Math.round(to))));

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startIndex: at,
      width: Math.max(1, e.currentTarget.getBoundingClientRect().width),
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Without capture the drag simply ends at the pill's edge.
    }
    setEngaged(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>): void => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    step(d.startIndex + ((e.clientX - d.startX) / d.width) * last);
  };
  const onPointerEnd = (e: PointerEvent<HTMLButtonElement>): void => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    setEngaged(false);
  };
  const onWheel = (e: WheelEvent<HTMLButtonElement>): void => {
    const now = performance.now();
    if (now - lastWheel.current < WHEEL_STEP_MS || e.deltaY === 0) return;
    lastWheel.current = now;
    step(at - Math.sign(e.deltaY));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const direction =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? -1
          : 0;
    if (e.key === 'Home') {
      e.preventDefault();
      setIndex(0);
      return;
    }
    if (!direction) return;
    e.preventDefault();
    step(at + direction * (e.shiftKey ? BIG_STEP : 1));
  };

  const pauseTip = paused ? 'resume time' : 'pause time';
  const phrase = describeDetent(detent);
  return (
    <div id="time-row">
      <button
        id="time-pause"
        className={paused ? 'orb active' : 'orb'}
        data-tip={pauseTip}
        aria-label={pauseTip}
        onClick={() => setPaused(!paused)}
      >
        {paused ? PLAY : PAUSE}
      </button>
      <button
        id="time-lens"
        className={engaged ? 'orb pill engaged' : 'orb pill'}
        role="slider"
        aria-label={`rate of time${owner ? `, ${owner}` : ''}`}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={at}
        aria-valuetext={`${formatMultiplier(detent.rate)}, ${phrase}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={() => setIndex(0)}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <span className="mul">{formatMultiplier(detent.rate)}</span>
        <span className="sep">·</span>
        <span className="phrase">{phrase}</span>
      </button>
    </div>
  );
}
