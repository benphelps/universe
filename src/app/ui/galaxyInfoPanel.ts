import { seedFromHex } from '../../core/rng/hash';
import type { GalacticPosition } from '../../universe/galaxy/density';
import { NEIGHBOR_RADIUS_PC, type Neighbor } from '../../universe/galaxy/neighborhood';
import type { GalacticAddress, GalacticLandmark } from '../../universe/galaxy/regions';
import { generateStar } from '../../universe/star/generate';
import { shortDesignation } from '../../universe/star/naming';
import type { Star } from '../../universe/star/types';
import { fmt } from './format';
import { cssColor, renderPlate } from './markup';
import type { Sidebar } from './sidebar';

/** The travel table stays readable: nearest systems only, of thousands. */
const TRAVEL_ROWS = 80;

/**
 * Galaxy level: the current star's full galactic address up top, the
 * stellar neighborhood as a travel table below — clicking a row makes
 * that system the current one.
 */
export class GalaxyInfoPanel {
  constructor(private readonly sidebar: Sidebar) {}

  render(
    current: Star,
    address: GalacticAddress,
    neighbors: Neighbor[],
    localePc: GalacticPosition,
    landmarks: GalacticLandmark[] | null,
    onTravel: (destination: { seedHex: string; positionPc: GalacticPosition }) => void,
  ): void {
    renderPlate(this.sidebar.focus, {
      title: current.designation,
      subtitle: `${current.spectralType} · ${address.sector} Sector`,
      color: cssColor(current.linearRgb),
      rows: [
        ['Region', address.label.split(' · ')[1]],
        ['Nearest arm', `the ${address.arm} Arm`],
        ['R_galactic', `${(address.radiusPc / 1000).toFixed(2)} kpc`],
        ['Height', `${address.heightPc >= 0 ? '+' : '−'}${fmt(Math.abs(address.heightPc), 3)} pc`],
        ['Neighborhood', `${neighbors.length} stars within ${NEIGHBOR_RADIUS_PC} pc`],
      ],
    });

    const shown = neighbors.slice(0, TRAVEL_ROWS);
    const rows = shown.map((neighbor, i) => {
      // Each neighbor's star at its true position — the same locale the
      // sky point used and travel will carry.
      const star = generateStar(seedFromHex(neighbor.seedHex), {
        withCompanions: false,
        localePc: neighbor.positionPc,
      });
      return `<tr class="pick" data-index="${i}">
        <td><span class="swatch" style="background:${cssColor(star.linearRgb)}"></span> ${star.spectralType}</td>
        <td>${shortDesignation(star.designation)}</td>
        <td class="n">${fmt(neighbor.distancePc, 3)}</td>
      </tr>`;
    });

    // The galaxy's named complexes, nearest first: destinations far
    // beyond the neighborhood — travel arrives inside the landmark.
    const sortedLandmarks = (landmarks ?? [])
      .map((landmark) => ({
        landmark,
        kpc:
          Math.hypot(
            landmark.positionPc.xPc - localePc.xPc,
            landmark.positionPc.yPc - localePc.yPc,
            landmark.positionPc.zPc - localePc.zPc,
          ) / 1000,
      }))
      .sort((a, b) => a.kpc - b.kpc);
    const landmarkRows = sortedLandmarks.map(
      ({ landmark, kpc }, i) => `<tr class="pick poi" data-poi="${i}">
        <td>${landmark.name} Complex</td>
        <td>${fmt(landmark.radiusPc)} pc</td>
        <td class="n">${fmt(kpc)}</td>
      </tr>`,
    );

    this.sidebar.level.innerHTML = `
      <h2>Travel to</h2>
      <table class="list">
        <tr><th>type</th><th>system</th><th class="n">pc</th></tr>
        ${rows.join('')}
      </table>
      ${
        neighbors.length > shown.length
          ? `<div class="empty">nearest ${shown.length} of ${neighbors.length} — glints in the sky travel too</div>`
          : ''
      }
      <h2>Landmarks</h2>
      ${
        landmarks
          ? `<table class="list">
              <tr><th>complex</th><th>core</th><th class="n">kpc</th></tr>
              ${landmarkRows.join('')}
            </table>`
          : '<div class="empty">charting the landmark complexes…</div>'
      }
    `;

    for (const row of this.sidebar.level.querySelectorAll<HTMLElement>('tr.pick')) {
      row.addEventListener('click', () => {
        const poi = row.dataset.poi;
        if (poi !== undefined) {
          const { landmark } = sortedLandmarks[Number(poi)];
          onTravel({ seedHex: landmark.seedHex, positionPc: landmark.positionPc });
        } else {
          onTravel(neighbors[Number(row.dataset.index)]);
        }
      });
    }
  }
}
