import { useEffect, useRef, useState, type ReactNode } from 'react';
import { seedToHex } from '../../core/rng/hash';
import { galaxySeed } from '../../universe/galaxy/galaxySeed';
import {
  ECLIPSE_RESULT_LIMIT,
  eclipsedAngularRadius,
  type EclipseFilter,
  type EclipseResult,
  type EclipseSearchProgress,
} from '../eclipseFinder';
import { searchEclipses } from '../eclipseSearch';
import { setTimePaused, simulationTimeDays, travelToEclipse, type AppSnapshot } from '../store';
import { FinderList, type FinderGroup } from './finderList';
import { fmt, fmtAngle, fmtDays } from './format';
import { sceneGlyph } from './sceneGlyphs';
import { useSessionState } from './sessionState';

const EVENT_TYPES: Array<{ value: EclipseFilter; label: string }> = [
  { value: 'all', label: 'All eclipses and transits' },
  { value: 'moon-shadow', label: 'Moon across star · from planet' },
  { value: 'parent-planet', label: 'Parent across star · from moon' },
  { value: 'sibling-moon', label: 'Moon across star · from another moon' },
  { value: 'other-planet', label: 'Other planet across star' },
];

const ATMOSPHERES: Record<EclipseResult['atmosphereClass'], string> = {
  none: 'airless',
  'hydrogen-helium': 'H₂/He',
  nitrogen: 'N₂',
  'nitrogen-oxygen': 'N₂/O₂',
  'co2-hothouse': 'CO₂ hothouse',
  'thin-co2': 'thin CO₂',
  'nitrogen-methane': 'N₂/CH₄ haze',
  'rock-vapor': 'rock vapor',
};

function resultTitle(result: EclipseResult): string {
  if (result.kind === 'transit') return 'Planetary transit';
  return `${result.kind[0].toUpperCase()}${result.kind.slice(1)} eclipse`;
}

function resultPlace(result: EclipseResult): string {
  return result.distancePc < 1e-4 ? 'in this system' : `${fmt(result.distancePc, 3)} pc away`;
}

/** Where the event stands against the clock now, not when it was found. */
function resultTiming(result: EclipseResult, nowDays: number): string {
  if (nowDays > result.endTimeDays) return 'passed';
  if (nowDays >= result.startTimeDays) return 'active now';
  return `starts in ${fmtDays(result.startTimeDays - nowDays)}`;
}

/** The sky in a few words: whether the sun still shows through the
 *  air, and whether there is enough air to make a sky at all. */
function resultAtmosphere(result: EclipseResult): string {
  if (result.atmosphereClass === 'none') return 'airless · black sky';
  const word =
    result.airTransmission < 0.25
      ? 'murky sky'
      : result.airTransmission < 0.5
        ? 'dimmed sun'
        : result.airScattering < 0.1
          ? 'thin sky'
          : 'clear sky';
  const cloud = result.cloudCover >= 0.05 ? ` · ${Math.round(result.cloudCover * 100)}% cloud` : '';
  return `${word} · ${ATMOSPHERES[result.atmosphereClass]} · ${fmt(result.atmospherePressureBar, 2)} bar${cloud}`;
}

function resultDepth(result: EclipseResult): string {
  const percent = result.obscuration * 100;
  return `${percent < 1 ? percent.toFixed(2) : Math.round(percent)}%`;
}

/** How wide the eclipse stands in the sky: the star's whole disc when
 *  it is covered, otherwise the bite taken out of it. */
function resultSize(result: EclipseResult): string {
  return `${fmtAngle(2 * eclipsedAngularRadius(result))} across`;
}

function resultDiscs(result: EclipseResult): string {
  return `Star disc ${fmtAngle(2 * result.starAngularRadius)} · blocking disc ${fmtAngle(2 * result.casterAngularRadius)}`;
}

const resultKey = (r: EclipseResult): string =>
  `${r.seedHex}:${r.hostIndex}:${r.planetIndex}:${r.observerMoonIndex}:${r.eventType}:${r.occluderName}:${r.timeDays}`;

/** A search and the galaxy it was made in: events elsewhere cannot be reached from here. */
interface EclipseSurvey {
  galaxy: string;
  filter: EclipseFilter;
  results: EclipseResult[];
}

/**
 * The eclipse survey behind its finder tab: the event type and the
 * search pinned at the top, the ranked events as rows beneath. The
 * survey walks the whole neighbourhood outward and the rows fill in as
 * it goes; cancelling keeps what it found. Starting one pauses the
 * clock, since every row is timed from that moment and a long search
 * would otherwise leave the list behind. An opened row names the sky,
 * the blocking body and the timing, and carries the travel to the
 * event; the list stays through the trip, its timing read against the
 * clock you arrive on.
 */
