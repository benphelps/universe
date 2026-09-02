import type { ReactNode } from 'react';
import { blackbodyLinearRgb } from '../../core/color/blackbody';
import type { NebulaKind } from '../../universe/galaxy/nebula';
import { spectralClassAndSubtype } from '../../universe/star/classification';
import { NEAR_CLOUD_REACH_PC, type CloudEntry } from '../localeInventory';
import { travelToCloud, type AppSnapshot, type CloudSummary } from '../store';
import { BodyRow, type BodyRowSpec } from './bodyRow';
import { fmt } from './format';
import { cssColor, type PlateSpec } from './plate';

/** A cloud's own colour: its emission lines, the starlight it
 *  scatters, or the grey of dust that catches nothing. */
export const CLOUD_COLOR: Record<NebulaKind, string> = {
  emission: '#e08ac0',
  reflection: '#9fb6e0',
  dark: '#7d7a86',
};

export const CLOUD_KIND: Record<NebulaKind, string> = {
  emission: 'emission nebula',
  reflection: 'reflection nebula',
  dark: 'dark cloud',
};

/** What a cloud is called: the lit ones are nebulae, the rest rifts. */
export function cloudTitle(name: string, kind: NebulaKind): string {
  return `the ${name} ${kind === 'dark' ? 'Rift' : 'Nebula'}`;
}

/**
 * A molecular cloud's plate. Travel to a cloud focuses the cloud, not
 * the star that happens to sit in it, so it introduces itself the way
 * any other body does — by what it is made of and what is happening
 * inside it.
 */
export function cloudPlateSpec(cloud: CloudSummary): PlateSpec {
  const color = CLOUD_COLOR[cloud.kind];
  const kind = CLOUD_KIND[cloud.kind];
  return {
    title: cloudTitle(cloud.name, cloud.kind),
    subtitle: `${kind} · ${fmt(cloud.spanPc, 3)} pc across`,
    color,
    row: {
      color,
      name: cloud.name,
      kind,
      figures: [[fmt(cloud.radiusPc, 3), 'pc']],
    },
    rows: [
      ['Mass', `${fmt(cloud.massSolar, 3)} M☉`],
      ['Mean density', `${fmt(cloud.meanDensity, 3)} H/cm³`],
      ['Metallicity', `${cloud.metallicity >= 0 ? '+' : '−'}${Math.abs(cloud.metallicity).toFixed(2)} dex`],
      ...(cloud.sources.length > 0
        ? ([
            ['Ionizing stars', `${cloud.sources.length}`],
            ['Hottest', `${fmt(cloud.hottestTeff, 3)} K`],
            ['Gas at those stars', `${fmt(cloud.sourceDensity, 3)} H/cm³`],
            ['Ionized radius', `${fmt(cloud.stromgrenRadiusPc, 3)} pc`],
            ['Age', `${fmt(cloud.ageMyr, 2)} Myr`],
          ] as Array<[string, string]>)
        : ([['Star formation', 'none lit']] as Array<[string, string]>)),
    ],
  };
}

/** A cloud as a row: its light, its kind, how big and how far. */
export function cloudRowSpec(
  entry: CloudEntry,
  options: { name?: string; kind?: string; here?: boolean } = {},
): BodyRowSpec {
  return {
    color: CLOUD_COLOR[entry.kind],
    name: options.name ?? cloudTitle(entry.name, entry.kind),
    kind: options.kind ?? CLOUD_KIND[entry.kind],
    figures: [
      [fmt(entry.spanPc, 3), 'pc'],
      [fmt(entry.distancePc, 3), 'pc'],
    ],
    here: options.here,
    onClick: () =>
      travelToCloud({ cloudSeedHex: entry.seedHex, positionPc: entry.positionPc }, 'nebula'),
  };
}

/** The lettered members of a group, in the order of their light. */
function memberName(cloud: CloudSummary, index: number): string {
  return `${cloud.name} ${index < 26 ? String.fromCharCode(65 + index) : index + 1}`;
}

/**
 * Nebula level: the stars lighting the cloud the focus stands in or
 * off, then every cloud within reach — lit or dark — as destinations.
 */
export function NebulaLevel({ snap }: { snap: AppSnapshot }): ReactNode {
  const cloud = snap.cloud ?? snap.standingCloud;
  const near = snap.inventory?.nearClouds;
  return (
    <>
      {cloud && cloud.sources.length > 0 && (
        <>
          <h2>Ionizing stars · {cloud.sources.length}</h2>
          {cloud.sources.map((source, index) => {
            const { cls, subtype } = spectralClassAndSubtype(source.tEff);
            return (
              <BodyRow
                key={index}
                spec={{
                  color: cssColor(blackbodyLinearRgb(source.tEff)),
                  name: memberName(cloud, index),
                  kind: `${cls}${subtype}`,
                  figures: [
                    [fmt(source.luminosity), 'L☉'],
                    [fmt(source.tEff, 3), 'K'],
                  ],
                }}
              />
            );
          })}
        </>
      )}
      <h2>Clouds near · within {NEAR_CLOUD_REACH_PC} pc</h2>
      {near ? (
        near.length > 0 ? (
          near.map((entry) => (
            <BodyRow
              key={entry.seedHex}
              spec={cloudRowSpec(entry, { here: entry.seedHex === snap.cloud?.seedHex })}
            />
          ))
        ) : (
          <div className="empty">clear sky — no clouds within reach</div>
        )
      ) : (
        <div className="empty">charting the clouds nearby…</div>
      )}
    </>
  );
}
