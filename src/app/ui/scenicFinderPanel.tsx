import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { seedToHex } from '../../core/rng/hash';
import { galaxySeed } from '../../universe/galaxy/galaxySeed';
import {
  SCENE_TYPES,
  shortlistScenes,
  type SceneCandidate,
  type SceneFilter,
  type SceneKind,
  type SceneProgress,
} from '../scenicFinder';
import { surveyScenes } from '../scenicSurvey';
import { travelToScene, type AppSnapshot } from '../store';
import { FinderChips } from './finderChips';
import { FinderList, type FinderGroup } from './finderList';
import { sceneGlyph } from './sceneGlyphs';
import { useSessionState } from './sessionState';

const BATCH_SIZE = 256;
const KINDS = Object.keys(SCENE_TYPES) as SceneKind[];

/** The scene types as the chip rail says them, short enough to stand in a row. */
const SHORT_NAMES: Record<SceneKind, string> = {
  'ringed-moon': 'Ringed moon',
  coastline: 'Coastline',
  binary: 'Binary sky',
  rings: 'Ring crescent',
  nebula: 'Nebula',
  galaxy: 'Galaxy',
  lava: 'Lava',
  nucleus: 'Nucleus',
};

/** A survey and where it was made: the locale whose neighbours it
 *  counted, so more scanning continues there and nowhere else. */
interface SceneSurvey {
  filter: SceneFilter;
  results: SceneCandidate[];
  batches: number;
  from: { origin: string; name: string } | null;
}

const FRESH: SceneSurvey = { filter: 'all', results: [], batches: 0, from: null };

function describe(filter: SceneFilter): string {
  const reach = filter === 'nebula' ? 'Search luminous clouds in this sector and within 300 pc.'
    : filter === 'galaxy' ? 'Compare 24 new galaxy shapes plus the current galaxy per batch.'
    : filter === 'nucleus' ? 'Compare active nuclei in the galaxy catalog and the current galaxy.'
    : filter === 'all' ? 'Search 256 nearby systems, local clouds, 24 galaxy shapes, and catalog nuclei.'
    : 'Search 256 nearby systems per batch, including planets and moons around companion stars.';
  return `${reach} Worlds rank visible illumination and subject contrast; local lighting and exact viewpoints still need your eye.`;
}

