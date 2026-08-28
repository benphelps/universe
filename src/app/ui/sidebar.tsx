import type { ReactNode } from 'react';
import { host, markFor, setTab, stepBody, type AppSnapshot } from '../store';
import { galaxyPlateSpec, GalaxyLevel } from './galaxyInfoPanel';
import { GenerationIndicator } from './generationIndicator';
import {
  asteroidPlateSpec,
  emptyPlateSpec,
  moonPlateSpec,
  planetPlateSpec,
  PlanetLevel,
} from './planetInfoPanel';
import { Plate, type PlateSpec } from './plate';
import { PoiLevel } from './poiPanel';
import { starPlateSpec, StarLevel } from './starInfoPanel';
import { systemPlateSpec, SystemLevel } from './systemInfoPanel';

export type ViewMode = 'star' | 'system' | 'planet' | 'galaxy';

/** The last tab is not a camera level: it lists the marked POIs. */
export type Tab = ViewMode | 'poi';

// Descending scale: kpc, AU, R☉, R⊕ — then the address book.
const TABS: Tab[] = ['galaxy', 'system', 'star', 'planet', 'poi'];

/** The characteristic scale each level frames. */
const TAB_UNIT: Record<Tab, string> = {
  star: 'R☉',
  system: 'AU',
  planet: 'R⊕',
  galaxy: 'kpc',
  poi: '★',
};

/**
 * The survey console beside the viewport: where you are (the sector
 * eyebrow), what you are looking at (the catalog plate), what the
 * current level holds (the scrolling table), and the four framing
 * scales along the bottom.
 */
export function Sidebar({ snap }: { snap: AppSnapshot | null }): ReactNode {
  return (
    <aside id="sidebar">
      <header id="address">
        {snap && `${snap.address.sector} Sector · ${snap.address.zone.replace('-', ' ')}`}
      </header>
      <section id="focus">{snap && <FocusPlate snap={snap} />}</section>
      <section id="level">{snap && <Level snap={snap} />}</section>
      <footer id="gen-panel">
        <GenerationIndicator />
      </footer>
      <nav id="level-nav">
        {TABS.map((tab) => (
          <button
            key={tab}
            id={`view-${tab}`}
            className={snap?.tab === tab ? 'active' : ''}
            onClick={() => setTab(tab)}
          >
            <span className="name">{tab}</span>
            <span className="unit">{TAB_UNIT[tab]}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

/** The catalog plate for the current focus — or a picked belt member's. */
function FocusPlate({ snap }: { snap: AppSnapshot }): ReactNode {
  if (snap.beltPick) {
    return <Plate spec={asteroidPlateSpec(snap.system, snap.beltPick, 'belt member')} />;
  }
  const spec = focusSpec(snap);
  return <Plate spec={spec} mark={markFor(spec.title, spec.subtitle)} />;
}

function focusSpec(snap: AppSnapshot): PlateSpec {
  const { star: hostStar, planets: hostPlanets } = host(snap);
  switch (snap.viewMode) {
    case 'star':
      return starPlateSpec(hostStar);
    case 'system':
      return systemPlateSpec(snap.system, snap.companionIndex);
    case 'galaxy':
      return galaxyPlateSpec(snap.system.star, snap.address, snap.neighbors.length);
    case 'planet':
      switch (snap.planetFocus) {
        case 'moon':
          return moonPlateSpec(hostStar, hostPlanets[snap.planetIndex], snap.moonIndex);
        case 'asteroid': {
          const ordinal = snap.planetIndex - hostPlanets.length;
          return asteroidPlateSpec(
            snap.system,
            snap.asteroids[ordinal],
            `belt asteroid ${ordinal + 1} of ${snap.asteroids.length}`,
            stepBody,
          );
        }
        case 'empty':
          return emptyPlateSpec(hostStar);
        default:
          return planetPlateSpec(hostStar, hostPlanets, hostPlanets[snap.planetIndex], snap.planetIndex);
      }
  }
}

function Level({ snap }: { snap: AppSnapshot }): ReactNode {
  switch (snap.tab) {
    case 'star':
      return <StarLevel snap={snap} />;
    case 'system':
      return <SystemLevel snap={snap} />;
    case 'planet':
      return <PlanetLevel snap={snap} />;
    case 'galaxy':
      return <GalaxyLevel snap={snap} />;
    case 'poi':
      return <PoiLevel />;
  }
}
