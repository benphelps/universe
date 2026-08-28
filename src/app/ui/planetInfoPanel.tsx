import type { ReactNode } from 'react';
import { AU, EARTH_RADIUS } from '../../core/physics/constants';
import type { Moon } from '../../universe/moon/types';
import { asteroidDesignation } from '../../universe/smallbody/notable';
import type { Asteroid } from '../../universe/smallbody/types';
import type { Star } from '../../universe/star/types';
import type { Planet, StarSystem } from '../../universe/system/types';
import { host, selectMoon, selectPlanet, stepBody, stepMoon, type AppSnapshot } from '../store';
import { fmt, fmtDays } from './format';
import type { PlateSpec } from './plate';
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

/** The selected planet's plate, with a stepper walking the system's bodies. */
export function planetPlateSpec(
  hostStar: Star,
  hostPlanets: Planet[],
  planet: Planet,
  index: number,
): PlateSpec {
  const { bulk, interior, rotation, atmosphere, climate } = planet.physical;
  const aAu = planet.elements.semiMajorAxis / AU;

  const rows: Array<[string, ReactNode]> = [
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

  return {
    title: planet.name,
    subtitle: `planet ${index + 1} of ${hostPlanets.length} · ${hostStar.spectralType}`,
    badges: (
      <>
        {planet.inHabitableZone && <span className="badge hz">HZ</span>}
        {climate.biosphere && <span className="badge bio">biosphere</span>}
        {planet.resonanceWithInner && (
          <span className="badge res">{planet.resonanceWithInner}</span>
        )}
      </>
    ),
    color: CLASS_COLOR[planet.class],
    rows,
    extra: planet.rings && (
      <div className="belt-row">
        {planet.rings.composition} rings · {fmt(planet.rings.innerPlanetRadii, 2)}–
        {fmt(planet.rings.outerPlanetRadii, 2)} R_p
        {planet.rings.gaps.length > 0 && ` · ${planet.rings.gaps.length} gaps`}
      </div>
    ),
    onStep: stepBody,
  };
}

/** A focused moon's plate: its own physics, its parent one click up. */
export function moonPlateSpec(
  hostStar: Star,
  parent: Planet,
  moonIndex: number,
): PlateSpec {
  const moon = parent.moons[moonIndex];
  const { bulk, interior, rotation, atmosphere, climate } = moon.physical;
  const radiusKm = bulk.radiusEarth * (EARTH_RADIUS / 1000);
  const rows: Array<[string, ReactNode]> = [
    ['Origin', moon.channel === 'capture' ? 'captured body' : `${moon.channel} moon`],
    ['Radius', `${fmt(radiusKm)} km · ${fmt(bulk.densityGcc)} g/cm³`],
    ['Gravity', `${fmt(bulk.gravityMs2 / 9.81, 2)} g`],
    ['Orbit', `${fmt(moon.semiMajorAxisPlanetRadii)} R_p${moon.retrograde ? ' · retrograde' : ''}`],
    ['Rotation', rotation.locked ? 'tidally locked' : fmtDays(rotation.periodHours / 24)],
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
    rows.push([
      'Tidal state',
      `${TIDAL_LABEL[moon.tidalState]} · ${fmt(moon.tidalHeatFluxWm2)} W/m²`,
    ]);
  }
  return {
    title: moon.name,
    subtitle: `moon ${moonIndex + 1} of ${parent.moons.length} · ${parent.name} · ${hostStar.spectralType}`,
    color: CLASS_COLOR[parent.class],
    rows,
    onStep: stepMoon,
  };
}

export function asteroidPlateSpec(
  system: StarSystem,
  asteroid: Asteroid,
  subtitle: string,
  onStep?: (delta: number) => void,
): PlateSpec {
  const { shape } = asteroid;
  const aAu = asteroid.elements.semiMajorAxis / AU;
  const structure = [
    asteroid.rubblePile ? 'rubble pile' : 'coherent body',
    shape.contactBinary ? 'contact binary' : '',
    asteroid.tumbling ? 'tumbling' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return {
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
  };
}

export function emptyPlateSpec(hostStar: Star): PlateSpec {
  return {
    title: hostStar.designation,
    subtitle: 'this star hosts no planets',
    rows: [],
  };
}

/**
 * Planet level: the focused planet's moons listed below the plate, or
 * a focused moon's parent one click up.
 */
export function PlanetLevel({ snap }: { snap: AppSnapshot }): ReactNode {
  const { planets } = host(snap);
  if (snap.planetFocus === 'moon') {
    const parent = planets[snap.planetIndex];
    return (
      <>
        <h2>Parent</h2>
        <table className="list">
          <tbody>
            <tr className="pick" onClick={() => selectPlanet(snap.planetIndex)}>
              <td>{parent.name}</td>
              <td>{parent.class}</td>
            </tr>
          </tbody>
        </table>
      </>
    );
  }
  if (snap.planetFocus !== 'planet') return null;
  const moons = planets[snap.planetIndex].moons;
  return (
    <>
      <h2>Moons · {moons.length}</h2>
      {moons.length > 0 ? (
        <table className="list">
          <tbody>
            <tr>
              <th></th>
              <th className="n">km</th>
              <th className="n">a R_p</th>
              <th></th>
            </tr>
            {moons.map((moon, moonIndex) => {
              const radiusKm = moon.physical.bulk.radiusEarth * (EARTH_RADIUS / 1000);
              const notes = [
                moon.retrograde ? 'retrograde capture' : '',
                TIDAL_LABEL[moon.tidalState],
                moon.physical.atmosphere.class !== 'none' ? 'atmosphere' : '',
                moon.resonanceWithInner ? `${moon.resonanceWithInner} resonance` : '',
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <tr
                  key={moonIndex}
                  className="pick"
                  onClick={() => selectMoon(snap.planetIndex, moonIndex)}
                >
                  <td>{moon.name.split(' ').pop()}</td>
                  <td className="n">{fmt(radiusKm, 3)}</td>
                  <td className="n">{fmt(moon.semiMajorAxisPlanetRadii, 3)}</td>
                  <td>{notes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="empty">no moons</div>
      )}
    </>
  );
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
