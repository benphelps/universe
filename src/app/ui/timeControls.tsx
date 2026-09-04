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
  describeRate,
  formatMultiplier,
  LANDMARK_SECONDS,
  openingRate,
  rateAtPosition,
  ratePosition,
  REAL_RATE,
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
/** A landmark this near, in pixels, takes the cursor. */
const SNAP_PX = 6;
/** Arrow keys step this far along the axis; with shift, a decade. */
const KEY_STEP = 0.1 / 8;
/** The axis stays up this long after a wheel nudge. */
const WHEEL_SHOW_MS = 500;

/**
 * The clock: a pause orb and, beside it, the rate as a pill — the
 * multiple of real time and what that means here, "×4.3k · a day
 * every 17 s". The pill is the slider: press and drag sideways and the
 * rate axis unfolds above, real time at the left, a hundred million
 * times it at the right, the focus's own clocks ticked along it where
 * one turn of each takes ten seconds; let go and it folds away. It
 * snaps to those ticks, a double-click is real time, a scroll nudges,
 * and arrows step. Each focus opens at its own pace.
 */
export function TimeControls({ snap }: { snap: AppSnapshot | null }): ReactNode {
  const { owner, clocks } = useMemo(() => (snap ? clocksFor(snap) : NO_CLOCKS), [snap]);
  const [rate, setRate] = useState(() => openingRate(clocks));
  const [paused, setPaused] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startPosition: number } | null>(null);
  const hide = useRef(0);

  // A new focus opens at its own pace.
  const opening = openingRate(clocks);
  useEffect(() => {
    setRate(opening);
  }, [owner, opening]);
  useEffect(() => () => window.clearTimeout(hide.current), []);

  useEffect(() => {
    setTimeScale(paused ? 0 : rate);
  }, [paused, rate]);

  const landmarks = useMemo(
    () => [
      { label: 'real', position: 0 },
      ...clocks
        .filter((clock) => clock.periodDays !== null)
        .map((clock) => ({
          label: clock.label,
          position: ratePosition((clock.periodDays as number) / LANDMARK_SECONDS),
        })),
    ],
    [clocks],
  );

  /** The axis's usable width in pixels: the row's, less the insets. */
  const axisWidth = (): number =>
    Math.max(1, (row.current?.getBoundingClientRect().width ?? 200) - 2 * AXIS_INSET_PX);

  const snapped = (position: number): number => {
    const reach = SNAP_PX / axisWidth();
    let best = position;
    let bestDistance = reach;
    for (const landmark of landmarks) {
      const distance = Math.abs(landmark.position - position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = landmark.position;
      }
    }
    return best;
  };
  const place = (position: number): void => setRate(rateAtPosition(snapped(position)));

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startPosition: ratePosition(rate) };
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
    place(d.startPosition + (e.clientX - d.startX) / axisWidth());
  };
  const onPointerEnd = (e: PointerEvent<HTMLButtonElement>): void => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    setEngaged(false);
  };
  const showBriefly = (): void => {
    setEngaged(true);
    window.clearTimeout(hide.current);
    hide.current = window.setTimeout(() => setEngaged(false), WHEEL_SHOW_MS);
  };
  const onWheel = (e: WheelEvent<HTMLButtonElement>): void => {
    place(ratePosition(rate) - Math.sign(e.deltaY) * KEY_STEP);
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
      setRate(REAL_RATE);
      return;
    }
    if (!direction) return;
    e.preventDefault();
    setRate(rateAtPosition(ratePosition(rate) + direction * (e.shiftKey ? 1 / 8 : KEY_STEP)));
    showBriefly();
  };

  const position = ratePosition(rate);
  const at = (p: number): string => `calc(${AXIS_INSET_PX}px + ${p} * (100% - ${2 * AXIS_INSET_PX}px))`;
  const pauseTip = paused ? 'resume time' : 'pause time';
  const phrase = describeRate(rate, clocks);
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
        aria-valuemax={1}
        aria-valuenow={position}
        aria-valuetext={`${formatMultiplier(rate)}, ${phrase}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={() => setRate(REAL_RATE)}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <span className="mul">{formatMultiplier(rate)}</span>
        <span className="sep">·</span>
        <span className="phrase">{phrase}</span>
      </button>
      <div id="time-axis" className={engaged ? 'show' : ''} aria-hidden="true">
        <div className="fill" style={{ width: at(position) }} />
        {landmarks.map((landmark) => (
          <div className="tick" key={landmark.label} style={{ left: at(landmark.position) }}>
            <label>{landmark.label}</label>
          </div>
        ))}
        <div className="cursor" style={{ left: at(position) }} />
      </div>
    </div>
  );
}
