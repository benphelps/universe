import type { GalacticAddress } from '../../universe/galaxy/regions';

export type ViewMode = 'star' | 'system' | 'planet' | 'galaxy';

export interface SidebarCallbacks {
  onView: (view: ViewMode) => void;
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
 * current level holds (the scrolling table), and the four framing
 * scales along the bottom. Panels render into `focus` and `level`.
 */
export class Sidebar {
  readonly focus: HTMLElement;
  readonly level: HTMLElement;
  private readonly addressEl: HTMLElement;
  private readonly viewButtons = new Map<ViewMode, HTMLButtonElement>();

  constructor(element: HTMLElement, callbacks: SidebarCallbacks) {
    element.innerHTML = `
      <header id="address"></header>
      <section id="focus"></section>
      <section id="level"></section>
      <nav id="level-nav">
        ${VIEWS.map(
          (v) => `<button id="view-${v}"><span class="name">${v}</span><span class="unit">${VIEW_SCALE[v]}</span></button>`,
        ).join('')}
      </nav>
    `;
    this.addressEl = element.querySelector<HTMLElement>('#address')!;
    this.focus = element.querySelector<HTMLElement>('#focus')!;
    this.level = element.querySelector<HTMLElement>('#level')!;

    for (const view of VIEWS) {
      const button = element.querySelector<HTMLButtonElement>(`#view-${view}`)!;
      this.viewButtons.set(view, button);
      button.addEventListener('click', () => callbacks.onView(view));
    }
  }

  /** The wayfinding eyebrow: which territory the current system sits in. */
  set address(address: GalacticAddress) {
    this.addressEl.textContent = `${address.sector} Sector · ${address.zone.replace('-', ' ')}`;
  }

  set view(mode: ViewMode) {
    for (const [view, button] of this.viewButtons) {
      button.classList.toggle('active', view === mode);
    }
  }
}
