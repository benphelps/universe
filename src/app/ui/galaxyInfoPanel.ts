import { seedFromHex } from '../../core/rng/hash';
import type { Neighbor } from '../galaxyViewer';
import { generateStar } from '../../universe/star/generate';
import { fmt } from './format';

/**
 * The stellar neighborhood as a travel list: nearest systems with type
 * and distance; clicking a row makes that system the current one.
 */
export class GalaxyInfoPanel {
  constructor(private readonly element: HTMLElement) {}

  render(seedHex: string, neighbors: Neighbor[], onTravel: (seedHex: string) => void): void {
    const current = generateStar(seedFromHex(seedHex));
    const rows = neighbors.slice(0, 14).map((neighbor) => {
      const star = generateStar(seedFromHex(neighbor.seedHex), { withCompanions: false });
      const [r, g, b] = star.linearRgb.map((c) => Math.round(255 * c ** (1 / 2.2)));
      return `<div class="companion travel" data-seed="${neighbor.seedHex}">
        <span class="swatch" style="background:rgb(${r},${g},${b})"></span>
        ${star.spectralType} · ${star.designation} · ${fmt(neighbor.distancePc, 3)} pc
      </div>`;
    });

    this.element.innerHTML = `
      <h1>${current.designation}</h1>
      <div class="sub">${current.spectralType} · the local neighborhood (${neighbors.length} stars within 20 pc)</div>
      <h2>Travel to</h2>
      ${rows.join('')}
    `;

    for (const row of this.element.querySelectorAll<HTMLElement>('.travel')) {
      row.addEventListener('click', () => onTravel(row.dataset.seed!));
    }
  }
}
