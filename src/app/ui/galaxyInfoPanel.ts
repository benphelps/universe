import { seedFromHex } from '../../core/rng/hash';
import { NEIGHBOR_RADIUS_PC, type Neighbor } from '../../universe/galaxy/neighborhood';
import { generateStar } from '../../universe/star/generate';
import type { Star } from '../../universe/star/types';
import { fmt } from './format';

/**
 * The stellar neighborhood as a travel list: nearest systems with type
 * and distance; clicking a row makes that system the current one.
 */
export class GalaxyInfoPanel {
  constructor(private readonly element: HTMLElement) {}

  render(current: Star, neighbors: Neighbor[], onTravel: (neighbor: Neighbor) => void): void {
    const rows = neighbors.slice(0, 14).map((neighbor, i) => {
      // Each neighbor's star at its true position — the same locale the
      // sky point used and travel will carry.
      const star = generateStar(seedFromHex(neighbor.seedHex), {
        withCompanions: false,
        localePc: neighbor.positionPc,
      });
      const [r, g, b] = star.linearRgb.map((c) => Math.round(255 * c ** (1 / 2.2)));
      return `<div class="companion travel" data-index="${i}">
        <span class="swatch" style="background:rgb(${r},${g},${b})"></span>
        ${star.spectralType} · ${star.designation} · ${fmt(neighbor.distancePc, 3)} pc
      </div>`;
    });

    this.element.innerHTML = `
      <h1>${current.designation}</h1>
      <div class="sub">${current.spectralType} · the local neighborhood (${neighbors.length} stars within ${NEIGHBOR_RADIUS_PC} pc)</div>
      <h2>Travel to</h2>
      ${rows.join('')}
    `;

    for (const row of this.element.querySelectorAll<HTMLElement>('.travel')) {
      row.addEventListener('click', () => onTravel(neighbors[Number(row.dataset.index)]));
    }
  }
}
