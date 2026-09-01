import type { ReactNode } from 'react';
import { NEIGHBOR_RADIUS_PC } from '../../universe/galaxy/neighborhood';
import type { GalacticAddress } from '../../universe/galaxy/regions';
import type { Star } from '../../universe/star/types';
import { travelToCloud, type AppSnapshot, type CloudSummary } from '../store';
import { fmt } from './format';
import { CoreDestination } from './nucleusPanel';
import { BodyRow } from './bodyRow';
import { cssColor, type PlateSpec } from './plate';

/**
 * A molecular cloud's plate. Travel to a cloud focuses the cloud, not
 * the star that happens to sit in it, so it introduces itself the way
 * any other body does — by what it is made of and what is happening
 * inside it.
 */
export function cloudPlateSpec(cloud: CloudSummary): PlateSpec {
  const lit = cloud.kind === 'emission';
  const color = lit ? '#e08ac0' : cloud.kind === 'reflection' ? '#9fb6e0' : '#7d7a86';
  const kind =
    cloud.kind === 'emission'
      ? 'emission nebula'
      : cloud.kind === 'reflection'
        ? 'reflection nebula'
        : 'dark cloud';
  return {
    title: `the ${cloud.name} ${lit || cloud.kind === 'reflection' ? 'Nebula' : 'Rift'}`,
    subtitle: `${kind} · ${fmt(cloud.reachPc, 3)} pc across`,
    color,
    row: {
      color,
      name: cloud.name,
      kind,
      figures: [[fmt(cloud.radiusPc, 3), 'pc']],
    },
    rows: [
      ['Mass', `${fmt(cloud.massSolar, 3)} M☉`],
      ['Density', `${fmt(cloud.hydrogenDensity, 3)} H/cm³`],
      ['Metallicity', `${cloud.metallicity >= 0 ? '+' : '−'}${Math.abs(cloud.metallicity).toFixed(2)} dex`],
      ...(cloud.ionizingStars > 0
        ? ([
            ['Ionizing stars', `${cloud.ionizingStars}`],
            ['Hottest', `${fmt(cloud.hottestTeff, 3)} K`],
            ['Ionized radius', `${fmt(cloud.stromgrenRadiusPc, 3)} pc`],
          ] as Array<[string, string]>)
        : ([['Star formation', 'none lit']] as Array<[string, string]>)),
      ['Age', `${fmt(cloud.ageMyr, 2)} Myr`],
    ],
  };
}

/** Galaxy level's plate: the current star's full galactic address. */
export function galaxyPlateSpec(
  current: Star,
  address: GalacticAddress,
  neighborCount: number,
): PlateSpec {
  return {
    title: current.designation,
    subtitle: `${current.spectralType} · ${address.sector} Sector`,
    color: cssColor(current.linearRgb),
    row: {
      color: cssColor(current.linearRgb),
      name: current.designation,
      kind: current.spectralType,
      figures: [[`${(address.radiusPc / 1000).toFixed(2)}`, 'kpc']],
    },
    rows: [
      ['Region', address.label.split(' · ')[1]],
      ['Nearest arm', `the ${address.arm} Arm`],
      ['R_galactic', `${(address.radiusPc / 1000).toFixed(2)} kpc`],
      ['Height', `${address.heightPc >= 0 ? '+' : '−'}${fmt(Math.abs(address.heightPc), 3)} pc`],
      ['Neighborhood', `${neighborCount} stars within ${NEIGHBOR_RADIUS_PC} pc`],
    ],
  };
}

/**
 * Galaxy level: the galaxy's landmark complexes as a travel table —
 * galactic-scale destinations; the stellar neighborhood lives on the
 * star tab.
 */
export function GalaxyLevel({ snap }: { snap: AppSnapshot }): ReactNode {
  const { landmarks, system } = snap;
  // The galaxy's named complexes, nearest first: destinations far
  // beyond the neighborhood — travel arrives inside the landmark.
  const sorted = (landmarks ?? [])
    .map((landmark) => ({
      landmark,
      kpc:
        Math.hypot(
          landmark.positionPc.xPc - system.localePc.xPc,
          landmark.positionPc.yPc - system.localePc.yPc,
          landmark.positionPc.zPc - system.localePc.zPc,
        ) / 1000,
    }))
    .sort((a, b) => a.kpc - b.kpc);

  return (
    <>
      <CoreDestination active={snap.coreView} />
      <h2>Landmarks</h2>
      {landmarks ? (
        sorted.map(({ landmark, kpc }) => (
          <BodyRow
            key={landmark.seedHex}
            spec={{
              name: `${landmark.name} Complex`,
              kind: 'complex',
              figures: [
                [fmt(landmark.radiusPc), 'pc'],
                [fmt(kpc), 'kpc'],
              ],
              onClick: () =>
                travelToCloud({ seedHex: landmark.seedHex, positionPc: landmark.positionPc }),
            }}
          />
        ))
      ) : (
        <div className="empty">charting the landmark complexes…</div>
      )}
    </>
  );
}
