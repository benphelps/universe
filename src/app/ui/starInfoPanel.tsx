import { useMemo, type ReactNode } from 'react';
import { seedFromHex } from '../../core/rng/hash';
import { NEIGHBOR_RADIUS_PC, type Neighbor } from '../../universe/galaxy/neighborhood';
import { generateStar } from '../../universe/star/generate';
import { shortDesignation } from '../../universe/star/naming';
import type { Star } from '../../universe/star/types';
import { selectStar, travelTo, type AppSnapshot } from '../store';
import { AU } from '../../core/physics/constants';
import { radiativeEfficiency } from '../../core/physics/blackHole';
import { solarMassesPerYear, type Donor } from '../../universe/star/compactAccretion';
import { stellarBlackHole } from '../../universe/star/stellarHole';
import type { StarSystem } from '../../universe/system/types';
import { BodyRow, type BodyRowSpec } from './bodyRow';
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

/**
 * A black hole's plate is not a star's. Luminosity and temperature are
 * zero and the rotation on file belongs to a progenitor that stopped
 * existing; what it has instead is a geometry, and one number — how
 * fast it turns — that fixes every length in it. What it is eating, if
 * anything, comes from the system around it.
 */
function holePlateSpec(star: Star, system: StarSystem, index: number): PlateSpec {
  const hole = stellarBlackHole(star, donorsFor(system, index), [0, 0, 1]);
  const rg = hole.gravitationalRadiusM / 1000;
  const { feeding } = hole;
  const donor =
    feeding.donorIndex >= 0 ? donorStars(system, index)[feeding.donorIndex] : null;
  const rows: Array<[string, ReactNode]> = [
    ['Mass', `${fmt(star.mass)} M☉ (from ${fmt(star.massInitial)} at birth)`],
    ['Spin', `a★ ${fmt(hole.spin, 3)} · ${fmt(radiativeEfficiency(hole.spin) * 100, 3)}% of infalling mass radiated`],
    ['Horizon', `${fmt(hole.horizonRadiusM / 1000)} km`],
    ['Photon orbit', `${fmt(hole.photonSphereRadiusM / 1000)} km`],
    ['Last stable orbit', `${fmt(hole.iscoRadiusM / 1000)} km · ${fmt(hole.iscoRadiusM / hole.gravitationalRadiusM, 3)} r_g`],
    ['Shadow', `${fmt(2 * hole.shadowRadiusM / 1000)} km across`],
    ['Gravitational radius', `${fmt(rg)} km`],
  ];
  if (feeding.mode === 'starved') {
    // The honest headline for very nearly every black hole there is.
    rows.push(['Accretion', 'starved · interstellar gas only']);
    rows.push([
      'Luminosity',
      `${feeding.eddingtonRatio.toExponential(1)} L_Edd — a lens, and nothing more`,
    ]);
  } else {
    rows.push([
      'Accretion',
      `${feeding.mode === 'roche-lobe' ? 'Roche-lobe overflow' : 'wind-fed'} from ${
        donor ? donor.designation : 'companion'
      } at ${fmt(feeding.separationAu, 3)} AU`,
    ]);
    rows.push(['Ṁ', `${solarMassesPerYear(feeding.rateKgPerS).toExponential(2)} M☉/yr`]);
    rows.push([
      'Luminosity',
      `${feeding.eddingtonRatio.toExponential(2)} L_Edd · ${hole.flow.regime === 'riaf' ? 'hot ion torus' : 'thin disc'}`,
    ]);
  }
  rows.push(['Age', fmtYears(star.ageGyr * 1e9)]);
  rows.push(['Survey id', `SIM-${star.seedHex.slice(-8).toUpperCase()}`]);
  return {
    title: star.designation,
    subtitle: `${star.spectralType} · black hole`,
    color: 'rgb(90, 96, 120)',
    row: {
      color: 'rgb(90, 96, 120)',
      name: star.designation,
      kind: 'black hole',
      figures: [
        [fmt(star.mass), 'M☉'],
        [fmt(2 * hole.shadowRadiusM / 1000), 'km'],
      ],
    },
    rows,
  };
}

/** The other stars in the system, in the order feedingFor sees them. */
function donorStars(system: StarSystem, index: number): Star[] {
  if (index === 0) return system.companions.map((c) => c.star);
  const own = system.companions[index - 1];
  if (!own) return [];
  return [
    system.star,
    ...system.companions.filter((_, i) => i !== index - 1).map((c) => c.star),
  ];
}

function donorsFor(system: StarSystem, index: number): Donor[] {
  if (index === 0) {
    return system.companions.map((c) => ({
      star: c.star,
      separationAu: c.elements.semiMajorAxis / AU,
    }));
  }
  const own = system.companions[index - 1];
  if (!own) return [];
  const donors: Donor[] = [
    { star: system.star, separationAu: own.elements.semiMajorAxis / AU },
  ];
  for (let i = 0; i < system.companions.length; i++) {
    if (i === index - 1) continue;
    donors.push({
      star: system.companions[i].star,
      separationAu:
        Math.abs(system.companions[i].elements.semiMajorAxis - own.elements.semiMajorAxis) / AU,
    });
  }
  return donors;
}

/** Star level's plate: the focused star's physics. */
export function starPlateSpec(star: Star, system?: StarSystem, index = 0): PlateSpec {
  if (star.stage === 'black-hole' && system) return holePlateSpec(star, system, index);
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
    row: starRowSpec(star),
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
    <BodyRow
      key={index}
      spec={starRowSpec(rowStar, {
        figures: orbit
          ? [
              [fmt(rowStar.mass), 'M☉'],
              [fmt(orbit.semiMajorAxisAu), 'AU'],
            ]
          : [[fmt(rowStar.mass), 'M☉']],
        here: index === companionIndex,
        onClick: () => selectStar(index),
      })}
    />
  );

  return (
    <>
      <h2>System stars · {primary.companions.length + 1}</h2>
      {primary.companions.length > 0 ? (
        <>
          {starRow(primary, 0, null)}
          {primary.companions.map(({ star: companion, orbit }, i) =>
            starRow(companion, i + 1, orbit),
          )}
        </>
      ) : (
        <div className="empty">a single star — no companions</div>
      )}
      {neighbors.length > 0 && (
        <>
          <h2>Travel to · within {NEIGHBOR_RADIUS_PC} pc</h2>
          {shown.map((neighbor, i) => (
            <BodyRow
              key={neighbor.seedHex}
              spec={starRowSpec(shownStars[i], {
                name: shortDesignation(shownStars[i].designation),
                figures: [[fmt(neighbor.distancePc, 3), 'pc']],
                onClick: () => travelTo(neighbor),
              })}
            />
          ))}
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

/**
 * A star as a row. The mark is the star's own light and the kind is its
 * spectral type, so the same star reads the same whether it is a
 * companion here, a neighbour to travel to, or a mark saved in the
 * points of interest.
 */
export function starRowSpec(
  star: Star,
  options: {
    name?: string;
    figures?: BodyRowSpec['figures'];
    here?: boolean;
    onClick?: () => void;
  } = {},
): BodyRowSpec {
  return {
    color: cssColor(star.linearRgb),
    name: options.name ?? star.designation,
    kind: star.spectralType,
    figures: options.figures ?? [[fmt(star.mass), 'M☉']],
    here: options.here,
    onClick: options.onClick,
  };
}
