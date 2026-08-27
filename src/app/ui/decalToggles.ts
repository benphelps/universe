/** The diagrammatic decal families a viewer can switch off. */
export interface DecalState {
  orbits: boolean;
  zones: boolean;
  markers: boolean;
  chart: boolean;
}

interface DecalSpec {
  key: keyof DecalState;
  title: string;
  icon: string;
}

// 16×16 stroke icons, drawn from what each toggle governs: an orbit
// trace with its body, a zone annulus, a marker reticle, and the
// chart's province borders with named stars inside them.
const DECALS: DecalSpec[] = [
  {
    key: 'orbits',
    title: 'orbit lines',
    icon: `<ellipse cx="8" cy="8" rx="6.2" ry="2.7" transform="rotate(-25 8 8)"/>
      <circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none"/>
      <circle cx="11.6" cy="4.4" r="1.1" fill="currentColor" stroke="none"/>`,
  },
  {
    key: 'zones',
    title: 'habitable zone and belts',
    icon: `<circle cx="8" cy="8" r="6.2" stroke-dasharray="2.6 2.1"/>
      <circle cx="8" cy="8" r="3.1"/>`,
  },
  {
    key: 'markers',
    title: 'body markers',
    icon: `<circle cx="8" cy="8" r="2.3"/>
      <path d="M8 1.4v2.8M8 11.8v2.8M1.4 8h2.8M11.8 8h2.8"/>`,
  },
  {
    key: 'chart',
    title: 'sector borders and names',
    icon: `<path d="M8 1.4v5.4l5.7 4.3M8 6.8l-6.4 3.6"/>
      <circle cx="4.6" cy="4.4" r="0.9" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="5" r="0.9" fill="currentColor" stroke="none"/>
      <circle cx="8" cy="12.6" r="0.9" fill="currentColor" stroke="none"/>`,
  },
];

/** The decal switchboard in the viewport's corner: one icon per decal
 *  family, lit while its layer shows. */
export class DecalToggles {
  constructor(
    container: HTMLElement,
    onToggle: (key: keyof DecalState, visible: boolean) => void,
  ) {
    for (const { key, title, icon } of DECALS) {
      const button = document.createElement('button');
      button.className = 'active';
      button.title = title;
      button.setAttribute('aria-label', title);
      button.setAttribute('aria-pressed', 'true');
      button.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">${icon}</svg>`;
      button.addEventListener('click', () => {
        const visible = !button.classList.contains('active');
        button.classList.toggle('active', visible);
        button.setAttribute('aria-pressed', String(visible));
        onToggle(key, visible);
      });
      container.append(button);
    }
  }
}
