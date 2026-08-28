import type { GalacticAddress } from '../../universe/galaxy/regions';

export type ViewMode = 'star' | 'system' | 'planet' | 'galaxy';

/** The last tab is not a camera level: it lists the marked POIs. */
export type Tab = ViewMode | 'poi';

export interface SidebarCallbacks {
  onView: (tab: Tab) => void;
}

// Descending scale: kpc, AU, R☉, R⊕ — then the address book.
const TABS: Tab[] = ['galaxy', 'system', 'star', 'planet', 'poi'];

/** The characteristic scale each level frames. */
const TAB_UNIT: Record<Tab, string> = {
  star: 'R☉',
  system: 'AU',
  planet: 'R⊕',
  galaxy: 'kpc',
  poi: '★',
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
  /** The generation readout under the framing scales. */
  readonly generation: HTMLElement;
  private readonly addressEl: HTMLElement;
  private readonly viewButtons = new Map<Tab, HTMLButtonElement>();

  constructor(element: HTMLElement, callbacks: SidebarCallbacks) {
    element.innerHTML = `
      <header id="address"></header>
      <section id="focus"></section>
      <section id="level"></section>
      <footer id="gen-panel"></footer>
      <nav id="level-nav">
        ${TABS.map(
          (v) => `<button id="view-${v}"><span class="name">${v}</span><span class="unit">${TAB_UNIT[v]}</span></button>`,
        ).join('')}
      </nav>
    `;
    this.addressEl = element.querySelector<HTMLElement>('#address')!;
    this.focus = element.querySelector<HTMLElement>('#focus')!;
    this.level = element.querySelector<HTMLElement>('#level')!;
    this.generation = element.querySelector<HTMLElement>('#gen-panel')!;

    for (const tab of TABS) {
      const button = element.querySelector<HTMLButtonElement>(`#view-${tab}`)!;
      this.viewButtons.set(tab, button);
      button.addEventListener('click', () => callbacks.onView(tab));
    }
  }

  /** The wayfinding eyebrow: which territory the current system sits in. */
  set address(address: GalacticAddress) {
    this.addressEl.textContent = `${address.sector} Sector · ${address.zone.replace('-', ' ')}`;
  }

  set view(mode: Tab) {
    for (const [tab, button] of this.viewButtons) {
      button.classList.toggle('active', tab === mode);
    }
  }
}
