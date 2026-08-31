import type { ReactNode } from 'react';
import { AU } from '../../core/physics/constants';
import type { Planet, StarSystem } from '../../universe/system/types';
import { host, selectPlanet, type AppSnapshot } from '../store';
import { BodyRow, type Badge, type BodyRowSpec } from './bodyRow';
import { fmt } from './format';
import { cssColor, type PlateSpec } from './plate';

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
 * A planet as a row. Exported because a marked planet in the points of
 * interest is the same planet: it has to arrive with the same mark,
 * the same kind, the same figures and the same badges it has here, and
 * the only way to be sure of that is for both to ask this.
 *
 * Period and eccentricity are the two the row cannot carry — the name
 * has to stay whole inside 390 px — and they are on the plate, which
 * is one click away and has room for everything.
 */
export function planetRowSpec(
  planet: Planet,
  options: { name?: string; here?: boolean; onClick?: () => void } = {},
): BodyRowSpec {
  const badges: Badge[] = [];
  if (planet.inHabitableZone) badges.push({ tone: 'hz', label: 'HZ' });
  if (planet.physical.climate.biosphere) badges.push({ tone: 'bio', label: 'biosphere' });
  if (planet.tidallyLocked) badges.push({ tone: 'lock', label: 'lock' });
  if (planet.resonanceWithInner) {
    badges.push({ tone: 'res', label: planet.resonanceWithInner });
  }
  return {
    color: CLASS_COLOR[planet.class],
    name: options.name ?? planet.name,
    kind: CLASS_LABEL[planet.class],
    figures: [
      [fmt(planet.physical.bulk.massEarth), 'M⊕'],
      [fmt(planet.elements.semiMajorAxis / AU), 'AU'],
    ],
    badges,
    here: options.here,
    onClick: options.onClick,
  };
}

/** System level's plate: the host star and its formation lines. */
export function systemPlateSpec(system: StarSystem, hostIndex: number): PlateSpec {
  const companion = hostIndex > 0 ? (system.companions[hostIndex - 1] ?? null) : null;
  const star = companion ? companion.star : system.star;
  const planets = companion ? companion.planets : system.planets;
  const zones = companion ? companion.zones : system.zones;
  const configuration = companion
    ? ` · companion of ${system.star.designation}`
    : system.configuration === 'p-type'
      ? ' · circumbinary'
      : system.configuration === 's-type'
        ? ' · binary'
        : '';

  return {
    title: star.designation,
    subtitle: `${star.spectralType}${configuration} · ${planets.length} planets`,
    color: cssColor(star.linearRgb),
    row: {
      color: cssColor(star.linearRgb),
      name: star.designation,
      kind: star.spectralType,
      figures: [
        [fmt(star.mass), 'M☉'],
        [String(planets.length), 'planets'],
      ],
    },
    rows: [
      ['Star', `${fmt(star.mass)} M☉ · ${fmt(star.luminosity)} L☉`],
      ['Habitable zone', `${fmt(zones.habitableInnerAu)}–${fmt(zones.habitableOuterAu)} AU`],
      ['Frost line', `${fmt(zones.frostLineAu)} AU`],
    ],
  };
}

/**
 * System level: the planet inventory of the focused host. Clicking a
 * planet row focuses that planet.
 */
export function SystemLevel({ snap }: { snap: AppSnapshot }): ReactNode {
  const { system, companionIndex } = snap;
  const { planets, companion } = host(snap);
  const belts = companion ? companion.belts : system.belts;

  return (
    <>
      <h2>Planets · {planets.length}</h2>
      {planets.length > 0 ? (
        planets.map((planet, index) => (
          <BodyRow
            key={index}
            spec={planetRowSpec(planet, {
              here: snap.planetIndex === index && snap.viewMode === 'planet',
              onClick: () => selectPlanet(index, companionIndex),
            })}
          />
        ))
      ) : (
        <div className="empty">
          {companion ? 'no room for planets this close to the primary' : 'no planets formed here'}
        </div>
      )}
      {belts.map((belt, index) => (
        <div key={index} className="belt-row">
          {belt.kind === 'main' ? 'asteroid belt' : 'debris belt'} {fmt(belt.innerAu)}–
          {fmt(belt.outerAu)} AU
          {belt.gaps.length > 0 && ` · ${belt.gaps.length} resonance gaps`}
        </div>
      ))}
    </>
  );
}
