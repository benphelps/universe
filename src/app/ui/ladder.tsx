import { Fragment, type ReactNode } from 'react';
import { seedToHex } from '../../core/rng/hash';
import { galaxySeed } from '../../universe/galaxy/galaxySeed';
import { NEIGHBOR_RADIUS_PC } from '../../universe/galaxy/neighborhood';
import { galaxyName } from '../../universe/galaxy/regions';
import { asteroidDesignation } from '../../universe/smallbody/notable';
import { shortDesignation, starDesignation } from '../../universe/star/naming';
import { savedMarks } from '../bookmarks';
import { NEAR_CLOUD_REACH_PC } from '../localeInventory';
import { poiFolders } from '../poiFolders';
import { host, setRung, type AppSnapshot } from '../store';
import { GalaxyLevel } from './galaxyInfoPanel';
import { UniverseLevel } from './universePanel';
import { homeGalaxy } from '../home';
import { CLOUD_KIND, cloudTitle, NebulaLevel } from './nebulaPanel';
import { WorldLevel } from './planetInfoPanel';
import { PoiLevel } from './poiPanel';
import { SectorLevel } from './sectorPanel';
import { NearbyLevel } from './starInfoPanel';
import { CLASS_LABEL, SystemLevel } from './systemInfoPanel';

/** The containment levels, outermost first — and, off the ladder,
 *  the address book. */
export type Rung =
  | 'universe'
  | 'galaxy'
  | 'sector'
  | 'nebula'
  | 'nearby'
  | 'system'
  | 'world'
  | 'marks';

const RUNGS: Rung[] = ['universe', 'galaxy', 'sector', 'nebula', 'nearby', 'system', 'world'];

interface RungHead {
  label: string;
  /** The thing you are inside at this level. */
  name: string;
  /** Its kind, or the reason there is nothing here. */
  kind?: string;
  /** What the rung holds. */
  count: string;
  /** Whether the focus lives at this level. */
  here: boolean;
  /** Nothing stands here: the name is the absence, said quietly. */
  empty?: boolean;
}

/** The label a count wears until the chart of this locale lands. */
const CHARTING = '…';

