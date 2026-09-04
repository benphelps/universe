import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  findNearbyEclipses,
  MAX_ECLIPSE_NEIGHBORS,
  type EclipseResult,
  type EclipseSearchProgress,
} from '../eclipseFinder';
import {
  simulationTimeDays,
  travelToEclipse,
  type AppSnapshot,
} from '../store';
import { fmt, fmtDays } from './format';

const FINDER = (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="10" r="6.4" />
    <path d="M10 3.6a6.4 6.4 0 0 0 0 12.8c-2.15-1.35-3.4-3.48-3.4-6.4S7.85 4.95 10 3.6z" fill="currentColor" fillOpacity=".18" />
    <path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2" />
  </svg>
);

const ECLIPSE = (
  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1" opacity=".35" />
    <circle cx="10.7" cy="12" r="6.2" fill="currentColor" opacity=".16" />
    <path d="M14.7 6.9a6.2 6.2 0 0 0 0 10.2A6.15 6.15 0 0 1 12 18.2 6.2 6.2 0 1 1 12 5.8c.96 0 1.87.22 2.7 1.1z" fill="currentColor" />
  </svg>
);

function resultTitle(result: EclipseResult): string {
  return `${result.kind[0].toUpperCase()}${result.kind.slice(1)} eclipse`;
}

function resultPlace(result: EclipseResult): string {
  return result.distancePc < 1e-4 ? 'in this system' : `${fmt(result.distancePc, 3)} pc away`;
}

function resultWait(result: EclipseResult): string {
  return result.active ? 'active now' : `starts in ${fmtDays(result.waitDays)}`;
}

function resultAtmosphere(result: EclipseResult): string {
  const labels: Record<EclipseResult['atmosphereClass'], string> = {
    none: 'airless',
    'hydrogen-helium': 'H₂/He',
    nitrogen: 'N₂',
    'nitrogen-oxygen': 'N₂/O₂',
    'co2-hothouse': 'CO₂ hothouse',
    'thin-co2': 'thin CO₂',
    'nitrogen-methane': 'N₂/CH₄ haze',
    'rock-vapor': 'rock vapor',
  };
  const quality =
    result.atmosphereScore >= 0.72
      ? 'clear sky'
      : result.atmosphereScore >= 0.45
        ? 'readable sky'
        : result.atmosphereScore >= 0.2
          ? 'cloudy sky'
          : 'dim haze';
  return `${quality} · ${labels[result.atmosphereClass]} · ${fmt(result.atmospherePressureBar, 2)} bar`;
}

/**
 * The bottom-right tool drawer. It starts with eclipse search, but the
 * shell deliberately belongs to finders as a family so more surveys can
 * join it without adding another corner button for every question.
 */
export function FinderMenu({ snap }: { snap: AppSnapshot | null }): ReactNode {
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<EclipseSearchProgress | null>(null);
  const [results, setResults] = useState<EclipseResult[]>([]);
  const [empty, setEmpty] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<AbortController | null>(null);

  useEffect(() => () => search.current?.abort(), []);

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

  const findEclipse = async (): Promise<void> => {
    if (!snap || searching) return;
    search.current?.abort();
    const controller = new AbortController();
    search.current = controller;
    setSearching(true);
    setProgress({
      checked: 0,
      total: Math.min(MAX_ECLIPSE_NEIGHBORS + 1, snap.neighbors.length + 1),
      distancePc: 0,
    });
    setResults([]);
    setEmpty(false);
    try {
      const found = await findNearbyEclipses(
        snap.system,
        snap.neighbors,
        simulationTimeDays(),
        setProgress,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setResults(found);
        setEmpty(found.length === 0);
      }
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  };

  const status = searching
    ? progress && progress.checked > 0
      ? `Searching ${progress.checked + 1} of ${progress.total} · ${fmt(progress.distancePc, 2)} pc`
      : 'Checking this system'
    : null;

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
        <h3 className="finder-title">Finders</h3>
        <section className="finder-tool">
          <div className="finder-tool-head">
            <span className="finder-tool-icon">{ECLIPSE}</span>
            <span>
              <strong>Eclipse</strong>
              <small>Next-day moon shadow in an atmospheric sky</small>
            </span>
          </div>
          <p className="finder-copy">
            Rank up to three active or next-day eclipses by sky clarity, depth, timing, and distance.
          </p>
          <button
            className="finder-action"
            disabled={!snap || searching}
            onClick={() => void findEclipse()}
          >
            {searching ? 'Searching…' : results.length > 0 || empty ? 'Search again' : 'Find eclipses'}
          </button>
          {status && <div className="finder-status">{status}</div>}
          {empty && !searching && (
            <div className="finder-empty">No substantial eclipse found in the nearby survey.</div>
          )}
          {results.map((result, index) => (
            <button
              className="finder-result"
              key={`${result.seedHex}:${result.hostIndex}:${result.planetIndex}:${result.moonIndex}:${result.timeDays}`}
              onClick={() => {
                travelToEclipse(result);
                setResults([]);
                setProgress(null);
                setOpen(false);
              }}
            >
              <span className="finder-result-top">
                <strong>{index + 1}. {resultTitle(result)}</strong>
                <span>{Math.round(result.obscuration * 100)}%</span>
              </span>
              <span className="finder-result-world">{result.planetName}</span>
              <span className="finder-result-meta">{resultAtmosphere(result)}</span>
              <span className="finder-result-meta">
                {result.moonName} · {resultPlace(result)} · {resultWait(result)} ·{' '}
                {fmtDays(result.endTimeDays - result.startTimeDays)} long
              </span>
              <span className="finder-result-go">Go to eclipse</span>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}
