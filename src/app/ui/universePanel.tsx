import type { ReactNode } from 'react';
import { blackbodyLinearRgb } from '../../core/color/blackbody';
import { seedToHex } from '../../core/rng/hash';
import { galaxySeed } from '../../universe/galaxy/galaxySeed';
import { galacticNucleus } from '../../universe/galaxy/nucleus';
import { galaxyName } from '../../universe/galaxy/regions';
import { savedMarks } from '../bookmarks';
import { homeGalaxy } from '../home';
import { poiFolders, type GalaxyFolder } from '../poiFolders';
import { makeHome, travelToGalaxy, travelToNewGalaxy } from '../store';
import { BodyRow, type BodyRowSpec } from './bodyRow';
import { fmt, fmtSolarMasses } from './format';
import { FLOW_SHORT } from './nucleusPanel';
import { cssColor } from './plate';

/**
 * A galaxy as the row its own centre would have: the hole's mark is
 * the colour its flow actually is, its kind is the shape that flow
 * takes, and its figures are the two that decide what standing there
 * looks like.
 *
 * The galaxy this session materialized answers from the live nucleus.
 * Any other cannot — the galaxy seed locks at first use — so the
 * catalogue answers for it, and a galaxy the traveler reached on their
 * own has no answer either way.
 */
export function galaxyRowSpec(folder: GalaxyFolder): BodyRowSpec {
  const spec: BodyRowSpec = {
    name: folder.name,
    here: folder.here,
    badges: [
      ...(folder.here ? [{ tone: 'here' as const, label: 'here' }] : []),
      ...(folder.galaxy === homeGalaxy() ? [{ tone: 'home' as const, label: 'home' }] : []),
    ],
    onClick: () => travelToGalaxy(folder),
  };
  const core = folder.here ? galacticNucleus() : null;
  if (core) {
    return {
      ...spec,
      color: cssColor(blackbodyLinearRgb(core.flow.innerTemperatureK)),
      kind: FLOW_SHORT[core.flow.regime],
      figures: [
        [fmtSolarMasses(core.massSolar), 'M☉'],
        [fmt(core.flow.innerTemperatureK), 'K'],
      ],
    };
  }
  if (folder.entry) {
    return {
      ...spec,
      color: cssColor(blackbodyLinearRgb(folder.entry.innerTemperatureK)),
      kind: FLOW_SHORT[folder.entry.regime],
      figures: [
        [fmtSolarMasses(folder.entry.massSolar), 'M☉'],
        [fmt(folder.entry.innerTemperatureK), 'K'],
      ],
    };
  }
  return { ...spec, kind: 'unsurveyed' };
}

/**
 * Universe level: the galaxies the survey can name from here — the
 * one you stand in, the catalogue's, home, and any holding a mark —
 * each a reboot into its centre, then a fresh one nobody has stood in.
 */
export function UniverseLevel(): ReactNode {
  const here = seedToHex(galaxySeed());
  const folders = poiFolders(here, savedMarks());
  const home = homeGalaxy();
  return (
    <>
      {folders.map((folder) => (
        <BodyRow key={folder.galaxy} spec={galaxyRowSpec(folder)} />
      ))}
      <BodyRow spec={{ name: 'a new galaxy', kind: 'fresh seed', onClick: travelToNewGalaxy }} />
      <div className="belt-row">
        home is {galaxyName(BigInt(`0x${home}`))}
        {home !== here && (
          <>
            {' · '}
            <button className="inline" onClick={makeHome}>
              make this galaxy home
            </button>
          </>
        )}
      </div>
    </>
  );
}