function heads(snap: AppSnapshot): Record<Rung, RungHead> {
  const { system, address, inventory, neighbors, landmarks } = snap;
  const { star, planets, companion } = host(snap);
  const belts = companion ? companion.belts : system.belts;
  const cloud = snap.cloud ?? snap.standingCloud;
  const lit = inventory?.sector.clouds.filter((entry) => entry.kind !== 'dark').length ?? 0;
  const dark = inventory ? inventory.sector.clouds.length - lit : 0;
  const nearest = neighbors[0];
  const bodyFocused = !snap.coreView && !snap.cloud;
  const marks = savedMarks();
  const folders = poiFolders(seedToHex(galaxySeed()), marks);

  const world = ((): Pick<RungHead, 'name' | 'kind' | 'count' | 'empty'> => {
    if (!bodyFocused || snap.viewMode !== 'planet') {
      return { name: 'none focused', count: '', empty: true };
    }
    switch (snap.planetFocus) {
      case 'moon': {
        const parent = planets[snap.planetIndex];
        return {
          name: parent.moons[snap.moonIndex].name,
          kind: `moon of ${parent.name}`,
          count: `${parent.moons.length} moons`,
        };
      }
      case 'asteroid': {
        const asteroid = snap.asteroids[snap.planetIndex - planets.length];
        return { name: asteroidDesignation(asteroid), kind: 'asteroid', count: '' };
      }
      case 'empty':
        return { name: 'no worlds', count: '', empty: true };
      default: {
        const planet = planets[snap.planetIndex];
        return {
          name: planet.name,
          kind: CLASS_LABEL[planet.class],
          count: planet.moons.length > 0 ? `${planet.moons.length} moons` : 'no moons',
        };
      }
    }
  })();

  return {
    universe: {
      label: 'Universe',
      name: `${folders.length} galaxies`,
      kind: 'charted',
      count: `home · ${galaxyName(BigInt(`0x${homeGalaxy()}`))}`,
      here: false,
    },
    galaxy: {
      label: 'Galaxy',
      name: galaxyName(galaxySeed()),
      kind: `${address.arm} Arm · ${address.zone.replace('-', ' ')}`,
      count: landmarks ? `${landmarks.length} sectors` : CHARTING,
      here: snap.coreView,
    },
    sector: {
      label: 'Sector',
      name: `${address.sector} Sector`,
      count: inventory ? `${lit} nebulae · ${dark} rifts` : CHARTING,
      here: false,
    },
    nebula: {
      label: 'Nebula',
      name: cloud ? cloudTitle(cloud.name, cloud.kind) : 'none stood in',
      kind: cloud ? CLOUD_KIND[cloud.kind] : undefined,
      count: inventory
        ? `${inventory.nearClouds.length} within ${NEAR_CLOUD_REACH_PC} pc`
        : CHARTING,
      here: snap.cloud !== null,
      empty: !cloud,
    },
    nearby: {
      label: 'Nearby',
      name: nearest
        ? shortDesignation(
            starDesignation(BigInt(`0x${nearest.seedHex}`), nearest.positionPc, nearest.luminosity),
          )
        : 'no neighbours',
      kind: nearest ? 'nearest' : undefined,
      count: `${neighbors.length} within ${NEIGHBOR_RADIUS_PC} pc`,
      here: false,
      empty: !nearest,
    },
    system: {
      label: 'System',
      name: star.designation,
      kind: star.spectralType,
      count: `${planets.length} planets${belts.length > 0 ? ` · ${belts.length} belts` : ''}`,
      here: bodyFocused && (snap.viewMode === 'star' || snap.viewMode === 'system'),
    },
    world: {
      label: 'World',
      ...world,
      here: bodyFocused && snap.viewMode === 'planet',
    },
    marks: {
      label: 'Marks',
      name: `${marks.length} saved`,
      kind: `across ${folders.length} galaxies`,
      count: '',
      here: false,
    },
  };
}

function Level({ rung, snap }: { rung: Rung; snap: AppSnapshot }): ReactNode {
  switch (rung) {
    case 'universe':
      return <UniverseLevel />;
    case 'galaxy':
      return <GalaxyLevel snap={snap} />;
    case 'sector':
      return <SectorLevel snap={snap} />;
    case 'nebula':
      return <NebulaLevel snap={snap} />;
    case 'nearby':
      return <NearbyLevel snap={snap} />;
    case 'system':
      return <SystemLevel snap={snap} />;
    case 'world':
      return <WorldLevel snap={snap} />;
    case 'marks':
      return <PoiLevel />;
  }
}

function RungRow({ rung, head, open }: { rung: Rung; head: RungHead; open: boolean }): ReactNode {
  return (
    <button
      className={`rung${open ? ' open' : ''}${head.here ? ' here' : ''}${rung === 'marks' ? ' tray' : ''}`}
      aria-expanded={open}
      onClick={() => setRung(rung)}
    >
      <span className="dot" />
      <span className="lv">{head.label}</span>
      <span className={`cur${head.empty ? ' empty' : ''}`}>
        {head.name}
        {head.kind && <span className="kind">{head.kind}</span>}
      </span>
      <span className="ct">{head.count}</span>
    </button>
  );
}

/**
 * The ladder: the universe nests, so the console's navigation is the
 * path from the galaxy down to the world under the camera — one rung
 * per level, each naming the thing you are inside there and how much
 * it holds. One rung stands open at a time and lists its contents;
 * opening another is browsing, and moves nothing. Marks sit under the
 * ladder as a tray, since the address book belongs to no level.
 */
export function Ladder({ snap }: { snap: AppSnapshot }): ReactNode {
  const all = heads(snap);
  return (
    <nav id="ladder">
      {[...RUNGS, 'marks' as const].map((rung) => (
        <Fragment key={rung}>
          <RungRow rung={rung} head={all[rung]} open={snap.rung === rung} />
          {snap.rung === rung && (
            <div id="level">
              <Level rung={rung} snap={snap} />
            </div>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
