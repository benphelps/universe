import type { Star } from '../../universe/star/types';
import { fmt, fmtDays, fmtYears } from './format';
import { cssColor, renderPlate } from './markup';
import type { Sidebar } from './sidebar';

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

/** Star level: the star's physics up top, its companions listed below. */
export class StarInfoPanel {
  constructor(private readonly sidebar: Sidebar) {}

  render(star: Star): void {
    const rows: Array<[string, string]> = [
      ['Mass', `${fmt(star.mass)} M☉${massLossNote(star)}`],
      ['Radius', `${fmt(star.radius)} R☉`],
      ['Luminosity', `${fmt(star.luminosity)} L☉`],
      ['T_eff', star.tEff > 0 ? `${fmt(star.tEff, 4)} K` : '—'],
      ['Age', fmtYears(star.ageGyr * 1e9)],
      ['[Fe/H]', `${fmt(star.feH, 2)} · ${star.population.replace('-', ' ')}`],
      ['Rotation', fmtDays(star.activity.rotationPeriodDays)],
      ['Spots', `${fmt(star.activity.spotCoverage * 100, 2)}% coverage`],
    ];
    if (star.variability) {
      rows.push([
        'Variable',
        `${star.variability.type} · P ${fmtDays(star.variability.periodDays)}`,
      ]);
    }
    if (star.activity.flareRatePerDay > 0.1) {
      rows.push(['Flares', `~${fmt(star.activity.flareRatePerDay, 2)}/day`]);
    }

    renderPlate(this.sidebar.focus, {
      title: star.designation,
      subtitle: `${star.spectralType} · ${STAGE_LABEL[star.stage]}`,
      color: cssColor(star.linearRgb),
      rows,
    });

    const companionRows = star.companions
      .map(
        ({ star: companion, orbit }) => `<tr>
          <td><span class="swatch" style="background:${cssColor(companion.linearRgb)}"></span> ${companion.spectralType}</td>
          <td class="n">${fmt(companion.mass)}</td>
          <td class="n">${fmt(orbit.semiMajorAxisAu)}</td>
          <td class="n">${fmtDays(orbit.periodDays)}</td>
          <td class="n">${fmt(orbit.eccentricity, 2)}</td>
        </tr>`,
      )
      .join('');

    this.sidebar.level.innerHTML = companionRows
      ? `<h2>Companions · ${star.companions.length}</h2>
         <table class="list">
           <tr><th></th><th class="n">M☉</th><th class="n">AU</th><th class="n">period</th><th class="n">e</th></tr>
           ${companionRows}
         </table>`
      : '<div class="empty">a single star — no companions</div>';
  }
}

function massLossNote(star: Star): string {
  return Math.abs(star.mass - star.massInitial) / star.massInitial > 0.02
    ? ` (initial ${fmt(star.massInitial)})`
    : '';
}
