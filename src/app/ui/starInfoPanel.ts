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

/**
 * Star level: the focused star's physics up top; below, the system's
 * stars — primary first, then companions — each row a click away.
 */
export class StarInfoPanel {
  constructor(private readonly sidebar: Sidebar) {}

  render(
    star: Star,
    primary: Star,
    focusedIndex: number,
    onSelect: (index: number) => void,
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

    this.sidebar.level.innerHTML =
      primary.companions.length > 0
        ? `<h2>System stars · ${primary.companions.length + 1}</h2>
           <table class="list">
             <tr><th></th><th class="n">M☉</th><th class="n">AU</th><th class="n">period</th><th class="n">e</th></tr>
             ${starRows}
           </table>`
        : '<h2>System stars · 1</h2><div class="empty">a single star — no companions</div>';

    for (const row of this.sidebar.level.querySelectorAll<HTMLElement>('tr.pick')) {
      row.addEventListener('click', () => onSelect(Number(row.dataset.index)));
    }
  }
}

function massLossNote(star: Star): string {
  return Math.abs(star.mass - star.massInitial) / star.massInitial > 0.02
    ? ` (initial ${fmt(star.massInitial)})`
    : '';
}
