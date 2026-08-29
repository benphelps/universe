import type { ReactNode } from 'react';
import { NEIGHBOR_RADIUS_PC } from '../../universe/galaxy/neighborhood';
import type { GalacticAddress } from '../../universe/galaxy/regions';
import type { Star } from '../../universe/star/types';
import { travelTo, type AppSnapshot } from '../store';
import { fmt } from './format';
import { CoreDestination } from './nucleusPanel';
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
        <table className="list">
          <tbody>
            <tr>
              <th>complex</th>
              <th>core</th>
              <th className="n">kpc</th>
            </tr>
            {sorted.map(({ landmark, kpc }) => (
              <tr
                key={landmark.seedHex}
                className="pick poi"
                onClick={() =>
                  travelTo({ seedHex: landmark.seedHex, positionPc: landmark.positionPc })
                }
              >
                <td>{landmark.name} Complex</td>
                <td>{fmt(landmark.radiusPc)} pc</td>
                <td className="n">{fmt(kpc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty">charting the landmark complexes…</div>
      )}
    </>
  );
}
