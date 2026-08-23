export interface ControlsCallbacks {
  onSeed: (seedHex: string) => void;
  onRandom: () => void;
  onTimeScale: (daysPerSecond: number) => void;
  onExposure: (exposure: number) => void;
}

/** Bottom control strip: seed entry, randomize, time scale, exposure. */
export class Controls {
  private readonly seedInput: HTMLInputElement;

  constructor(element: HTMLElement, callbacks: ControlsCallbacks) {
    element.innerHTML = `
      <label>seed <input id="seed" type="text" spellcheck="false" maxlength="16" /></label>
      <button id="random">random star</button>
      <label>time <input id="timescale" type="range" min="-3" max="2" step="0.1" value="-1.3" /></label>
      <label>exposure <input id="exposure" type="range" min="0.1" max="4" step="0.05" value="1" /></label>
    `;
    this.seedInput = element.querySelector<HTMLInputElement>('#seed')!;

    this.seedInput.addEventListener('change', () => {
      const hex = this.seedInput.value.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
      if (hex.length > 0) callbacks.onSeed(hex.padStart(16, '0'));
    });
    element.querySelector('#random')!.addEventListener('click', callbacks.onRandom);
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
}
