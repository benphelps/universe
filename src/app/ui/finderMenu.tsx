import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppSnapshot } from '../store';
import { EclipseFinderPanel } from './eclipseFinderPanel';
import { ScenicFinderPanel } from './scenicFinderPanel';

const FINDER = (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="10" r="6.4" />
    <path d="M10 3.6a6.4 6.4 0 0 0 0 12.8c-2.15-1.35-3.4-3.48-3.4-6.4S7.85 4.95 10 3.6z" fill="currentColor" fillOpacity=".18" />
    <path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2" />
  </svg>
);

type FinderTab = 'scenic' | 'eclipse';

interface FinderSummary {
  count: number;
  busy: boolean;
}

const TABS: Array<{ name: FinderTab; label: string }> = [
  { name: 'scenic', label: 'Scenic' },
  { name: 'eclipse', label: 'Eclipse' },
];

const QUIET: FinderSummary = { count: 0, busy: false };

/**
 * The tool drawer in the view's foot corner — the right beside the
 * console, the left on a phone where the clock keeps the right. One
 * survey per tab, so a long scenic shortlist never buries the eclipse
 * search, and each tab wears the count its survey found. Both surveys
 * stay mounted behind their tabs, so a search keeps running while the
 * other tab is up. The drawer grows from the orb and keeps the orb in
 * a foot band of its own, beside the drawer's name, so it never sits
 * over a result.
 */
export function FinderMenu({ snap }: { snap: AppSnapshot | null }): ReactNode {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<FinderTab>('scenic');
  const [summary, setSummary] = useState<Record<FinderTab, FinderSummary>>({ scenic: QUIET, eclipse: QUIET });
  const root = useRef<HTMLDivElement>(null);
  const reportScenic = useCallback((count: number, busy: boolean) => setSummary(all => ({ ...all, scenic: { count, busy } })), []);
  const reportEclipse = useCallback((count: number, busy: boolean) => setSummary(all => ({ ...all, eclipse: { count, busy } })), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div id="finder-corner" ref={root}>
      <button
        id="finder-toggle"
        className={open ? 'orb open' : 'orb'}
        data-tip={open ? 'fold the finders' : 'find places and events'}
        aria-label={open ? 'fold the finders' : 'find places and events'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {FINDER}
      </button>
      <div id="finder-menu" hidden={!open} role="dialog" aria-label="finders">
        <div className="finder-tabs" role="tablist">
          {TABS.map(({ name, label }) => {
            const { count, busy } = summary[name];
            return (
              <button
                key={name}
                role="tab"
                aria-selected={tab === name}
                className={tab === name ? 'on' : undefined}
                onClick={() => setTab(name)}
              >
                {label}
                {(count > 0 || busy) && (
                  <span className={busy ? 'finder-count finder-busy' : 'finder-count'}>{count > 0 ? count : ''}</span>
                )}
              </button>
            );
          })}
        </div>
        <ScenicFinderPanel snap={snap} hidden={tab !== 'scenic'} onSummary={reportScenic} onTravel={close} />
        <EclipseFinderPanel snap={snap} hidden={tab !== 'eclipse'} onSummary={reportEclipse} onTravel={close} />
        <div className="finder-foot">Finders</div>
      </div>
    </div>
  );
}
