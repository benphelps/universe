import type { ReactNode } from 'react';
import { orbitalPeriod } from '../../core/math/orbit';
import { AU } from '../../core/physics/constants';
import { companionPlanetMu, planetMu } from '../../universe/system/generate';
import type { Planet, StarSystem } from '../../universe/system/types';
import { host, selectPlanet, type AppSnapshot } from '../store';
import { fmt, fmtDays } from './format';
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
        <table className="list">
          <tbody>
            <tr>
              <th></th>
              <th>class</th>
              <th className="n">M⊕</th>
              <th className="n">AU</th>
              <th className="n">period</th>
              <th className="n">e</th>
              <th></th>
            </tr>
            {planets.map((planet, index) => {
              const aAu = planet.elements.semiMajorAxis / AU;
              const periodDays =
                orbitalPeriod(
                  companion ? companionPlanetMu(companion, planet) : planetMu(system, planet),
                  planet.elements.semiMajorAxis,
                ) / 86400;
              return (
                <tr
                  key={index}
                  className="pick"
                  onClick={() => selectPlanet(index, companionIndex)}
                >
                  <td>
                    <span className="swatch" style={{ background: CLASS_COLOR[planet.class] }} />{' '}
                    {planet.name.split(' ').pop()}
                  </td>
                  <td>{CLASS_LABEL[planet.class]}</td>
                  <td className="n">{fmt(planet.physical.bulk.massEarth)}</td>
                  <td className="n">{fmt(aAu)}</td>
                  <td className="n">{fmtDays(periodDays)}</td>
                  <td className="n">{fmt(planet.elements.eccentricity, 2)}</td>
                  <td>
                    {planet.inHabitableZone && <span className="badge hz">HZ</span>}
                    {planet.tidallyLocked && <span className="badge lock">lock</span>}
                    {planet.resonanceWithInner && (
                      <span className="badge res">{planet.resonanceWithInner}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
