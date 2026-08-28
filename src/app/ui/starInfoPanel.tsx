import { useMemo, type ReactNode } from 'react';
import { seedFromHex } from '../../core/rng/hash';
import { NEIGHBOR_RADIUS_PC, type Neighbor } from '../../universe/galaxy/neighborhood';
import { generateStar } from '../../universe/star/generate';
import { shortDesignation } from '../../universe/star/naming';
import type { Star } from '../../universe/star/types';
import { selectStar, travelTo, type AppSnapshot } from '../store';
import { fmt, fmtDays, fmtYears } from './format';
import { cssColor, type PlateSpec } from './plate';

/** The travel table stays readable: nearest systems only, of thousands. */
const TRAVEL_ROWS = 80;

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

/** Star level's plate: the focused star's physics. */
export function starPlateSpec(star: Star): PlateSpec {
  const rows: Array<[string, ReactNode]> = [
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
    rows.push(['Variable', `${star.variability.type} · P ${fmtDays(star.variability.periodDays)}`]);
  }
  if (star.activity.flareRatePerDay > 0.1) {
    rows.push(['Flares', `~${fmt(star.activity.flareRatePerDay, 2)}/day`]);
  }
  // The chart name above is a designation; the seed is the identity.
  rows.push(['Survey id', `SIM-${star.seedHex.slice(-8).toUpperCase()}`]);

  return {
    title: star.designation,
    subtitle: `${star.spectralType} · ${STAGE_LABEL[star.stage]}`,
    color: cssColor(star.linearRgb),
    rows,
  };
}

function massLossNote(star: Star): string {
  return Math.abs(star.mass - star.massInitial) / star.massInitial > 0.02
    ? ` (initial ${fmt(star.massInitial)})`
    : '';
}

/**
 * Star level: the system's own stars pinned first — primary, then
 * companions, each row a click away — and under them the stellar
 * neighborhood as a travel table.
 */
export function StarLevel({ snap }: { snap: AppSnapshot }): ReactNode {
  const primary = snap.system.star;
  const { neighbors, companionIndex } = snap;
  const shown = neighbors.slice(0, TRAVEL_ROWS);
  // Each neighbor's star at its true position — the same locale the
  // sky point used and travel will carry.
  const shownStars = useMemo(
    () =>
      neighbors
        .slice(0, TRAVEL_ROWS)
        .map((neighbor) =>
          generateStar(seedFromHex(neighbor.seedHex), {
            withCompanions: false,
            localePc: neighbor.positionPc,
          }),
        ),
    [neighbors],
  );

  const starRow = (
    rowStar: Star,
    index: number,
    orbit: { semiMajorAxisAu: number; periodDays: number; eccentricity: number } | null,
  ): ReactNode => (
    <tr
      key={index}
      className={`pick${index === companionIndex ? ' here' : ''}`}
      onClick={() => selectStar(index)}
    >
      <td>
        <span className="swatch" style={{ background: cssColor(rowStar.linearRgb) }} />{' '}
        {rowStar.spectralType}
      </td>
      <td className="n">{fmt(rowStar.mass)}</td>
      <td className="n">{orbit ? fmt(orbit.semiMajorAxisAu) : '—'}</td>
      <td className="n">{orbit ? fmtDays(orbit.periodDays) : '—'}</td>
      <td className="n">{orbit ? fmt(orbit.eccentricity, 2) : '—'}</td>
    </tr>
  );

  return (
    <>
      <h2>System stars · {primary.companions.length + 1}</h2>
      {primary.companions.length > 0 ? (
        <table className="list">
          <tbody>
            <tr>
              <th></th>
              <th className="n">M☉</th>
              <th className="n">AU</th>
              <th className="n">period</th>
              <th className="n">e</th>
            </tr>
            {starRow(primary, 0, null)}
            {primary.companions.map(({ star: companion, orbit }, i) =>
              starRow(companion, i + 1, orbit),
            )}
          </tbody>
        </table>
      ) : (
        <div className="empty">a single star — no companions</div>
      )}
      {neighbors.length > 0 && (
        <>
          <h2>Travel to · within {NEIGHBOR_RADIUS_PC} pc</h2>
          <table className="list">
            <tbody>
              <tr>
                <th>type</th>
                <th>system</th>
                <th className="n">pc</th>
              </tr>
              {shown.map((neighbor, i) => (
                <TravelRow key={neighbor.seedHex} neighbor={neighbor} star={shownStars[i]} />
              ))}
            </tbody>
          </table>
          {neighbors.length > shown.length && (
            <div className="empty">
              nearest {shown.length} of {neighbors.length} — glints in the sky travel too
            </div>
          )}
        </>
      )}
    </>
  );
}

function TravelRow({ neighbor, star }: { neighbor: Neighbor; star: Star }): ReactNode {
  return (
    <tr className="pick travel" onClick={() => travelTo(neighbor)}>
      <td>
        <span className="swatch" style={{ background: cssColor(star.linearRgb) }} />{' '}
        {star.spectralType}
      </td>
      <td>{shortDesignation(star.designation)}</td>
      <td className="n">{fmt(neighbor.distancePc, 3)}</td>
    </tr>
  );
}
