import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  setExposure,
  setSkyExposure,
  setSkyInstrument,
  type SkyInstrumentName,
} from '../store';

const SKY_MODES: Array<{ name: SkyInstrumentName; label: string; sees: string }> = [
  { name: 'camera', label: 'Camera', sees: 'a sky-subtracted deep exposure in true colour' },
  { name: 'eye', label: 'Eye', sees: 'the dark-adapted naked eye: what you would really see' },
  {
    name: 'narrowband',
    label: 'SHO',
    sees: 'mapped narrowband, [S II], Hα and [O III] on red, green and blue',
  },
];

/** A slider's fill, as the share of its range it stands at. */
const fillOf = (value: number, min: number, max: number): string =>
  `${((value - min) / (max - min)) * 100}%`;

/** A multiplier, short: ×0.10, ×1.00, ×4.00. */
const times = (value: number, digits: number): string => `×${value.toFixed(digits)}`;

const COG = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

/**
 * The cog at the top-right of the view: the picture's instruments,
 * folded away until asked for. A press unfolds the panel from the cog
 * itself — its top-right corner is the cog's, and the cog stays there
 * as the fold. Inside, each instrument has its name and its reading
 * on one line and its control beneath: the exposure, the sky's
 * instrument as one pill of three with a line saying what the chosen
 * one sees, and how deep that instrument integrates. Time lives on
 * the clock strip along the foot.
 */
export function SettingsMenu(): ReactNode {
  const [open, setOpen] = useState(false);
  const [skyMode, setSkyMode] = useState<SkyInstrumentName>('camera');
  const [exposure, setExposureValue] = useState(1);
  const [skyDepth, setSkyDepth] = useState(0);
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

  const sky = SKY_MODES.find((mode) => mode.name === skyMode) ?? SKY_MODES[0];
  return (
    <div id="settings-corner" ref={root}>
      <button
        id="settings-toggle"
        className={open ? 'orb open' : 'orb'}
        data-tip={open ? 'fold the settings' : 'instrument settings'}
        aria-label={open ? 'fold the instrument settings' : 'instrument settings'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {COG}
      </button>
      <div id="settings-menu" hidden={!open} role="dialog" aria-label="instrument settings">
        <h3 className="settings-title">Instruments</h3>
        <section className="setting">
          <div className="setting-head">
            <label htmlFor="exposure">Exposure</label>
            <output htmlFor="exposure">{times(exposure, 2)}</output>
          </div>
          <input
            id="exposure"
            type="range"
            min={0.1}
            max={4}
            step={0.05}
            value={exposure}
            style={{ '--fill': fillOf(exposure, 0.1, 4) } as CSSProperties}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              setExposureValue(value);
              setExposure(value);
            }}
          />
        </section>
        <section className="setting">
          <div className="setting-head">
            <span className="setting-label" id="sky-label">
              Sky instrument
            </span>
          </div>
          <div className="segmented" role="radiogroup" aria-labelledby="sky-label">
            {SKY_MODES.map(({ name, label }) => (
              <button
                key={name}
                className={skyMode === name ? 'on' : ''}
                role="radio"
                aria-checked={skyMode === name}
                onClick={() => {
                  setSkyMode(name);
                  setSkyInstrument(name);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="setting-hint">{sky.sees}</p>
        </section>
        <section className="setting">
          <div className="setting-head">
            <label htmlFor="sky-exposure">Sky depth</label>
            <output htmlFor="sky-exposure">{times(10 ** skyDepth, skyDepth < 0 ? 2 : 1)}</output>
          </div>
          <input
            id="sky-exposure"
            type="range"
            min={-2}
            max={2}
            step={0.05}
            value={skyDepth}
            style={{ '--fill': fillOf(skyDepth, -2, 2) } as CSSProperties}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              setSkyDepth(value);
              setSkyExposure(10 ** value);
            }}
          />
        </section>
      </div>
    </div>
  );
}
