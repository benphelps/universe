import { AU, EARTH_RADIUS } from '../../core/physics/constants';
import type { Moon } from '../../universe/moon/types';
import type { Planet, StarSystem } from '../../universe/system/types';
import { fmt, fmtDays } from './format';

const TIDAL_LABEL: Record<Moon['tidalState'], string> = {
  dead: '',
  'subsurface-ocean': 'subsurface ocean',
  cryovolcanic: 'cryovolcanic',
  volcanic: 'volcanic',
};

const ATMOSPHERE_LABEL: Record<string, string> = {
  none: 'airless',
  'hydrogen-helium': 'H₂/He envelope',
  nitrogen: 'N₂ (CO₂ trace)',
  'nitrogen-oxygen': 'N₂/O₂',
  'co2-hothouse': 'CO₂ hothouse',
  'thin-co2': 'thin CO₂',
  'nitrogen-methane': 'N₂/CH₄ haze',
  'rock-vapor': 'rock vapor',
};

const HYDROSPHERE_LABEL: Record<string, string> = {
  none: 'dry',
  oceans: 'oceans',
  'ice-sheet': 'global ice',
  magma: 'magma seas',
};

const REGIME_LABEL: Record<string, string> = {
  dead: 'geologically dead',
  'stagnant-lid': 'stagnant lid',
  'active-tectonics': 'plate tectonics',
  magma: 'molten surface',
  gas: '—',
};

export class PlanetInfoPanel {
  constructor(private readonly element: HTMLElement) {}

  render(system: StarSystem, planet: Planet, index: number, note?: string): void {
    const { bulk, interior, rotation, atmosphere, climate } = planet.physical;
    const aAu = planet.elements.semiMajorAxis / AU;

    const rows: Array<[string, string]> = [
      ['Class', planet.class + (climate.snowball ? ' (snowball)' : '')],
      ['Mass', `${fmt(bulk.massEarth)} M⊕`],
      ['Radius', `${fmt(bulk.radiusEarth)} R⊕ · ${fmt(bulk.densityGcc)} g/cm³`],
      ['Gravity', `${fmt(bulk.gravityMs2 / 9.81, 2)} g`],
      ['Orbit', `${fmt(aAu)} AU · e ${fmt(planet.elements.eccentricity, 2)}`],
      [
        'Rotation',
        rotation.locked
          ? 'tidally locked'
          : rotation.spinOrbitResonance
            ? `3:2 resonance (${fmtDays(rotation.periodHours / 24)})`
            : `${fmtDays(rotation.periodHours / 24)} · tilt ${fmt((rotation.obliquityRad * 180) / Math.PI, 2)}°`,
      ],
      ['Atmosphere', atmosphereLine(planet)],
      ['T', temperatureLine(planet)],
      ['Albedo', fmt(climate.bondAlbedo, 2)],
    ];
    if (atmosphere.class !== 'hydrogen-helium') {
      rows.push(['Surface', surfaceLine(planet)]);
      rows.push(['Geology', REGIME_LABEL[interior.regime]]);
    }
    rows.push([
      'Magnetic',
      interior.magneticFieldRelEarth > 0.02
        ? `${fmt(interior.magneticFieldRelEarth, 2)}× Earth`
        : 'none',
    ]);

    const badges = [
      planet.inHabitableZone ? '<span class="badge hz">HZ</span>' : '',
      climate.biosphere ? '<span class="badge bio">biosphere</span>' : '',
      planet.resonanceWithInner
        ? `<span class="badge res">${planet.resonanceWithInner}</span>`
        : '',
    ].join('');

    const rings = planet.rings
      ? `<div class="belt-row">${planet.rings.composition} rings ·
         ${fmt(planet.rings.innerPlanetRadii, 2)}–${fmt(planet.rings.outerPlanetRadii, 2)} R_p${
           planet.rings.gaps.length > 0 ? ` · ${planet.rings.gaps.length} gaps` : ''
         }</div>`
      : '';
    const moons = planet.moons.filter((m) => m.semiMajorAxisPlanetRadii < 100);
    const moonRows = moons
      .map((moon) => {
        const radiusKm = moon.physical.bulk.radiusEarth * (EARTH_RADIUS / 1000);
        const notes = [
          TIDAL_LABEL[moon.tidalState],
          moon.physical.atmosphere.class !== 'none' ? 'atmosphere' : '',
          moon.resonanceWithInner ? `${moon.resonanceWithInner} resonance` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return `<div class="companion">
          ${moon.name.split(' ').pop()} · ${fmt(radiusKm, 3)} km ·
          a ${fmt(moon.semiMajorAxisPlanetRadii, 3)} R_p${notes ? ` · ${notes}` : ''}
        </div>`;
      })
      .join('');

    this.element.innerHTML = `
      <h1>${planet.name} ${badges}</h1>
      <div class="sub">planet ${index + 1} of ${system.planets.length} · ${system.star.spectralType}</div>
      ${note ? `<div class="note">${note}</div>` : ''}
      <table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      ${rings}
      ${moonRows ? `<h2>Moons</h2>${moonRows}` : ''}
    `;
  }

  renderEmpty(system: StarSystem): void {
    this.element.innerHTML = `
      <h1>${system.star.designation}</h1>
      <div class="sub">this system has no planets</div>
    `;
  }
}

function atmosphereLine(planet: Planet): string {
  const { atmosphere } = planet.physical;
  if (atmosphere.class === 'none') return 'airless';
  const pressure =
    atmosphere.class === 'hydrogen-helium' ? '' : ` · ${fmt(atmosphere.surfacePressureBar)} bar`;
  return `${ATMOSPHERE_LABEL[atmosphere.class]}${pressure}`;
}

function temperatureLine(planet: Planet): string {
  const { climate, rotation } = planet.physical;
  const base = `${fmt(climate.surfaceMeanK, 3)} K (eq ${fmt(climate.equilibriumK, 3)} K)`;
  return rotation.locked && climate.dayNightDeltaK > 20
    ? `${base} · Δday-night ${fmt(climate.dayNightDeltaK, 3)} K`
    : base;
}

function surfaceLine(planet: Planet): string {
  const { climate } = planet.physical;
  const water = HYDROSPHERE_LABEL[climate.hydrosphere];
  return climate.hydrosphere === 'oceans'
    ? `${water} (${fmt(climate.oceanCoverage * 100, 2)}% cover)`
    : water;
}
