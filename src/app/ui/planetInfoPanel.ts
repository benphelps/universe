import { AU, EARTH_RADIUS } from '../../core/physics/constants';
import type { Moon } from '../../universe/moon/types';
import { asteroidDesignation } from '../../universe/smallbody/notable';
import type { Asteroid } from '../../universe/smallbody/types';
import type { Star } from '../../universe/star/types';
import type { Planet, StarSystem } from '../../universe/system/types';
import { fmt, fmtDays } from './format';
import { renderPlate } from './markup';
import type { Sidebar } from './sidebar';
import { CLASS_COLOR } from './systemInfoPanel';

const TAXONOMY_LABEL: Record<Asteroid['taxonomy'], string> = {
  S: 'S-type (silicaceous)',
  C: 'C-type (carbonaceous)',
  M: 'M-type (metallic)',
  D: 'D-type (organic-rich)',
};

const TAXONOMY_COLOR: Record<Asteroid['taxonomy'], string> = {
  S: '#a08a6a',
  C: '#6f6a62',
  M: '#9a9aa4',
  D: '#7a6a58',
};

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

/**
 * Planet level: the selected body up top (planet or belt asteroid,
 * with a stepper walking the system's bodies), its moons listed below.
 */
export class PlanetInfoPanel {
  constructor(private readonly sidebar: Sidebar) {}

