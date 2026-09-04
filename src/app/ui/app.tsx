import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { boot, closeConsole, toggleConsole, useApp } from '../store';
import { useConsoleWidth } from './consoleGrip';
import { ClockStrip } from './clockStrip';
import { DecalToggles } from './decalToggles';
import { FinderMenu } from './finderMenu';
import { InstrumentsCorner } from './instrumentsCorner';
import { PerfReadout } from './perfReadout';
import { Sidebar } from './sidebar';
import { Welcome } from './welcome';

// The console's own glyph: the plate, its rows, and the ladder down
// the side — the panel in miniature.
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

/** Whether the wide-screen console was folded away last time. */
const FOLDED_KEY = 'console-folded';

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
 * bar along its foot, and the first-visit cover page.
 * On a narrow screen the sidebar folds into a drawer behind the
 * toggle up in the corner; on a wide one it stands beside the view
 * until folded away, and the same toggle brings it back. The unified
 * viewer itself stays outside React — it mounts into #view once and
 * owns its own canvas and overlays.
 */
export function App(): ReactNode {
  const snap = useApp();
  const view = useRef<HTMLElement>(null);
  const [width, setWidth] = useConsoleWidth();
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem(FOLDED_KEY) === '1';
    } catch {
      return false;
    }
  });

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
  const collapsed = !narrow && folded;
  // The corner readouts step aside for the toggle once the console
  // is gone from beside them.
  useEffect(() => {
    document.body.classList.toggle('console-collapsed', collapsed);
  }, [collapsed]);

  const fold = (next: boolean): void => {
    setFolded(next);
    try {
      localStorage.setItem(FOLDED_KEY, next ? '1' : '0');
    } catch {
      // Fine: the console will stand again next visit.
    }
  };
  // Folded away, the drawer is gone for the keyboard and the screen
  // reader too, not merely off the side of the screen.
  const hidden = narrow ? !open : collapsed;
  const toggle = narrow ? toggleConsole : () => fold(!folded);
  const toggleTip = hidden ? 'open the console' : 'close the console';
  return (
    <>
      <button
        id="console-toggle"
        className={`${open ? 'open' : ''}${collapsed ? ' show' : ''}`}
        data-tip={toggleTip}
        aria-label={toggleTip}
        aria-expanded={!hidden}
        onClick={toggle}
      >
        {hidden ? CONSOLE : CLOSE}
      </button>
      <Sidebar
        snap={snap}
        folded={narrow && !open}
        collapsed={collapsed}
        width={width}
        onFold={() => fold(true)}
        onWidth={setWidth}
      />
      <div id="console-scrim" hidden={!open} onClick={closeConsole} />
      <main id="view" ref={view}>
        <ClockStrip snap={snap} />
        <DecalToggles />
        <FinderMenu snap={snap} />
        <InstrumentsCorner />
        <PerfReadout />
      </main>
      <Welcome />
    </>
  );
}
