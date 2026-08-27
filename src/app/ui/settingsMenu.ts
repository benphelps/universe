export interface SettingsMenuCallbacks {
  onExposure: (exposure: number) => void;
}

const COG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
</svg>`;

/**
 * The cog in the viewport's corner: instrument dials, folded away
 * until asked for. Time and seed live on the clock strip below.
 */
export class SettingsMenu {
  constructor(element: HTMLElement, callbacks: SettingsMenuCallbacks) {
    element.innerHTML = `
      <button id="settings-toggle" title="settings" aria-expanded="false">${COG}</button>
      <div id="settings-menu" hidden>
        <div class="row">
          <label for="exposure">exposure</label>
          <input id="exposure" type="range" min="0.1" max="4" step="0.05" value="1" />
        </div>
      </div>
    `;
    const toggle = element.querySelector<HTMLButtonElement>('#settings-toggle')!;
    const menu = element.querySelector<HTMLElement>('#settings-menu')!;

    const setOpen = (open: boolean): void => {
      menu.hidden = !open;
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => setOpen(Boolean(menu.hidden)));
    document.addEventListener('pointerdown', (e) => {
      if (!menu.hidden && !element.contains(e.target as Node)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });

    element.querySelector<HTMLInputElement>('#exposure')!.addEventListener('input', (e) => {
      callbacks.onExposure(Number((e.target as HTMLInputElement).value));
    });
  }
}