  render(
    hostStar: Star,
    hostPlanets: Planet[],
    planet: Planet,
    index: number,
    onStep: (delta: number) => void,
    onMoon?: (moonIndex: number) => void,
  ): void {
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
            : `${fmtDays(rotation.periodHours / 24)} · tilt ${fmt((rotation.obliquityRad * 180) / Math.PI, 2)}°${
              rotation.obliquityRad > Math.PI / 2 ? ' · retrograde' : ''
            }`,
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

    renderPlate(this.sidebar.focus, {
      title: planet.name,
      subtitle: `planet ${index + 1} of ${hostPlanets.length} · ${hostStar.spectralType}`,
      badges,
      color: CLASS_COLOR[planet.class],
      rows,
      extra: rings,
      onStep,
    });

    const moons = planet.moons;
    const moonRows = moons
      .map((moon, moonIndex) => {
        const radiusKm = moon.physical.bulk.radiusEarth * (EARTH_RADIUS / 1000);
        const notes = [
          moon.retrograde ? 'retrograde capture' : '',
          TIDAL_LABEL[moon.tidalState],
          moon.physical.atmosphere.class !== 'none' ? 'atmosphere' : '',
          moon.resonanceWithInner ? `${moon.resonanceWithInner} resonance` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return `<tr class="pick" data-index="${moonIndex}">
          <td>${moon.name.split(' ').pop()}</td>
          <td class="n">${fmt(radiusKm, 3)}</td>
          <td class="n">${fmt(moon.semiMajorAxisPlanetRadii, 3)}</td>
          <td>${notes}</td>
        </tr>`;
      })
      .join('');

    this.sidebar.level.innerHTML = `
      <h2>Moons · ${moons.length}</h2>
      ${
        moonRows
          ? `<table class="list">
              <tr><th></th><th class="n">km</th><th class="n">a R_p</th><th></th></tr>
              ${moonRows}
            </table>`
          : '<div class="empty">no moons</div>'
      }
    `;
    if (onMoon) {
      for (const row of this.sidebar.level.querySelectorAll<HTMLElement>('tr.pick')) {
        row.addEventListener('click', () => onMoon(Number(row.dataset.index)));
      }
    }
  }

  /** A focused moon's plate: its own physics, its parent one click up. */
  renderMoon(
    hostStar: Star,
    parent: Planet,
    parentIndex: number,
    moonIndex: number,
    onStep: (delta: number) => void,
    onParent: () => void,
  ): void {
    const moon = parent.moons[moonIndex];
    const { bulk, interior, rotation, atmosphere, climate } = moon.physical;
    const radiusKm = bulk.radiusEarth * (EARTH_RADIUS / 1000);
    const rows: Array<[string, string]> = [
      ['Origin', moon.channel === 'capture' ? 'captured body' : `${moon.channel} moon`],
      ['Radius', `${fmt(radiusKm)} km · ${fmt(bulk.densityGcc)} g/cm³`],
      ['Gravity', `${fmt(bulk.gravityMs2 / 9.81, 2)} g`],
      [
        'Orbit',
        `${fmt(moon.semiMajorAxisPlanetRadii)} R_p${moon.retrograde ? ' · retrograde' : ''}`,
      ],
      [
        'Rotation',
        rotation.locked ? 'tidally locked' : fmtDays(rotation.periodHours / 24),
      ],
      [
        'Atmosphere',
        atmosphere.class === 'none'
          ? 'airless'
          : `${ATMOSPHERE_LABEL[atmosphere.class]} · ${fmt(atmosphere.surfacePressureBar)} bar`,
      ],
      ['T', `${fmt(climate.surfaceMeanK, 3)} K`],
      ['Surface', HYDROSPHERE_LABEL[climate.hydrosphere]],
      ['Geology', REGIME_LABEL[interior.regime]],
    ];
    if (moon.tidalState !== 'dead') {
      rows.push(['Tidal state', `${TIDAL_LABEL[moon.tidalState]} · ${fmt(moon.tidalHeatFluxWm2)} W/m²`]);
    }
    renderPlate(this.sidebar.focus, {
      title: moon.name,
      subtitle: `moon ${moonIndex + 1} of ${parent.moons.length} · ${parent.name} · ${hostStar.spectralType}`,
      color: CLASS_COLOR[parent.class],
      rows,
      onStep,
    });
    this.sidebar.level.innerHTML = `
      <h2>Parent</h2>
      <table class="list">
        <tr class="pick" data-index="${parentIndex}"><td>${parent.name}</td><td>${parent.class}</td></tr>
      </table>
    `;
    this.sidebar.level
      .querySelector('tr.pick')!
      .addEventListener('click', onParent);
  }

  renderAsteroid(
    system: StarSystem,
    asteroid: Asteroid,
    subtitle: string,
    onStep?: (delta: number) => void,
  ): void {
    const { shape } = asteroid;
    const aAu = asteroid.elements.semiMajorAxis / AU;
    const structure = [
      asteroid.rubblePile ? 'rubble pile' : 'coherent body',
      shape.contactBinary ? 'contact binary' : '',
      asteroid.tumbling ? 'tumbling' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    renderPlate(this.sidebar.focus, {
      title: `${system.star.designation} ${asteroidDesignation(asteroid)}`,
      subtitle: `${subtitle} · ${TAXONOMY_LABEL[asteroid.taxonomy]}`,
      color: TAXONOMY_COLOR[asteroid.taxonomy],
      rows: [
        ['Diameter', `${fmt(asteroid.diameterKm)} km`],
        [
          'Shape',
          `elongation ${fmt(1 / shape.elongation, 2)} : 1 · flattening ${fmt(shape.flattening, 2)}`,
        ],
        ['Structure', structure],
        ['Spin', fmtDays(asteroid.spinPeriodHours / 24)],
        [
          'Orbit',
          `${fmt(aAu)} AU · e ${fmt(asteroid.elements.eccentricity, 2)} · i ${fmt((asteroid.elements.inclination * 180) / Math.PI, 2)}°`,
        ],
        ['Albedo', fmt(asteroid.albedo, 2)],
      ],
      onStep,
    });
  }

  renderEmpty(hostStar: Star): void {
    renderPlate(this.sidebar.focus, {
      title: hostStar.designation,
      subtitle: 'this star hosts no planets',
      rows: [],
    });
    this.sidebar.level.innerHTML = '';
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