/** The shortlist under its scene types, in catalog order, narrowed to one type when asked. */
function sceneGroups(results: SceneCandidate[], view: SceneKind | null, go: (result: SceneCandidate) => void): FinderGroup[] {
  return KINDS.filter(kind => !view || kind === view).map(kind => ({
    label: SCENE_TYPES[kind],
    entries: results.filter(result => result.kind === kind).map(result => ({
      key: result.id,
      glyph: sceneGlyph(kind),
      title: result.name,
      score: result.score,
      scoreLabel: String(result.score),
      detail: (
        <>
          <ul>{result.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
          <p className="finder-framing">{result.framing}</p>
          <button className="finder-go" onClick={() => go(result)}>Go to candidate</button>
        </>
      ),
    })),
  })).filter(group => group.entries.length > 0);
}

/**
 * The scene survey behind its finder tab: the scene type and the
 * actions pinned at the top, a chip rail of the types the shortlist
 * holds, and the candidates as rows beneath. An opened row keeps its
 * reasons and framing note and travels to the candidate; the
 * shortlist stays through the trip, so the next one is a press away.
 */
export function ScenicFinderPanel({
  snap,
  hidden,
  onSummary,
  onTravel,
}: {
  snap: AppSnapshot | null;
  hidden: boolean;
  /** How many candidates the shortlist holds, and whether a survey is running. */
  onSummary: (count: number, busy: boolean) => void;
  onTravel: () => void;
}): ReactNode {
  const [survey, setSurvey] = useSessionState<SceneSurvey>('finder-scenes', FRESH);
  const { filter, results, batches, from } = survey;
  const [view, setView] = useState<SceneKind | null>(null);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<SceneProgress | null>(null);
  const [error, setError] = useState('');
  const search = useRef<AbortController | null>(null);
  // The galaxy is part of where a survey was made, and it locks at
  // first use, so it is only asked for once a system stands.
  const origin = snap ? `${seedToHex(galaxySeed())}:${snap.seedHex}:${snap.at ?? ''}` : '';
  const here = from === null || from.origin === origin;
  const cancel = () => { search.current?.abort(); search.current = null; setSearching(false); setProgress(null); };
  useEffect(() => () => search.current?.abort(), []);
  useEffect(() => onSummary(results.length, searching), [results.length, searching, onSummary]);

  const scan = async (batch: number) => {
    if (!snap || searching) return;
    const controller = new AbortController();
    search.current = controller;
    setSearching(true); setError(''); setProgress(null);
    const madeFrom = { origin, name: snap.system.star.designation };
    try {
      const found = await surveyScenes({ galaxy: seedToHex(galaxySeed()), seed: snap.seedHex,
        positionPc: snap.system.localePc, filter, batch,
        neighbors: snap.neighbors.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE).map(n => ({ seedHex: n.seedHex, positionPc: n.positionPc })) }, controller.signal, setProgress);
      if (!controller.signal.aborted) {
        setSurvey(previous => ({
          filter,
          results: shortlistScenes(batch === 0 ? found : [...previous.results, ...found], filter, 32),
          batches: batch + 1,
          from: madeFrom,
        }));
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The survey failed.');
    } finally {
      if (!controller.signal.aborted) { setSearching(false); setProgress(null); search.current = null; }
    }
  };
  const canScanMore = here && (filter === 'galaxy' || filter === 'all' ||
    (!['nebula', 'nucleus'].includes(filter) && batches * BATCH_SIZE < (snap?.neighbors.length ?? 0)));
  const go = useCallback((result: SceneCandidate) => { travelToScene(result.destination); onTravel(); }, [onTravel]);

  const chips = KINDS
    .map(kind => ({ key: kind, label: SHORT_NAMES[kind], count: results.filter(result => result.kind === kind).length }))
    .filter(chip => chip.count > 0);
  const shown = view && chips.some(chip => chip.key === view) ? view : null;
  const groups = useMemo(() => sceneGroups(results, shown, go), [results, shown, go]);

  return (
    <section className="finder-tool" hidden={hidden} role="tabpanel" aria-label="scenic locations">
      <div className="finder-head">
        <label className="finder-field">
          Scene type
          <select value={filter} onChange={event => {
            cancel(); setSurvey({ ...FRESH, filter: event.target.value as SceneFilter }); setError(''); setView(null);
          }}>
            <option value="all">All scene types</option>
            {KINDS.map(kind => <option value={kind} key={kind}>{SCENE_TYPES[kind]}</option>)}
          </select>
        </label>
        {batches === 0 && !searching && <p className="finder-copy">{describe(filter)}</p>}
        <div className="finder-actions">
          <button className="finder-action" disabled={!snap || searching} onClick={() => void scan(0)}>
            {batches === 0 ? 'Find scenes' : here ? 'Start fresh' : 'Survey here'}
          </button>
          {searching && <button className="finder-action" onClick={cancel}>Cancel</button>}
          {!searching && batches > 0 && canScanMore && <button className="finder-action" onClick={() => void scan(batches)}>Scan more</button>}
        </div>
        {searching && <div className="finder-status" role="status">{progress ? `${progress.stage} · ${progress.checked} / ${progress.total}` : 'Starting survey…'}</div>}
        {error && <div className="finder-empty" role="alert">{error}</div>}
        {!searching && batches > 0 && results.length === 0 && <div className="finder-empty">No matches in this survey.</div>}
        {results.length > 0 && (
          <p className="finder-copy" role="status">
            {results.length} candidates · scores rank visual potential{from && !here ? ` · surveyed from ${from.name}` : ''}
          </p>
        )}
      </div>
      {chips.length > 1 && <FinderChips chips={chips} value={shown} onChange={setView} />}
      {groups.length > 0 && <FinderList groups={groups} />}
    </section>
  );
}
