import { orbitalPeriod } from '../../core/math/orbit';
import { AU } from '../../core/physics/constants';
import { planetMu } from '../../universe/system/generate';
import type { Planet, StarSystem } from '../../universe/system/types';
import { fmt, fmtDays } from './format';
import { cssColor, renderPlate } from './markup';
import type { Sidebar } from './sidebar';

const CLASS_LABEL: Record<Planet['class'], string> = {
  rocky: 'rocky',
  'super-earth': 'super-Earth',
  'mini-neptune': 'mini-Neptune',
  'ice-giant': 'ice giant',
  'gas-giant': 'gas giant',
};

export const CLASS_COLOR: Record<Planet['class'], string> = {
  rocky: '#b98a63',
  'super-earth': '#d4a373',
  'mini-neptune': '#86b6d6',
  'ice-giant': '#5fb0c9',
  'gas-giant': '#d9b380',
};

/**
 * System level: the host star up top, the planet inventory below.
 * Clicking a planet row focuses that planet.
 */
export class SystemInfoPanel {
  constructor(private readonly sidebar: Sidebar) {}

  render(system: StarSystem, onSelectPlanet: (index: number) => void): void {
    const { star, zones } = system;
    const configuration =
      system.configuration === 'p-type'
        ? ' · circumbinary'
        : system.configuration === 's-type'
          ? ' · binary'
          : '';

    renderPlate(this.sidebar.focus, {
      title: star.designation,
      subtitle: `${star.spectralType}${configuration} · ${system.planets.length} planets`,
      color: cssColor(star.linearRgb),
      rows: [
        ['Star', `${fmt(star.mass)} M☉ · ${fmt(star.luminosity)} L☉`],
        ['Habitable zone', `${fmt(zones.habitableInnerAu)}–${fmt(zones.habitableOuterAu)} AU`],
        ['Frost line', `${fmt(zones.frostLineAu)} AU`],
      ],
    });

    const planetRows = system.planets
      .map((planet, index) => {
        const aAu = planet.elements.semiMajorAxis / AU;
        const periodDays =
          orbitalPeriod(planetMu(system, planet), planet.elements.semiMajorAxis) / 86400;
        const badges = [
          planet.inHabitableZone ? '<span class="badge hz">HZ</span>' : '',
          planet.tidallyLocked ? '<span class="badge lock">lock</span>' : '',
          planet.resonanceWithInner
            ? `<span class="badge res">${planet.resonanceWithInner}</span>`
            : '',
        ].join('');
        const letter = planet.name.split(' ').pop();
        return `<tr class="pick" data-index="${index}">
          <td><span class="swatch" style="background:${CLASS_COLOR[planet.class]}"></span> ${letter}</td>
          <td>${CLASS_LABEL[planet.class]}</td>
          <td class="n">${fmt(planet.physical.bulk.massEarth)}</td>
          <td class="n">${fmt(aAu)}</td>
          <td class="n">${fmtDays(periodDays)}</td>
          <td class="n">${fmt(planet.elements.eccentricity, 2)}</td>
          <td>${badges}</td>
        </tr>`;
      })
      .join('');

    const beltRows = system.belts
      .map(
        (belt) =>
          `<div class="belt-row">${belt.kind === 'main' ? 'asteroid belt' : 'debris belt'}
           ${fmt(belt.innerAu)}–${fmt(belt.outerAu)} AU${
             belt.gaps.length > 0 ? ` · ${belt.gaps.length} resonance gaps` : ''
           }</div>`,
      )
      .join('');

    this.sidebar.level.innerHTML = `
      ${
        system.planets.length > 0
          ? `<h2>Planets · ${system.planets.length}</h2>
             <table class="list">
               <tr><th></th><th>class</th><th class="n">M⊕</th><th class="n">AU</th><th class="n">period</th><th class="n">e</th><th></th></tr>
               ${planetRows}
             </table>`
          : '<div class="empty">no planets formed here</div>'
      }
      ${beltRows}
    `;

    for (const row of this.sidebar.level.querySelectorAll<HTMLElement>('tr.pick')) {
      row.addEventListener('click', () => onSelectPlanet(Number(row.dataset.index)));
    }
  }
}
