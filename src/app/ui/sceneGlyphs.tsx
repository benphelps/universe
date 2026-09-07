import type { ReactNode } from 'react';
import type { SceneKind } from '../scenicFinder';

export type GlyphKind = SceneKind | 'eclipse';

const attrs = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** One small mark per kind of scene, so a mixed shortlist scans by
 *  shape before it reads by name. */
const GLYPHS: Record<GlyphKind, ReactNode> = {
  'ringed-moon': <svg {...attrs}><circle cx="9.5" cy="6.5" r="3" /><path d="M3.8 8.2c2.3 1.7 8.5 1.4 10.8-.9M3.8 8.2C2.9 7.5 3 6.6 3.9 6" /><circle cx="4" cy="12.5" r="1.5" fill="currentColor" stroke="none" /></svg>,
  coastline: <svg {...attrs}><path d="M2 12.5c2-1.5 4-1.5 6 0s4 1.5 6 0" /><path d="M4.5 9.5a3.5 3.5 0 0 1 7 0" /><path d="M1.5 9.5h13" /></svg>,
  binary: <svg {...attrs}><circle cx="6" cy="8.5" r="3.6" /><circle cx="12" cy="5.5" r="1.9" fill="currentColor" stroke="none" /></svg>,
  rings: <svg {...attrs}><path d="M6.5 3.5a4.5 4.5 0 1 0 0 9 3.6 3.6 0 0 1 0-9z" fill="currentColor" fillOpacity=".5" /><path d="M1.5 9c3 2 10 1.5 13.5-1.5" /></svg>,
  nebula: <svg {...attrs}><path d="M4 11.5c-2 0-2.4-3 0-3.3-.2-2.4 3-3.4 4-1.4 1.4-1.6 4.6-.4 3.8 1.9 2.2.3 1.9 2.8 0 2.8z" /><circle cx="7" cy="8.6" r=".9" fill="currentColor" stroke="none" /></svg>,
  galaxy: <svg {...attrs}><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" /><path d="M8 8c0-3 3-4.5 5.5-2.8M8 8c0 3-3 4.5-5.5 2.8M8 8c3 0 4.5 3 2.8 5.5M8 8c-3 0-4.5-3-2.8-5.5" /></svg>,
  lava: <svg {...attrs}><path d="M1.5 13 6 5l2.5 4.5L10.5 7l4 6z" /><path d="M4.2 13l1.3-3 1.5 1.6 1.2-2.2L10 13" strokeOpacity=".6" /></svg>,
  nucleus: <svg {...attrs}><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" /><path d="M2 8c2-2 10-2 12 0-2 2-10 2-12 0z" /><path d="M8 1.8v3M8 11.2v3" /></svg>,
  eclipse: <svg {...attrs}><circle cx="8" cy="8" r="5.2" strokeOpacity=".4" /><path d="M9.8 3.2a5 5 0 0 0 0 9.6A5 5 0 1 1 9.8 3.2z" fill="currentColor" /></svg>,
};

export const sceneGlyph = (kind: GlyphKind): ReactNode => GLYPHS[kind];
