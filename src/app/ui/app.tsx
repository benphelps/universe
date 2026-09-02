import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { boot, closeConsole, toggleConsole, toggleRideOut, useApp } from '../store';
import { DecalToggles } from './decalToggles';
import { PerfReadout } from './perfReadout';
import { SettingsMenu } from './settingsMenu';
import { Sidebar } from './sidebar';
import { TimeSeedControls } from './timeSeedControls';
import { Welcome } from './welcome';

// The console's own glyph: the plate, its rows, and the framing
// scales along the bottom — the panel in miniature.
const CONSOLE = (
  <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <rect x="2.6" y="3.2" width="14.8" height="13.6" rx="1.6" />
    <path d="M2.6 7.4h14.8M2.6 13.2h14.8M7.4 13.2v3.6M12.6 13.2v3.6M5.4 10.3h6" />
  </svg>
);

const CLOSE = (
  <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
  </svg>
);

/** The breakpoint the stylesheet folds the console at, in one place
 *  the layout can also ask about. */
const NARROW = '(max-width: 860px)';

function useNarrow(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const query = matchMedia(NARROW);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return useSyncExternalStore(subscribe, () => matchMedia(NARROW).matches);
}

/**
 * The whole console: the sidebar beside the viewport, the instrument
 * chrome in the viewport's corners, and the first-visit cover page.
 * On a narrow screen the sidebar folds into a drawer behind the
 * toggle up in the corner. The unified viewer itself stays outside
 * React — it mounts into #view once and owns its own canvas and
 * overlays.
 */
export function App(): ReactNode {
  const snap = useApp();
  const view = useRef<HTMLElement>(null);

  useEffect(() => {
    boot(view.current!);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeConsole();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const narrow = useNarrow();
  const open = snap?.consoleOpen ?? false;
  // Folded away, the drawer is gone for the keyboard and the screen
  // reader too, not merely off the side of the screen.
  const folded = narrow && !open;
  return (
    <>
      <button
        id="console-toggle"
        className={open ? 'open' : ''}
        title={open ? 'close the console' : 'open the console'}
        aria-label={open ? 'close the console' : 'open the console'}
        aria-expanded={open}
        onClick={toggleConsole}
      >
        {open ? CLOSE : CONSOLE}
      </button>
      <Sidebar snap={snap} folded={folded} />
      <div id="console-scrim" hidden={!open} onClick={closeConsole} />
      <main id="view" ref={view}>
        <TimeSeedControls seedHex={snap?.seedHex ?? ''} />
        <PerfReadout />
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
