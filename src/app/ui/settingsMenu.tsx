import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  setExposure,
  setSkyExposure,
  setSkyInstrument,
  type SkyInstrumentName,
} from '../store';

const SKY_MODES: Array<{ name: SkyInstrumentName; label: string; title: string }> = [
  { name: 'camera', label: 'camera', title: 'sky-subtracted deep exposure, true colour' },
  { name: 'eye', label: 'eye', title: 'the dark-adapted naked eye — what you would really see' },
  {
    name: 'narrowband',
    label: 'SHO',
    title: 'mapped narrowband: [S II]/Hα/[O III] on RGB, false colour',
  },
];

const COG = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

/**
 * The cog at the top-right of the view: instrument dials, folded away
 * until asked for. Time lives on the clock strip along the foot.
 */
export function SettingsMenu(): ReactNode {
  const [open, setOpen] = useState(false);
  const [skyMode, setSkyMode] = useState<SkyInstrumentName>('camera');
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
        className={open ? 'orb open' : 'orb'}
        data-tip="instrument settings"
        aria-label="instrument settings"
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
        <div className="row" id="sky-modes" role="radiogroup" aria-label="sky instrument">
          <label>sky</label>
          <div>
            {SKY_MODES.map(({ name, label, title }) => (
              <button
                key={name}
                className={skyMode === name ? 'active' : ''}
                data-tip={title}
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
        </div>
        <div className="row">
          <label htmlFor="sky-exposure" title="how deep the sky's instrument integrates">
            sky depth
          </label>
          <input
            id="sky-exposure"
            type="range"
            min={-2}
            max={2}
            step={0.05}
            defaultValue={0}
            onChange={(event) => setSkyExposure(10 ** Number(event.currentTarget.value))}
          />
        </div>
      </div>
    </div>
  );
}

