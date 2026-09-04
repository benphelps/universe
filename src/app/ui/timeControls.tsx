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
  clocksFor,
  describeDetent,
  detentsFor,
  formatMultiplier,
  openingIndex,
  OPENING_SECONDS,
  REAL_TIME,
  type FocusClocks,
} from '../clocks';
import { setTimeScale, type AppSnapshot } from '../store';

const PAUSE = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M5.5 3.5v9M10.5 3.5v9" />
  </svg>
);
const PLAY = (
  <svg viewBox="0 0 16 16" width="14" height="14">
    <path d="M5 3.1v9.8L13 8z" fill="currentColor" />
  </svg>
);

const NO_CLOCKS: FocusClocks = { owner: '', clocks: [REAL_TIME] };
/** The axis has this much in from each end for the cursor's own width. */
const AXIS_INSET_PX = 14;
/** Shift with an arrow key steps this many stops. */
const BIG_STEP = 5;
/** The axis stays up this long after a wheel or key step. */
const SHOW_MS = 500;
/** Wheel events closer than this are one step. */
const WHEEL_STEP_MS = 60;

/**
 * The clock: a pause orb and, beside it, the rate as a pill — the
 * multiple of real time and what that means here, "×2.4k · a day
 * every 30 s". The pill is the slider: press and drag sideways and the
 * rate axis unfolds above, and the cursor steps between the focus's
 * detents — real time, then each clock's ladder of paces from a turn
 * an hour to a turn a second, merged in one run and spaced evenly.
 * Only the clocks are ticked and named, each at its half-minute
 * stop; the paces between are felt, not shown. Let go and the axis
 * folds away. A double-click is real time, a scroll steps a stop,
 * arrows step, shift-arrows leap. Each focus opens at its own pace.
 */
export function TimeControls({ snap }: { snap: AppSnapshot | null }): ReactNode {
  const { owner, clocks } = useMemo(() => (snap ? clocksFor(snap) : NO_CLOCKS), [snap]);
  const detents = useMemo(() => detentsFor(clocks), [clocks]);
  const [index, setIndex] = useState(() => openingIndex(detents));
  const [paused, setPaused] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startIndex: number } | null>(null);
  const hide = useRef(0);
  const lastWheel = useRef(0);

  // A new focus opens at its own pace.
  const opening = openingIndex(detents);
  useEffect(() => {
    setIndex(opening);
  }, [owner, opening]);
  useEffect(() => () => window.clearTimeout(hide.current), []);

  const last = detents.length - 1;
  const at = Math.min(index, last);
  const detent = detents[at];
  useEffect(() => {
    setTimeScale(paused ? 0 : detent.rate);
  }, [paused, detent]);

  const step = (to: number): void => setIndex(Math.max(0, Math.min(last, Math.round(to))));
  /** The axis's usable width in pixels: the row's, less the insets. */
  const axisWidth = (): number =>
    Math.max(1, (row.current?.getBoundingClientRect().width ?? 200) - 2 * AXIS_INSET_PX);
  const showBriefly = (): void => {
    setEngaged(true);
    window.clearTimeout(hide.current);
    hide.current = window.setTimeout(() => setEngaged(false), SHOW_MS);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startIndex: at };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Without capture the drag simply ends at the pill's edge.
    }
    window.clearTimeout(hide.current);
    setEngaged(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>): void => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    step(d.startIndex + ((e.clientX - d.startX) / axisWidth()) * last);
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
    showBriefly();
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
    showBriefly();
  };

  const position = (i: number): string =>
    `calc(${AXIS_INSET_PX}px + ${last > 0 ? i / last : 0} * (100% - ${2 * AXIS_INSET_PX}px))`;
  const pauseTip = paused ? 'resume time' : 'pause time';
  const phrase = describeDetent(detent);
  return (
    <div id="time-row" ref={row}>
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
      <div id="time-axis" className={engaged ? 'show' : ''} aria-hidden="true">
        <div className="fill" style={{ width: position(at) }} />
        {detents.map((stop, i) =>
          i === 0 || stop.seconds === OPENING_SECONDS ? (
            <div className="tick" key={i} style={{ left: position(i) }}>
              <label>{stop.clock?.label ?? 'real'}</label>
            </div>
          ) : null,
        )}
        <div className="cursor" style={{ left: position(at) }} />
      </div>
    </div>
  );
}
