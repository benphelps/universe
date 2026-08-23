export type ViewMode = 'star' | 'system' | 'planet' | 'surface';

export interface ControlsCallbacks {
  onSeed: (seedHex: string) => void;
  onRandom: () => void;
  onView: (view: ViewMode) => void;
  onPlanetStep: (delta: number) => void;
  onTimeScale: (daysPerSecond: number) => void;
  onExposure: (exposure: number) => void;
}

const VIEWS: ViewMode[] = ['star', 'system', 'planet', 'surface'];

/** Bottom control strip: view toggle, seed entry, planet stepper, time scale, exposure. */
export class Controls {
  private readonly seedInput: HTMLInputElement;
  private readonly viewButtons = new Map<ViewMode, HTMLButtonElement>();
  private readonly planetNav: HTMLElement;
  private readonly planetLabelEl: HTMLElement;

  constructor(element: HTMLElement, callbacks: ControlsCallbacks) {
    element.innerHTML = `
      <span class="view-toggle">
        ${VIEWS.map((v) => `<button id="view-${v}">${v}</button>`).join('')}
      </span>
      <span id="planet-nav" hidden>
        <button id="planet-prev">‹</button>
        <span id="planet-label"></span>
        <button id="planet-next">›</button>
      </span>
      <label>seed <input id="seed" type="text" spellcheck="false" maxlength="16" /></label>
      <button id="random">random</button>
      <label>time <input id="timescale" type="range" min="-3" max="4" step="0.1" value="-1.3" /></label>
      <label>exposure <input id="exposure" type="range" min="0.1" max="4" step="0.05" value="1" /></label>
    `;
    this.seedInput = element.querySelector<HTMLInputElement>('#seed')!;
    this.planetNav = element.querySelector<HTMLElement>('#planet-nav')!;
    this.planetLabelEl = element.querySelector<HTMLElement>('#planet-label')!;

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
    element.querySelector('#planet-prev')!.addEventListener('click', () => callbacks.onPlanetStep(-1));
    element.querySelector('#planet-next')!.addEventListener('click', () => callbacks.onPlanetStep(1));
    element.querySelector<HTMLInputElement>('#timescale')!.addEventListener('input', (e) => {
      callbacks.onTimeScale(10 ** Number((e.target as HTMLInputElement).value));
    });
    element.querySelector<HTMLInputElement>('#exposure')!.addEventListener('input', (e) => {
      callbacks.onExposure(Number((e.target as HTMLInputElement).value));
    });
  }

  set seed(seedHex: string) {
    this.seedInput.value = seedHex;
  }

  set view(mode: ViewMode) {
    for (const [view, button] of this.viewButtons) {
      button.classList.toggle('active', view === mode);
    }
    this.planetNav.hidden = mode !== 'planet' && mode !== 'surface';
  }

  set planetLabel(label: string) {
    this.planetLabelEl.textContent = label;
  }
}
