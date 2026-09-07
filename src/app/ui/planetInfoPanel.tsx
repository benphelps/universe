import { ASTEROID_ROUNDING_DIAMETER_KM } from '../../universe/smallbody/asteroids';
import type { ReactNode } from 'react';
import { AU, EARTH_RADIUS } from '../../core/physics/constants';
import type { Moon } from '../../universe/moon/types';
import type { Characterization, CloudCondensate, PlanetAtmosphere, PlanetCloudLayer } from '../../universe/planet/types';
import { atmosphericColumnProfile } from '../../universe/planet/thermodynamics';
import { columnStateAt } from '../../universe/planet/hydrostaticColumn';
import { asteroidDesignation } from '../../universe/smallbody/notable';
import type { Asteroid } from '../../universe/smallbody/types';
import type { Star } from '../../universe/star/types';
import type { Planet, StarSystem } from '../../universe/system/types';
import { host, selectMoon, stepBody, stepMoon, type AppSnapshot } from '../store';
import { BodyRow, type Badge, type BodyRowSpec } from './bodyRow';
import { fmt, fmtDays } from './format';
import { groupPlateRows, type PlateRows, type PlateSection, type PlateSpec } from './plate';
import { CLASS_COLOR, CLASS_LABEL, planetRowSpec } from './systemInfoPanel';
import { SeasonalReadout } from './seasonalReadout';

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
  nitrogen: 'N₂ dominated',
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

const CLOUD_LABEL: Record<CloudCondensate, string> = {
  none: 'none',
  water: 'water',
  'carbon-dioxide': 'CO₂ ice',
  'sulfuric-acid': 'sulfuric acid',
  methane: 'methane',
  mineral: 'mineral clouds',
};

function cloudLine(clouds: PlanetCloudLayer): string {
  return clouds.condensate === 'none'
    ? 'none'
    : `${CLOUD_LABEL[clouds.condensate]} · ${fmt(clouds.coverage * 100, 2)}% · top ${fmt(clouds.topAltitudeKm, 3)} km`;
}

const REGIME_LABEL: Record<string, string> = {
  dead: 'geologically dead',
  'stagnant-lid': 'stagnant lid',
  'active-tectonics': 'plate tectonics',
  volcanic: 'volcanically active',
  magma: 'molten surface',
  gas: '—',
};

function compositionLine(atmosphere: PlanetAtmosphere): string {
  return Object.entries(atmosphere.partialPressuresBar ?? {})
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([gas, p]) => `${gas} ${fmt(p / atmosphere.surfacePressureBar * 100, 3)}%`)
    .join(' · ');
}

function columnRows(physical: Characterization): Array<[string, ReactNode]> {
  const column = atmosphericColumnProfile(physical.atmosphere, physical.climate, physical.bulk);
  if (!column) return [];
  const rows: Array<[string, ReactNode]> = [
    ['Column estimate', column.regime === 'dry-ideal-gas' ? 'dry ideal gas' : 'ideal gas · extrapolated'],
  ];
  const water = physical.atmosphere.waterReservoir;
  if (water?.status === 'dilute') {
    rows.push(['Water vapor', <span title={`Reference humidity closure at the annual datum temperature, not current weather. Retained water: ${fmt(water.totalKgM2, 3)} kg/m²; vapor plus condensate conserve this inventory. Gray infrared opacity remains approximate.`}>
      {`${fmt(water.vaporKgM2!, 3)} kg/m² · ${fmt(water.relativeHumidity! * 100, 2)}% ref RH`}
    </span>]);
  } else if (water?.status === 'steam-limit' || water?.status === 'temperature-limit') {
    rows.push(['Water partition', water.status === 'steam-limit' ? 'steam regime · unresolved' : 'temperature limit · unresolved']);
  }
  const clouds = physical.appearance.clouds;
  if (clouds.condensate !== 'none') {
    const state = columnStateAt(column, clouds.topAltitudeKm * 1000);
    rows.push(['Cloud-top gas', `≈ ${fmt(state.pressurePa / 1e5, 3)} bar · ${fmt(state.temperatureK, 3)} K`]);
  }
  return rows;
}

