import { useEffect, useRef, useState, type ReactNode } from 'react';
import { setExposure, setStarBudget, starBudget, useApp } from '../store';

const COG = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

/**
 * The cog in the viewport's corner: instrument dials, folded away
 * until asked for. Time and seed live on the clock strip below.
 */
export function SettingsMenu(): ReactNode {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div id="settings-corner" ref={root}>
      <button
        id="settings-toggle"
        className={open ? 'open' : ''}
        title="settings"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {COG}
      </button>
      <div id="settings-menu" hidden={!open}>
        <div className="row">
          <label htmlFor="exposure">exposure</label>
          <input
            id="exposure"
            type="range"
            min={0.1}
            max={4}
            step={0.05}
            defaultValue={1}
            onChange={(event) => setExposure(Number(event.currentTarget.value))}
          />
        </div>
        <StarBudget />
      </div>
    </div>
  );
}

/**
 * How many neighboring stars to resolve as real points.
 *
 * Toward the galactic centre there are a hundred and fifty times the
 * stars per cubic parsec that there are around us, so the same reach
 * costs a hundred and fifty times as much — seconds of it, on the
 * thread that draws. The default holds the count instead of the reach,
 * which is what makes a crowded place enterable at all; this spends
 * more of it on a machine that has it to spend.
 *
 * The readout is the count itself rather than the setting, because out
 * in the disk the setting does nothing: the reach there is already the
 * whole thirty parsecs at which these points hand off to the
 * background, and no budget buys past it. A dial that silently does
 * nothing looks broken; one that shows the number it is not changing
 * explains itself.
 */
function StarBudget(): ReactNode {
  const app = useApp();
  const [shown, setShown] = useState(starBudget);
  const resolved = app?.neighbors.length ?? 0;
  return (
    <div className="row">
      <label htmlFor="star-budget">near stars</label>
      <input
        id="star-budget"
        type="range"
        min={0.5}
        max={16}
        step={0.5}
        defaultValue={starBudget()}
        title="how many neighboring stars to resolve where the sky is crowded"
        onChange={(event) => setShown(Number(event.currentTarget.value))}
        onPointerUp={(event) => setStarBudget(Number(event.currentTarget.value))}
        onKeyUp={(event) => setStarBudget(Number(event.currentTarget.value))}
      />
      <span title={`×${shown}`}>{compact(resolved)}</span>
    </div>
  );
}

/** Counts as an eye reads them. */
function compact(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e4) return `${Math.round(value / 1e3)}k`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(value);
}
