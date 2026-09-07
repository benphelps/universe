import { useEffect, useRef, useState } from 'react';
import { seedToHex } from '../../core/rng/hash';
import { galaxySeed } from '../../universe/galaxy/galaxySeed';
import type { AppSnapshot } from '../store';
import { SCENE_TYPES, sceneUrl, shortlistScenes, type SceneCandidate, type SceneFilter, type SceneProgress } from '../scenicFinder';
import { surveyScenes } from '../scenicSurvey';

const BATCH_SIZE = 256;
export function ScenicFinderPanel({ snap }: { snap: AppSnapshot | null }) {
  const [filter, setFilter] = useState<SceneFilter>('all');
  const [results, setResults] = useState<SceneCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<SceneProgress | null>(null);
  const [error, setError] = useState('');
  const [batches, setBatches] = useState(0);
  const search = useRef<AbortController | null>(null);
  const origin = `${snap?.seedHex}:${snap?.at ?? ''}`;
  const cancel = () => { search.current?.abort(); search.current = null; setSearching(false); setProgress(null); };
  useEffect(() => () => search.current?.abort(), []);
  useEffect(() => {
    search.current?.abort(); search.current = null;
    setSearching(false); setProgress(null); setBatches(0); setResults([]); setError('');
  }, [origin]);

  const scan = async (batch: number) => {
    if (!snap || searching) return;
    const controller = new AbortController();
    search.current = controller;
    setSearching(true); setError(''); setProgress(null);
    try {
      const found = await surveyScenes({ galaxy: seedToHex(galaxySeed()), seed: snap.seedHex,
        positionPc: snap.system.localePc, filter, batch,
        neighbors: snap.neighbors.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE).map(n => ({ seedHex: n.seedHex, positionPc: n.positionPc })) }, controller.signal, setProgress);
      if (!controller.signal.aborted) {
        setResults(previous => shortlistScenes(batch === 0 ? found : [...previous, ...found], filter, 32));
        setBatches(batch + 1);
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The survey failed.');
    } finally {
      if (!controller.signal.aborted) { setSearching(false); setProgress(null); search.current = null; }
    }
  };
  const canScanMore = filter === 'galaxy' || filter === 'all' ||
    (!['nebula', 'nucleus'].includes(filter) && batches * BATCH_SIZE < (snap?.neighbors.length ?? 0));
  return <section className="finder-tool scenic-finder">
    <div className="finder-tool-head"><span><strong>Scenic locations</strong><small>Scout a scene for your next image</small></span></div>
    <label className="scenic-filter">Scene type
      <select value={filter} onChange={event => {
        cancel(); setFilter(event.target.value as SceneFilter); setResults([]); setBatches(0); setError('');
      }}>
        <option value="all">All scene types</option>
        {Object.entries(SCENE_TYPES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select>
    </label>
    <p className="finder-copy">{filter === 'nebula' ? 'Search luminous clouds in this sector and within 300 pc.'
      : filter === 'galaxy' ? 'Compare 24 new galaxy shapes plus the current galaxy per batch.'
      : filter === 'nucleus' ? 'Compare active nuclei in the galaxy catalog and the current galaxy.'
      : filter === 'all' ? 'Search 256 nearby systems, local clouds, 24 galaxy shapes, and catalog nuclei.'
      : 'Search 256 nearby systems per batch, including planets and moons around companion stars.'}
      {' '}Worlds rank visible illumination and subject contrast; local lighting and exact viewpoints still need your eye.</p>
    <div className="scenic-actions">
      <button className="finder-action" disabled={!snap || searching} onClick={() => void scan(0)}>{batches ? 'Start fresh' : 'Find scenes'}</button>
      {searching && <button className="finder-action" onClick={cancel}>Cancel</button>}
      {!searching && batches > 0 && canScanMore && <button className="finder-action" onClick={() => void scan(batches)}>Scan more</button>}
    </div>
    {searching && <div className="finder-status" role="status">{progress ? `${progress.stage} · ${progress.checked} / ${progress.total}` : 'Starting survey…'}</div>}
    {error && <div className="finder-empty" role="alert">{error}</div>}
    {!searching && batches > 0 && results.length === 0 && <div className="finder-empty">No matches in this survey. {canScanMore ? 'Scan more or choose another scene type.' : 'Try another location or scene type.'}</div>}
    {results.length > 0 && <div className="finder-copy" role="status">{results.length} candidates · opens in a new tab so your shortlist stays here</div>}
    {results.map(result => <a className="finder-result scenic-result" key={result.id} href={sceneUrl(result, location.href)} target="_blank" rel="noopener noreferrer">
      <span className="finder-result-top"><strong>{SCENE_TYPES[result.kind]}</strong><span title="Heuristic visual potential, not a scientific quality measurement">{result.score}/100</span></span>
      <span className="finder-result-world">{result.name}</span>
      {result.reasons.map(reason => <span className="finder-result-meta" key={reason}>{reason}</span>)}
      <span className="scenic-framing">{result.framing}</span>
      <span className="finder-result-go">Visit candidate ↗</span>
    </a>)}
  </section>;
}