/** The selected planet's plate, with a stepper walking the system's bodies. */
export function planetPlateSpec(
  hostStar: Star,
  hostPlanets: Planet[],
  planet: Planet,
  index: number,
): PlateSpec {
  const { bulk, interior, rotation, atmosphere, climate, appearance } = planet.physical;
  const aAu = planet.elements.semiMajorAxis / AU;

  const giant = atmosphere.class === 'hydrogen-helium';
  const classLabel = CLASS_LABEL[planet.class] + (climate.snowball ? ' · snowball' : '');
  const rotationLabel = rotation.locked
    ? 'tidally locked'
    : rotation.spinOrbitResonance
      ? `3:2 resonance (${fmtDays(rotation.periodHours / 24)})`
      : `${fmtDays(rotation.periodHours / 24)} · tilt ${fmt((rotation.obliquityRad * 180) / Math.PI, 2)}°${rotation.obliquityRad > Math.PI / 2 ? ' · retrograde' : ''}`;
  const climateRows: PlateRows = [
    ['Temperature', temperatureLine(planet)],
    ['Albedo', fmt(climate.bondAlbedo, 2)],
  ];
  if (climate.surfaceField) climateRows.push(
    ['Annual reference', <span title="Equilibrium under annual-average forcing, not seasonal extrema">{`${fmt(climate.surfaceField.minimumK, 3)}–${fmt(climate.surfaceField.maximumK, 3)} K · datum`}</span>],
    ['Below view', <SeasonalReadout key={planet.physical.seedHex} seedHex={planet.physical.seedHex} />],
    ['Terrain climate', <SeasonalReadout annual key={planet.physical.seedHex} seedHex={planet.physical.seedHex} />],
  );
  if (!giant) climateRows.push(['Surface', surfaceLine(planet)]);

  const airRows: PlateRows = [
    ['Atmosphere', atmosphereLine(planet)],
    [appearance.banding ? 'Atmospheric bands' : 'Clouds', appearance.banding
      ? `${appearance.banding.bandCount} belts/zones${appearance.banding.majorStormSize > 0 ? ' · major storm' : ''}`
      : cloudLine(appearance.clouds)],
  ];
  if (atmosphere.surfacePressureBar > 0 && atmosphere.partialPressuresBar) airRows.push(
    ['Gas mixture', compositionLine(atmosphere)],
    ['Scale height', `${fmt(atmosphere.scaleHeightKm, 3)} km · μ ${fmt(atmosphere.meanMolecularMassAmu ?? 0, 3)} u`],
  );
  airRows.push(...columnRows(planet.physical));

  const bodyRows: PlateRows = [
    ['Class', classLabel],
    ['Mass', `${fmt(bulk.massEarth)} M⊕`],
    ['Radius', `${fmt(bulk.radiusEarth)} R⊕`],
    ['Density', `${fmt(bulk.densityGcc)} g/cm³`],
    ['Gravity', `${fmt(bulk.gravityMs2 / 9.81, 2)} g`],
  ];
  if (!giant) bodyRows.push(['Geology', REGIME_LABEL[interior.regime]]);
  bodyRows.push(['Magnetic', interior.magneticFieldRelEarth > 0.02
    ? `${fmt(interior.magneticFieldRelEarth, 2)}× Earth` : 'none']);

  const sections: PlateSection[] = [
    {
      id: 'climate', title: giant ? 'Temperature & climate' : 'Climate & surface',
      summary: giant ? `${fmt(climate.surfaceMeanK, 3)} K ${appearance.banding ? 'effective' : climate.surfaceField ? 'annual equilibrium' : 'mean'}` : surfaceLine(planet),
      rows: climateRows,
      notes: climate.surfaceField ? 'The annual reference is equilibrium under annual-average forcing, not seasonal extrema. Below-view temperature is a seasonal estimate at the camera latitude; terrain climate is its persistent reference. Seasonal snow changes appearance while water-phase geometry stays fixed.' : undefined,
    },
    {
      id: 'atmosphere', title: appearance.banding ? 'Atmosphere & bands' : 'Atmosphere & clouds',
      summary: <>{atmosphereLine(planet)}{appearance.banding
        ? ` · ${appearance.banding.bandCount} belts/zones`
        : appearance.clouds.condensate !== 'none' ? ` · ${fmt(appearance.clouds.coverage * 100, 2)}% cloud cover` : ''}</>,
      rows: airRows,
      notes: atmosphere.surfacePressureBar > 0 ? 'Gas abundances and the atmospheric column are model estimates. Reference humidity uses the annual datum temperature, not current weather. Infrared opacity is approximate; a habitable-zone or biosphere flag does not imply breathable air.' : undefined,
    },
    {
      id: 'body', title: giant ? 'Body & interior' : 'Body & geology',
      summary: `${fmt(bulk.massEarth)} M⊕${giant ? '' : ` · ${REGIME_LABEL[interior.regime]}`}`,
      rows: bodyRows,
    },
    {
      id: 'orbit', title: planet.rings ? 'Orbit, rotation & rings' : 'Orbit & rotation',
      summary: `${fmt(aAu)} AU · ${rotation.locked ? 'tidally locked' : fmtDays(rotation.periodHours / 24) + ' rotation'}`,
      rows: [['Orbit', `${fmt(aAu)} AU · e ${fmt(planet.elements.eccentricity, 2)}`], ['Rotation', rotationLabel]],
      extra: planet.rings && <div className="belt-row">
        {planet.rings.composition} rings · {fmt(planet.rings.innerPlanetRadii, 2)}–{fmt(planet.rings.outerPlanetRadii, 2)} R_p
        {planet.rings.gaps.length > 0 && ` · ${planet.rings.gaps.length} gaps`}
      </div>,
    },
  ];

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
    row: planetRowSpec(planet),
    rows: [],
    classification: classLabel,
    metrics: [
      { label: 'Radius', value: fmt(bulk.radiusEarth), unit: 'R⊕' },
      { label: 'Gravity', value: fmt(bulk.gravityMs2 / 9.81, 2), unit: 'g' },
      { label: appearance.banding ? 'Effective T' : climate.surfaceField ? 'Annual eq.' : 'Mean T', value: fmt(climate.surfaceMeanK, 3), unit: 'K' },
    ],
    sections,
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
  const { bulk, interior, rotation, atmosphere, climate, appearance } = moon.physical;
  const radiusKm = bulk.radiusEarth * (EARTH_RADIUS / 1000);
  const rows: Array<[string, ReactNode]> = [
    ['Origin', moon.channel === 'capture' ? 'captured body' : `${moon.channel} moon`],
    ['Radius', `${fmt(radiusKm)} km · ${fmt(bulk.densityGcc)} g/cm³`],
    ['Gravity', `${fmt(bulk.gravityMs2 / 9.81, 2)} g`],
    ['Orbit', `${fmt(moon.semiMajorAxisPlanetRadii)} R_p${moon.retrograde ? ' · retrograde' : ''}`],
    ['Rotation', rotation.locked ? 'locked to planet' : fmtDays(rotation.periodHours / 24)],
    [
      'Atmosphere',
      atmosphere.class === 'none'
        ? 'airless'
        : `${ATMOSPHERE_LABEL[atmosphere.class]} · ${fmt(atmosphere.surfacePressureBar)} bar`,
    ],
    ['Clouds', cloudLine(appearance.clouds)],
    ['T', `${fmt(climate.surfaceMeanK, 3)} K${climate.surfaceField ? ' annual equilibrium' : ''}`],
    ['Surface', hydrosphereLine(climate)],
    ['Geology', REGIME_LABEL[interior.regime]],
  ];
  if (climate.surfaceField) rows.push(['Annual reference', <span title="Equilibrium under annual-average forcing, not seasonal extrema">{`${fmt(climate.surfaceField.minimumK, 3)}–${fmt(climate.surfaceField.maximumK, 3)} K · datum`}</span>]);
  if (climate.surfaceField) rows.push(['Seasonal T', <SeasonalReadout key={moon.physical.seedHex} seedHex={moon.physical.seedHex} />]);
  if (climate.surfaceField) rows.push(['Terrain climate', <SeasonalReadout annual key={moon.physical.seedHex} seedHex={moon.physical.seedHex} />]);
  if (rotation.solarDayHours != null) rows.push(['Solar day', fmtDays(rotation.solarDayHours / 24)]);
  if (atmosphere.surfacePressureBar > 0 && atmosphere.partialPressuresBar) {
    rows.push(['Gas mixture', compositionLine(atmosphere)]);
    rows.push(['Scale height', `${fmt(atmosphere.scaleHeightKm, 3)} km · μ ${fmt(atmosphere.meanMolecularMassAmu ?? 0, 3)} u`]);
  }
  rows.push(...columnRows(moon.physical));
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
    row: moonRowSpec(moon),
    rows: [],
    classification: moon.channel === 'capture' ? 'captured moon' : `${moon.channel} moon`,
    metrics: [
      { label: 'Radius', value: fmt(radiusKm), unit: 'km' },
      { label: 'Gravity', value: fmt(bulk.gravityMs2 / 9.81, 2), unit: 'g' },
      { label: climate.surfaceField ? 'Annual eq.' : 'Mean T', value: fmt(climate.surfaceMeanK, 3), unit: 'K' },
    ],
    sections: groupPlateRows(rows, [
      { id: 'climate', title: 'Climate & surface', summary: hydrosphereLine(climate), labels: ['T', 'Surface', 'Annual reference', 'Seasonal T', 'Terrain climate'] },
      { id: 'atmosphere', title: 'Atmosphere & clouds', summary: atmosphere.class === 'none' ? 'airless' : `${ATMOSPHERE_LABEL[atmosphere.class]} · ${fmt(atmosphere.surfacePressureBar)} bar`, labels: ['Atmosphere', 'Clouds', 'Gas mixture', 'Scale height', 'Column estimate', 'Water vapor', 'Water partition', 'Cloud-top gas'] },
      { id: 'body', title: 'Body & tides', summary: moon.tidalState === 'dead' ? REGIME_LABEL[interior.regime] : TIDAL_LABEL[moon.tidalState], labels: ['Origin', 'Radius', 'Gravity', 'Geology', 'Tidal state'] },
      { id: 'orbit', title: 'Orbit & rotation', summary: `${fmt(moon.semiMajorAxisPlanetRadii)} R_p · ${rotation.locked ? 'locked to planet' : fmtDays(rotation.periodHours / 24)}`, labels: ['Orbit', 'Rotation', 'Solar day'] },
    ]),
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
    asteroid.diameterKm >= ASTEROID_ROUNDING_DIAMETER_KM ? 'gravity-dominated body' : asteroid.rubblePile ? 'rubble pile' : 'coherent body',
    shape.contactBinary ? 'contact binary' : '',
    asteroid.tumbling ? 'tumbling' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const rows: PlateRows = [
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
  ];
  return {
    title: `${system.star.designation} ${asteroidDesignation(asteroid)}`,
    subtitle: `${subtitle} · ${TAXONOMY_LABEL[asteroid.taxonomy]}`,
    color: TAXONOMY_COLOR[asteroid.taxonomy],
    rows: [],
    metrics: [
      { label: 'Diameter', value: fmt(asteroid.diameterKm), unit: 'km' },
      { label: 'Spin', value: fmtDays(asteroid.spinPeriodHours / 24), unit: '' },
      { label: 'Orbit', value: fmt(aAu), unit: 'AU' },
    ],
    sections: groupPlateRows(rows, [
      { id: 'body', title: 'Shape & material', summary: structure, labels: ['Diameter', 'Shape', 'Structure', 'Albedo'] },
      { id: 'orbit', title: 'Orbit & rotation', summary: `e ${fmt(asteroid.elements.eccentricity, 2)}${asteroid.tumbling ? ' · tumbling' : ''}`, labels: ['Orbit', 'Spin'] },
    ]),
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
 * A moon as a row. Its tidal state, its air and any resonance are what
 * distinguish one from another, so they ride as badges rather than as
 * a sentence in a trailing column nobody could scan.
 */
export function moonRowSpec(
  moon: Moon,
  options: { here?: boolean; onClick?: () => void } = {},
): BodyRowSpec {
  const badges: Badge[] = [];
  if (moon.physical.atmosphere.class !== 'none') badges.push({ tone: 'res', label: 'air' });
  // Tidal heating: the ocean under the ice is the one worth finding, so
  // it takes the green the biospheres wear; the rest is warmth.
  if (moon.tidalState === 'subsurface-ocean') badges.push({ tone: 'bio', label: 'ocean' });
  else if (moon.tidalState !== 'dead') {
    badges.push({ tone: 'lock', label: TIDAL_LABEL[moon.tidalState] });
  }
  if (moon.retrograde) badges.push({ tone: 'lock', label: 'retrograde' });
  if (moon.resonanceWithInner) {
    badges.push({ tone: 'res', label: moon.resonanceWithInner });
  }
  return {
    color: MOON_COLOR,
    name: moon.name,
    kind: 'moon',
    figures: [
      [fmt(moon.physical.bulk.radiusEarth * (EARTH_RADIUS / 1000), 3), 'km'],
      [fmt(moon.semiMajorAxisPlanetRadii, 3), 'R_p'],
    ],
    badges,
    here: options.here,
    onClick: options.onClick,
  };
}

/** Moons have no class palette of their own; grey stands for rock and
 *  ice alike, and the figures carry the difference. */
const MOON_COLOR = 'rgb(154, 164, 174)';

/**
 * World level: the focused world's moons — or, at a moon, its
 * siblings. With no world focused there is nothing to list.
 */
export function WorldLevel({ snap }: { snap: AppSnapshot }): ReactNode {
  const { planets } = host(snap);
  if (snap.coreView || snap.cloud || snap.viewMode !== 'planet') {
    return <div className="empty">no world focused — pick one from the system rung</div>;
  }
  if (snap.planetFocus === 'empty') return <div className="empty">this star hosts no worlds</div>;
  if (snap.planetFocus !== 'planet' && snap.planetFocus !== 'moon') return null;
  const parent = planets[snap.planetIndex];
  const moons = parent.moons;
  return (
    <>
      {moons.length > 0 ? (
        moons.map((moon, moonIndex) => (
          <BodyRow
            key={moonIndex}
            spec={moonRowSpec(moon, {
              here: snap.moonIndex === moonIndex,
              onClick: () => selectMoon(snap.planetIndex, moonIndex),
            })}
          />
        ))
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
  const kind = planet.physical.appearance.banding ? 'effective' : climate.surfaceField ? 'annual equilibrium' : 'mean';
  const base = `${fmt(climate.surfaceMeanK, 3)} K ${kind} (stellar eq ${fmt(climate.equilibriumK, 3)} K)`;
  return rotation.locked && climate.dayNightDeltaK > 20
    ? `${base} · Δday-night ${fmt(climate.dayNightDeltaK, 3)} K`
    : base;
}

function surfaceLine(planet: Planet): string {
  const { climate } = planet.physical;
  return hydrosphereLine(climate);
}

function hydrosphereLine(climate: Planet['physical']['climate']): string {
  const label = HYDROSPHERE_LABEL[climate.hydrosphere];
  if (climate.hydrosphere === 'oceans') {
    return `water basins (${fmt(climate.oceanCoverage * 100, 2)}% cover)`;
  }
  if (climate.hydrosphere === 'magma') {
    if (climate.oceanCoverage < 0.01) {
      return `localized lava (${fmt(climate.oceanCoverage * 100, 2)}% · ${fmt(climate.magmaTemperatureK ?? 1800, 3)} K)`;
    }
    return climate.oceanCoverage >= 1 - 1e-6
      ? 'global magma ocean'
      : `${label} (${fmt(climate.oceanCoverage * 100, 2)}% cover)`;
  }
  return label;
}
