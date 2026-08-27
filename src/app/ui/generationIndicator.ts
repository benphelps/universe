export interface GenerationStatus {
  surveying: boolean;
  terrain: number;
  worlds: number;
  skies: number;
}

/**
 * The generation lamp above the decal switchboard: a slow-turning arc
 * with a line naming what the background workers are producing.
 * Lingers one poll past idle so single-tile blips don't strobe it.
 */
export class GenerationIndicator {
  private readonly element: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private idlePolls = 99;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.id = 'genstate';
    this.element.innerHTML =
      '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M6 1.2 A4.8 4.8 0 1 1 1.2 6"/></svg>';
    this.label = document.createElement('span');
    this.element.append(this.label);
    parent.append(this.element);
  }

  update(status: GenerationStatus): void {
    const parts: string[] = [];
    if (status.surveying) parts.push('climate survey');
    if (status.terrain > 0) parts.push(`terrain ${status.terrain}`);
    if (status.worlds > 0) parts.push(`worlds ${status.worlds}`);
    if (status.skies > 0) parts.push(`sky ${status.skies}`);
    if (parts.length > 0) {
      this.idlePolls = 0;
      this.label.textContent = parts.join(' · ');
    } else {
      this.idlePolls++;
    }
    this.element.classList.toggle('busy', this.idlePolls < 2);
  }
}
