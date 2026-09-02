import type { ReactNode } from 'react';
import { nearestStar, type ClusterEntry } from '../localeInventory';
import { travelTo, type AppSnapshot } from '../store';
import { BodyRow } from './bodyRow';
import { fmt } from './format';
import { cloudRowSpec } from './nebulaPanel';

/** The old-gold of a relaxed stellar group — no single body's light. */
const CLUSTER_COLOR = 'rgb(201, 185, 138)';

/** A cluster's members carry no seeds of their own, so travel arrives
 *  at the nearest catalog star to its core. */
function visitCluster(cluster: ClusterEntry): void {
  const gateway = nearestStar(cluster.positionPc);
  if (gateway) travelTo(gateway);
}

/**
 * Sector level: the province's holdings — the nebulae and rifts its
 * territory claims, and the open clusters in it — each a destination.
 */
export function SectorLevel({ snap }: { snap: AppSnapshot }): ReactNode {
  const inventory = snap.inventory;
  if (!inventory) {
    return <div className="empty">charting the {snap.address.sector} Sector…</div>;
  }
  const { clouds, clusters } = inventory.sector;
  const nebulae = clouds.filter((cloud) => cloud.kind !== 'dark');
  const rifts = clouds.filter((cloud) => cloud.kind === 'dark');
  const focused = snap.cloud?.seedHex;
  return (
    <>
      <h2>Nebulae · {nebulae.length}</h2>
      {nebulae.length > 0 ? (
        nebulae.map((entry) => (
          <BodyRow key={entry.seedHex} spec={cloudRowSpec(entry, { here: entry.seedHex === focused })} />
        ))
      ) : (
        <div className="empty">nothing lit in this sector</div>
      )}
      <h2>Rifts · {rifts.length}</h2>
      {rifts.length > 0 ? (
        rifts.map((entry) => (
          <BodyRow key={entry.seedHex} spec={cloudRowSpec(entry, { here: entry.seedHex === focused })} />
        ))
      ) : (
        <div className="empty">no dark clouds in this sector</div>
      )}
      <h2>Clusters · {clusters.length}</h2>
      {clusters.length > 0 ? (
        clusters.map((cluster, index) => (
          <BodyRow
            key={index}
            spec={{
              color: CLUSTER_COLOR,
              name: 'open cluster',
              kind: `${fmt(cluster.ageGyr * 1000, 2)} Myr`,
              figures: [
                [fmt(cluster.richness, 3), 'stars'],
                [fmt(cluster.distancePc, 3), 'pc'],
              ],
              onClick: () => visitCluster(cluster),
            }}
          />
        ))
      ) : (
        <div className="empty">no open clusters in this sector</div>
      )}
    </>
  );
}
