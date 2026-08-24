import type { Star } from '../../universe/star/types';
import { fmt, fmtDays, fmtYears } from './format';

const STAGE_LABEL: Record<Star['stage'], string> = {
  'brown-dwarf': 'Brown dwarf',
  'main-sequence': 'Main sequence',
  subgiant: 'Subgiant',
  giant: 'Red giant',
  'horizontal-branch': 'Horizontal branch',
  agb: 'Asymptotic giant',
  supergiant: 'Supergiant',
  'white-dwarf': 'White dwarf',
  'neutron-star': 'Neutron star',
  'black-hole': 'Black hole',
};

export class InfoPanel {
  constructor(private readonly element: HTMLElement) {}

  render(star: Star): void {
    const rows: Array<[string, string]> = [
      ['Type', `${star.spectralType} · ${STAGE_LABEL[star.stage]}`],
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

    const companions = star.companions
      .map(({ star: companion, orbit }) => {
        const period = fmtDays(orbit.periodDays);
        return `<div class="companion">
          <span class="swatch" style="background:${cssColor(companion)}"></span>
          ${companion.spectralType} · ${fmt(companion.mass)} M☉ ·
          a ${fmt(orbit.semiMajorAxisAu)} AU · P ${period} · e ${fmt(orbit.eccentricity, 2)}
        </div>`;
      })
      .join('');

    this.element.innerHTML = `
      <h1><span class="swatch" style="background:${cssColor(star)}"></span>${star.designation}</h1>
      <table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      ${companions ? `<h2>Companions</h2>${companions}` : ''}
    `;
  }
}

function massLossNote(star: Star): string {
  return Math.abs(star.mass - star.massInitial) / star.massInitial > 0.02
    ? ` (initial ${fmt(star.massInitial)})`
    : '';
}

/** Display color: gamma-encoded hue swatch from the star's linear RGB. */
function cssColor(star: Star): string {
  const [r, g, b] = star.linearRgb.map((c) => Math.round(255 * c ** (1 / 2.2)));
  return `rgb(${r},${g},${b})`;
}
