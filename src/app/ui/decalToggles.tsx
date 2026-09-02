import { useState, type ReactNode } from 'react';
import { setDecal } from '../store';

/** The diagrammatic decal families a viewer can switch off. */
export interface DecalState {
  orbits: boolean;
  zones: boolean;
  markers: boolean;
  chart: boolean;
}

// 16×16 stroke icons, drawn from what each toggle governs: an orbit
// trace with its body, a zone annulus, a marker reticle, and the
// chart's province borders with named stars inside them.
const DECALS: Array<{ key: keyof DecalState; title: string; icon: ReactNode }> = [
  {
    key: 'orbits',
    title: 'orbit lines',
    icon: (
      <>
        <ellipse cx="8" cy="8" rx="6.2" ry="2.7" transform="rotate(-25 8 8)" />
        <circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="11.6" cy="4.4" r="1.1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    key: 'zones',
    title: 'habitable zone and belts',
    icon: (
      <>
        <circle cx="8" cy="8" r="6.2" strokeDasharray="2.6 2.1" />
        <circle cx="8" cy="8" r="3.1" />
      </>
    ),
  },
  {
    key: 'markers',
    title: 'body markers',
    icon: (
      <>
        <circle cx="8" cy="8" r="2.3" />
        <path d="M8 1.4v2.8M8 11.8v2.8M1.4 8h2.8M11.8 8h2.8" />
      </>
    ),
  },
  {
    key: 'chart',
    title: 'sector borders and names',
    icon: (
      <>
        <path d="M8 1.4v5.4l5.7 4.3M8 6.8l-6.4 3.6" />
        <circle cx="4.6" cy="4.4" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="12" cy="5" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="8" cy="12.6" r="0.9" fill="currentColor" stroke="none" />
      </>
    ),
  },
];

/** The decal switchboard in the viewport's corner: one icon per decal
 *  family, lit while its layer shows. */
export function DecalToggles(): ReactNode {
  const [visible, setVisible] = useState<DecalState>({
    orbits: true,
    zones: true,
    markers: true,
    chart: false,
  });

  return (
    <div id="decals">
      {DECALS.map(({ key, title, icon }) => (
        <button
          key={key}
          className={visible[key] ? 'active' : ''}
          data-tip={title}
          aria-label={title}
          aria-pressed={visible[key]}
          onClick={() => {
            const next = !visible[key];
            setVisible({ ...visible, [key]: next });
            setDecal(key, next);
          }}
        >
          <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            {icon}
          </svg>
        </button>
      ))}
    </div>
  );
}
