import { seedFromHex } from '../../core/rng/hash';
import { NEIGHBOR_RADIUS_PC, type Neighbor } from '../../universe/galaxy/neighborhood';
import { generateStar } from '../../universe/star/generate';
import { shortDesignation } from '../../universe/star/naming';
import type { Star } from '../../universe/star/types';
import { fmt, fmtDays, fmtYears } from './format';
import { cssColor, renderPlate } from './markup';
import type { Sidebar } from './sidebar';

/** The travel table stays readable: nearest systems only, of thousands. */
const TRAVEL_ROWS = 80;

const STAGE_LABEL: Record<Star['stage'], string> = {
  'brown-dwarf': 'brown dwarf',
  'main-sequence': 'main sequence',
  subgiant: 'subgiant',
  giant: 'red giant',
  'horizontal-branch': 'horizontal branch',
  agb: 'asymptotic giant',
  supergiant: 'supergiant',
  'white-dwarf': 'white dwarf',
  'neutron-star': 'neutron star',
  'black-hole': 'black hole',
};

/**
 * Star level: the focused star's physics up top; below, the system's
 * own stars pinned first — primary, then companions, each row a click
 * away — and under them the stellar neighborhood as a travel table.
 */
export class StarInfoPanel {
  constructor(private readonly sidebar: Sidebar) {}

  render(
    star: Star,
    primary: Star,
    focusedIndex: number,
    onSelect: (index: number) => void,
    neighbors: Neighbor[] = [],
    onTravel?: (neighbor: Neighbor) => void,
  ): void {
    const rows: Array<[string, string]> = [
      ['Mass', `${fmt(star.mass)} M☉${massLossNote(star)}`],
      ['Radius', `${fmt(star.radius)} R☉`],
      ['Luminosity', `${fmt(star.luminosity)} L☉`],
      ['T_eff', star.tEff > 0 ? `${fmt(star.tEff, 4)} K` : '—'],
      ['Age', fmtYears(star.ageGyr * 1e9)],
      ['[Fe/H]', `${fmt(star.feH, 2)} · ${star.population.replace('-', ' ')}`],
      [
        'Rotation',
        `${fmtDays(star.activity.rotationPeriodDays)} · tilt ${fmt((star.activity.axialTiltRad * 180) / Math.PI, 2)}°${
          star.activity.axialTiltRad > Math.PI / 2 ? ' · retrograde' : ''
        }`,
      ],
    ];
    if (star.activity.spotCoverage >= 0.005) {
      rows.push(['Spots', `${fmt(star.activity.spotCoverage * 100, 2)}% coverage`]);
    }
    if (star.activity.cloudPatchiness >= 0.05) {
      rows.push(['Clouds', `${fmt(star.activity.cloudPatchiness * 100, 2)}% patchy`]);
    }
    if (star.variability) {
      rows.push([
        'Variable',
        `${star.variability.type} · P ${fmtDays(star.variability.periodDays)}`,
      ]);
    }
    if (star.activity.flareRatePerDay > 0.1) {
      rows.push(['Flares', `~${fmt(star.activity.flareRatePerDay, 2)}/day`]);
    }
    // The chart name above is a designation; the seed is the identity.
    rows.push(['Survey id', `SIM-${star.seedHex.slice(-8).toUpperCase()}`]);

    renderPlate(this.sidebar.focus, {
      title: star.designation,
      subtitle: `${star.spectralType} · ${STAGE_LABEL[star.stage]}`,
      color: cssColor(star.linearRgb),
      rows,
    });

    const starRow = (
      rowStar: Star,
      index: number,
      orbit: { semiMajorAxisAu: number; periodDays: number; eccentricity: number } | null,
    ): string => `<tr class="pick${index === focusedIndex ? ' here' : ''}" data-index="${index}">
      <td><span class="swatch" style="background:${cssColor(rowStar.linearRgb)}"></span> ${rowStar.spectralType}</td>
      <td class="n">${fmt(rowStar.mass)}</td>
      <td class="n">${orbit ? fmt(orbit.semiMajorAxisAu) : '—'}</td>
      <td class="n">${orbit ? fmtDays(orbit.periodDays) : '—'}</td>
      <td class="n">${orbit ? fmt(orbit.eccentricity, 2) : '—'}</td>
    </tr>`;

    const starRows = [
      starRow(primary, 0, null),
      ...primary.companions.map(({ star: companion, orbit }, i) => starRow(companion, i + 1, orbit)),
    ].join('');

    const shown = neighbors.slice(0, TRAVEL_ROWS);
    const travelRows = shown.map((neighbor, i) => {
      // Each neighbor's star at its true position — the same locale the
      // sky point used and travel will carry.
      const neighborStar = generateStar(seedFromHex(neighbor.seedHex), {
        withCompanions: false,
        localePc: neighbor.positionPc,
      });
      return `<tr class="pick travel" data-travel="${i}">
        <td><span class="swatch" style="background:${cssColor(neighborStar.linearRgb)}"></span> ${neighborStar.spectralType}</td>
        <td>${shortDesignation(neighborStar.designation)}</td>
        <td class="n">${fmt(neighbor.distancePc, 3)}</td>
      </tr>`;
    });

    this.sidebar.level.innerHTML = `
      ${
        primary.companions.length > 0
          ? `<h2>System stars · ${primary.companions.length + 1}</h2>
             <table class="list">
               <tr><th></th><th class="n">M☉</th><th class="n">AU</th><th class="n">period</th><th class="n">e</th></tr>
               ${starRows}
             </table>`
          : '<h2>System stars · 1</h2><div class="empty">a single star — no companions</div>'
      }
      ${
        neighbors.length > 0
          ? `<h2>Travel to · within ${NEIGHBOR_RADIUS_PC} pc</h2>
             <table class="list">
               <tr><th>type</th><th>system</th><th class="n">pc</th></tr>
               ${travelRows.join('')}
             </table>
             ${
               neighbors.length > shown.length
                 ? `<div class="empty">nearest ${shown.length} of ${neighbors.length} — glints in the sky travel too</div>`
                 : ''
             }`
          : ''
      }
    `;

    for (const row of this.sidebar.level.querySelectorAll<HTMLElement>('tr.pick')) {
      row.addEventListener('click', () => {
        const travel = row.dataset.travel;
        if (travel !== undefined) onTravel?.(neighbors[Number(travel)]);
        else onSelect(Number(row.dataset.index));
      });
    }
  }
}

function massLossNote(star: Star): string {
  return Math.abs(star.mass - star.massInitial) / star.massInitial > 0.02
    ? ` (initial ${fmt(star.massInitial)})`
    : '';
}
