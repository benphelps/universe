import type { GalacticAddress } from '../../universe/galaxy/regions';

export type ViewMode = 'star' | 'system' | 'planet' | 'galaxy';

export interface SidebarCallbacks {
  onSeed: (seedHex: string) => void;
  onRandom: () => void;
  onView: (view: ViewMode) => void;
  onTimeScale: (daysPerSecond: number) => void;
  onExposure: (exposure: number) => void;
  onChartToggle: (visible: boolean) => void;
}

const VIEWS: ViewMode[] = ['star', 'system', 'planet', 'galaxy'];

/** The characteristic scale each level frames. */
const VIEW_SCALE: Record<ViewMode, string> = {
  star: 'R☉',
  system: 'AU',
  planet: 'R⊕',
  galaxy: 'kpc',
};

/**
 * The survey console beside the viewport: where you are (the sector
 * eyebrow), what you are looking at (the catalog plate), what the
 * current level holds (the scrolling table), the instrument settings,
 * and the four framing scales along the bottom. Panels render into
 * `focus` and `level`; everything else is owned here.
 */
export class Sidebar {
  readonly focus: HTMLElement;
  readonly level: HTMLElement;
  private readonly addressEl: HTMLElement;
  private readonly seedInput: HTMLInputElement;
  private readonly viewButtons = new Map<ViewMode, HTMLButtonElement>();

  constructor(element: HTMLElement, callbacks: SidebarCallbacks) {
    element.innerHTML = `
      <header id="address"></header>
      <section id="focus"></section>
      <section id="level"></section>
      <section id="settings">
        <label for="seed">seed</label>
        <input id="seed" type="text" spellcheck="false" maxlength="16" />
        <button id="random" title="random seed">⟳</button>
        <label for="timescale">time</label>
        <input id="timescale" type="range" min="-3" max="4" step="0.1" value="-1.3" />
        <button id="chart" class="active" title="sector borders and names">chart</button>
        <label for="exposure">exposure</label>
        <input id="exposure" type="range" min="0.1" max="4" step="0.05" value="1" />
        <span></span>
      </section>
      <nav id="level-nav">
        ${VIEWS.map(
          (v) => `<button id="view-${v}"><span class="name">${v}</span><span class="unit">${VIEW_SCALE[v]}</span></button>`,
        ).join('')}
      </nav>
    `;
    this.addressEl = element.querySelector<HTMLElement>('#address')!;
    this.focus = element.querySelector<HTMLElement>('#focus')!;
    this.level = element.querySelector<HTMLElement>('#level')!;
    this.seedInput = element.querySelector<HTMLInputElement>('#seed')!;

    for (const view of VIEWS) {
      const button = element.querySelector<HTMLButtonElement>(`#view-${view}`)!;
      this.viewButtons.set(view, button);
      button.addEventListener('click', () => callbacks.onView(view));
    }

    this.seedInput.addEventListener('change', () => {
      const hex = this.seedInput.value.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
      if (hex.length > 0) callbacks.onSeed(hex.padStart(16, '0'));
    });
    element.querySelector('#random')!.addEventListener('click', callbacks.onRandom);
    const chartButton = element.querySelector<HTMLButtonElement>('#chart')!;
    chartButton.addEventListener('click', () => {
      const visible = !chartButton.classList.contains('active');
      chartButton.classList.toggle('active', visible);
      callbacks.onChartToggle(visible);
    });
    element.querySelector<HTMLInputElement>('#timescale')!.addEventListener('input', (e) => {
      callbacks.onTimeScale(10 ** Number((e.target as HTMLInputElement).value));
    });
    element.querySelector<HTMLInputElement>('#exposure')!.addEventListener('input', (e) => {
      callbacks.onExposure(Number((e.target as HTMLInputElement).value));
    });
  }

  /** The wayfinding eyebrow: which territory the current system sits in. */
  set address(address: GalacticAddress) {
    this.addressEl.textContent = `${address.sector} Sector · ${address.zone.replace('-', ' ')}`;
  }

  set seed(seedHex: string) {
    this.seedInput.value = seedHex;
  }

  set view(mode: ViewMode) {
    for (const [view, button] of this.viewButtons) {
      button.classList.toggle('active', view === mode);
    }
  }
}
