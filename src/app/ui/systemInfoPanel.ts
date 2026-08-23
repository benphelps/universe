import { orbitalPeriod } from '../../core/math/orbit';
import { AU } from '../../core/physics/constants';
import { planetMu } from '../../universe/system/generate';
import type { Planet, StarSystem } from '../../universe/system/types';
import { fmt, fmtDays } from './format';

const CLASS_LABEL: Record<Planet['class'], string> = {
  rocky: 'rocky',
  'super-earth': 'super-Earth',
  'mini-neptune': 'mini-Neptune',
  'ice-giant': 'ice giant',
  'gas-giant': 'gas giant',
};

const CLASS_COLOR: Record<Planet['class'], string> = {
  rocky: '#b98a63',
  'super-earth': '#d4a373',
  'mini-neptune': '#86b6d6',
  'ice-giant': '#5fb0c9',
  'gas-giant': '#d9b380',
};

export class SystemInfoPanel {
  constructor(private readonly element: HTMLElement) {}

  render(system: StarSystem): void {
    const { star, zones } = system;
    const configBadge =
      system.configuration === 'p-type'
        ? ' · circumbinary'
        : system.configuration === 's-type'
          ? ' · binary'
          : '';

    const planetRows = system.planets
      .map((planet) => {
        const aAu = planet.elements.semiMajorAxis / AU;
        const periodDays = orbitalPeriod(planetMu(system, planet), planet.elements.semiMajorAxis) / 86400;
        const badges = [
          planet.inHabitableZone ? '<span class="badge hz">HZ</span>' : '',
          planet.tidallyLocked ? '<span class="badge lock">locked</span>' : '',
          planet.resonanceWithInner
            ? `<span class="badge res">${planet.resonanceWithInner}</span>`
            : '',
        ].join('');
        const letter = planet.name.split(' ').pop();
        return `<tr>
          <td><span class="swatch" style="background:${CLASS_COLOR[planet.class]}"></span> ${letter}</td>
          <td>${CLASS_LABEL[planet.class]}</td>
          <td>${fmt(planet.massEarth)} M⊕</td>
          <td>${fmt(aAu)} AU</td>
          <td>${fmtDays(periodDays)}</td>
          <td>${fmt(planet.elements.eccentricity, 2)}</td>
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

    this.element.innerHTML = `
      <h1>${star.designation}${configBadge}</h1>
      <div class="sub">${star.spectralType} · ${fmt(star.mass)} M☉ · ${
        system.planets.length
      } planets</div>
      <div class="sub">HZ ${fmt(zones.habitableInnerAu)}–${fmt(zones.habitableOuterAu)} AU ·
        frost ${fmt(zones.frostLineAu)} AU</div>
      ${
        system.planets.length > 0
          ? `<table class="planets">
              <tr><th></th><th>class</th><th>mass</th><th>a</th><th>period</th><th>e</th><th></th></tr>
              ${planetRows}
            </table>`
          : '<div class="sub">no planets</div>'
      }
      ${beltRows}
    `;
  }
}