export function EclipseFinderPanel({
  snap,
  hidden,
  onSummary,
  onTravel,
}: {
  snap: AppSnapshot | null;
  hidden: boolean;
  /** How many events the survey holds, and whether it is still running. */
  onSummary: (count: number, busy: boolean) => void;
  onTravel: () => void;
}): ReactNode {
  const [survey, setSurvey] = useSessionState<EclipseSurvey>('finder-eclipses', { galaxy: '', filter: 'all', results: [] });
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<EclipseSearchProgress | null>(null);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = useRef<AbortController | null>(null);
  // The galaxy locks at first use, so it is only asked for once a
  // system stands, after boot has chosen it.
  const galaxy = snap ? seedToHex(galaxySeed()) : null;
  const { filter } = survey;
  const results = galaxy && survey.galaxy === galaxy ? survey.results : [];
  const nowDays = simulationTimeDays();

  useEffect(() => () => search.current?.abort(), []);
  useEffect(() => onSummary(results.length, searching), [results.length, searching, onSummary]);

  const find = async (): Promise<void> => {
    if (!snap || searching) return;
    search.current?.abort();
    const controller = new AbortController();
    search.current = controller;
    setTimePaused(true);
    setSearching(true);
    setProgress({ checked: 0, total: snap.neighbors.length + 1, distancePc: 0 });
    setSurvey({ galaxy: galaxy ?? '', filter, results: [] });
    setEmpty(false);
    setError(null);
    try {
      const found = await searchEclipses(
        snap.system,
        snap.neighbors,
        simulationTimeDays(),
        setProgress,
        controller.signal,
        filter,
        partial => setSurvey({ galaxy: galaxy ?? '', filter, results: partial }),
      );
      if (!controller.signal.aborted) {
        setSurvey({ galaxy: galaxy ?? '', filter, results: found });
        setEmpty(found.length === 0);
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Eclipse search failed');
    } finally {
      setSearching(false);
    }
  };

  const go = (result: EclipseResult): void => {
    travelToEclipse(result);
    onTravel();
  };

  const status = searching
    ? progress && progress.checked > 0
      ? `Searching ${progress.checked + 1} of ${progress.total} · ${fmt(progress.distancePc, 2)} pc`
      : 'Checking this system'
    : null;

  const groups: FinderGroup[] = results.length === 0 ? [] : [{
    label: 'Ranked events',
    entries: results.map((result, index) => ({
      key: resultKey(result),
      glyph: sceneGlyph('eclipse'),
      title: `${index + 1}. ${result.observerName}`,
      sub: `${resultTiming(result, nowDays)} · ${fmtDays(result.endTimeDays - result.startTimeDays)} long · ${resultSize(result)}`,
      score: result.obscuration * 100,
      scoreLabel: resultDepth(result),
      detail: (
        <>
          <ul>
            <li>{resultTitle(result)} · {resultAtmosphere(result)}</li>
            <li>Blocked by {result.occluderName} · {resultPlace(result)}</li>
            <li>{resultDiscs(result)}</li>
          </ul>
          <button className="finder-go" onClick={() => go(result)}>Go to event</button>
        </>
      ),
    })),
  }];

  return (
    <section className="finder-tool" hidden={hidden} role="tabpanel" aria-label="eclipses and transits">
      <div className="finder-head">
        <label className="finder-field">
          Event type
          <select value={filter} disabled={searching}
            onChange={event => { setSurvey({ galaxy: galaxy ?? '', filter: event.target.value as EclipseFilter, results: [] }); setEmpty(false); }}>
            {EVENT_TYPES.map(type => <option value={type.value} key={type.value}>{type.label}</option>)}
          </select>
        </label>
        {!searching && results.length === 0 && !empty && (
          <p className="finder-copy">
            Search outward through the whole neighbourhood, ranking up to {ECLIPSE_RESULT_LIMIT} active or next-day events by a sky that takes part yet still shows the sun, depth, size in the sky, timing, and distance as they are found. Airless worlds rank low. Stop whenever the list is good enough.
          </p>
        )}
        <div className="finder-actions">
          <button className="finder-action" disabled={!snap || searching} onClick={() => void find()}>
            {searching ? 'Searching…' : results.length > 0 || empty ? 'Search again' : 'Find eclipses'}
          </button>
          {searching && <button className="finder-action" onClick={() => search.current?.abort()}>Cancel</button>}
        </div>
        {status && <div className="finder-status" role="status">{status}</div>}
        {error && <div className="finder-empty" role="alert">{error}</div>}
        {empty && !searching && (
          <div className="finder-empty">No matching event found in the next day across the neighbourhood.</div>
        )}
      </div>
      {groups.length > 0 && <FinderList groups={groups} />}
    </section>
  );
}
