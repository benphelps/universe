import type { ReactNode } from 'react';
import { NEIGHBOR_RADIUS_PC } from '../../universe/galaxy/neighborhood';
import { galacticNucleus } from '../../universe/galaxy/nucleus';
import type { GalacticAddress } from '../../universe/galaxy/regions';
import type { Star } from '../../universe/star/types';
import { travelToCloud, type AppSnapshot } from '../store';
import { BodyRow } from './bodyRow';
import { fmt } from './format';
import { nucleusRowSpec } from './nucleusPanel';
import { cssColor, type PlateSpec } from './plate';

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
 * Galaxy level: the galaxy's landmarks as one travel table — the hole
 * at its centre first, then every sector, nearest first, each visited
 * at the complex it is named after.
 */
export function GalaxyLevel({ snap }: { snap: AppSnapshot }): ReactNode {
  const { landmarks, system } = snap;
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
      <BodyRow spec={nucleusRowSpec(galacticNucleus(), snap.coreView)} />
      {landmarks ? (
        sorted.map(({ landmark, kpc }) => (
          <BodyRow
            key={landmark.cloudSeedHex}
            spec={{
              name: `${landmark.name} Sector`,
              figures: [[fmt(kpc), 'kpc']],
              here: !snap.coreView && landmark.sector === snap.address.sector,
              onClick: () =>
                travelToCloud(
                  { cloudSeedHex: landmark.cloudSeedHex, positionPc: landmark.positionPc },
                  'sector',
                ),
            }}
          />
        ))
      ) : (
        <div className="empty">charting the sectors…</div>
      )}
    </>
  );
}
