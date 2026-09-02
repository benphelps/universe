import type { CSSProperties, ReactNode } from 'react';
import { host, markFor, stepBody, type AppSnapshot } from '../store';
import { ConsoleGrip } from './consoleGrip';
import { galaxyPlateSpec } from './galaxyInfoPanel';
import { GenerationIndicator } from './generationIndicator';
import { Ladder } from './ladder';
import { cloudPlateSpec } from './nebulaPanel';
import { nucleusPlateSpec } from './nucleusPanel';
import {
  asteroidPlateSpec,
  emptyPlateSpec,
  moonPlateSpec,
  planetPlateSpec,
} from './planetInfoPanel';
import { Plate, type PlateSpec } from './plate';
import { starPlateSpec } from './starInfoPanel';
import { systemPlateSpec } from './systemInfoPanel';

const FOLD = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </svg>
);

/**
 * The survey console beside the viewport: what you are looking at (the
 * catalog plate), the ladder of levels you are standing inside, and
 * the generation readout along the bottom.
 */
export function Sidebar({
  snap,
  folded = false,
  collapsed = false,
  width,
  onFold,
  onWidth,
}: {
  snap: AppSnapshot | null;
  /** Off-canvas on a narrow screen: out of reach, not merely out of sight. */
  folded?: boolean;
  /** Folded away beside the view on a wide screen. */
  collapsed?: boolean;
  /** Its width beside the view, px — the drawer sets its own. */
  width: number;
  onFold: () => void;
  onWidth: (width: number) => void;
}): ReactNode {
  return (
    <aside
      id="sidebar"
      className={`${snap?.consoleOpen ? 'open' : ''}${collapsed ? ' collapsed' : ''}`}
      style={{ '--console-width': `${width}px` } as CSSProperties}
      inert={folded || collapsed}
    >
      <ConsoleGrip onWidth={onWidth} />
      <button
        id="console-fold"
        data-tip="fold the console away"
        aria-label="fold the console away"
        onClick={onFold}
      >
        {FOLD}
      </button>
      <section id="focus">{snap && <FocusPlate snap={snap} />}</section>
      {snap && <Ladder snap={snap} />}
      <footer id="gen-panel">
        <GenerationIndicator />
      </footer>
    </aside>
  );
}

/** The catalog plate for the current focus — or a picked belt member's. */
function FocusPlate({ snap }: { snap: AppSnapshot }): ReactNode {
  if (snap.beltPick) {
    return <Plate spec={asteroidPlateSpec(snap.system, snap.beltPick, 'belt member')} />;
  }
  const spec = focusSpec(snap);
  return <Plate spec={spec} mark={markFor(spec)} />;
}

function focusSpec(snap: AppSnapshot): PlateSpec {
  // At the centre there is no system to describe — the hole is the focus.
  if (snap.coreView) return nucleusPlateSpec();
  const { star: hostStar, planets: hostPlanets } = host(snap);
  switch (snap.viewMode) {
    case 'star':
      return starPlateSpec(hostStar, snap.system, snap.companionIndex);
    case 'system':
      return systemPlateSpec(snap.system, snap.companionIndex);
    case 'galaxy':
      // Standing off a cloud, the cloud is the subject.
      return snap.cloud
        ? cloudPlateSpec(snap.cloud)
        : galaxyPlateSpec(snap.system.star, snap.address, snap.neighbors.length);
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
