import { useEffect, useRef, type ReactNode } from 'react';
import { boot, toggleRideOut, useApp } from '../store';
import { DecalToggles } from './decalToggles';
import { SettingsMenu } from './settingsMenu';
import { Sidebar } from './sidebar';
import { TimeSeedControls } from './timeSeedControls';
import { Welcome } from './welcome';

/**
 * The whole console: the sidebar beside the viewport, the instrument
 * chrome in the viewport's corners, and the first-visit cover page.
 * The unified viewer itself stays outside React — it mounts into
 * #view once and owns its own canvas and overlays.
 */
export function App(): ReactNode {
  const snap = useApp();
  const view = useRef<HTMLElement>(null);

  useEffect(() => {
    boot(view.current!);
  }, []);

  return (
    <>
      <Sidebar snap={snap} />
      <main id="view" ref={view}>
        <TimeSeedControls seedHex={snap?.seedHex ?? ''} />
      </main>
      <SettingsMenu />
      <DecalToggles />
      <button
        id="ride"
        className={snap?.ridingOut ? 'active' : ''}
        title="slow pull-back to the galaxy frame"
        onClick={toggleRideOut}
      >
        ride out
      </button>
      <Welcome />
    </>
  );
}
