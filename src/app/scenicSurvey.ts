import type { ScenicRequest, ScenicResponse } from '../workers/scenicFinderWorker';
import type { SceneCandidate, SceneProgress } from './scenicFinder';

/** A survey owns one disposable worker: cancel stops generation immediately. */
export function surveyScenes(job: ScenicRequest, signal: AbortSignal, onProgress: (progress: SceneProgress) => void): Promise<SceneCandidate[]> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { resolve([]); return; }
    const worker = new Worker(new URL('../workers/scenicFinderWorker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); resolve([]); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { cleanup(); reject(new Error('The scenic survey worker could not complete. Please try again.')); };
    worker.onmessage = (event: MessageEvent<ScenicResponse>) => {
      const reply = event.data;
      if (reply.type === 'progress') onProgress(reply.progress);
      else { cleanup(); if (reply.type === 'error') reject(new Error(reply.message)); else resolve(reply.candidates); }
    };
    worker.postMessage(job);
  });
}
