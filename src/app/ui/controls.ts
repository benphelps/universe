export type ViewMode = 'star' | 'system';

export interface ControlsCallbacks {
  onSeed: (seedHex: string) => void;
  onRandom: () => void;
  onView: (view: ViewMode) => void;
  onTimeScale: (daysPerSecond: number) => void;
  onExposure: (exposure: number) => void;
}

/** Bottom control strip: view toggle, seed entry, randomize, time scale, exposure. */
export class Controls {
  private readonly seedInput: HTMLInputElement;
  private readonly viewButtons: Record<ViewMode, HTMLButtonElement>;

  constructor(element: HTMLElement, callbacks: ControlsCallbacks) {
    element.innerHTML = `
      <span class="view-toggle">
        <button id="view-star">star</button><button id="view-system">system</button>
      </span>
      <label>seed <input id="seed" type="text" spellcheck="false" maxlength="16" /></label>
      <button id="random">random</button>
      <label>time <input id="timescale" type="range" min="-3" max="4" step="0.1" value="-1.3" /></label>
      <label>exposure <input id="exposure" type="range" min="0.1" max="4" step="0.05" value="1" /></label>
    `;
    this.seedInput = element.querySelector<HTMLInputElement>('#seed')!;
    this.viewButtons = {
      star: element.querySelector<HTMLButtonElement>('#view-star')!,
      system: element.querySelector<HTMLButtonElement>('#view-system')!,
    };

    this.seedInput.addEventListener('change', () => {
      const hex = this.seedInput.value.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
      if (hex.length > 0) callbacks.onSeed(hex.padStart(16, '0'));
    });
    element.querySelector('#random')!.addEventListener('click', callbacks.onRandom);
    this.viewButtons.star.addEventListener('click', () => callbacks.onView('star'));
    this.viewButtons.system.addEventListener('click', () => callbacks.onView('system'));
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
    this.viewButtons.star.classList.toggle('active', mode === 'star');
    this.viewButtons.system.classList.toggle('active', mode === 'system');
  }
}
