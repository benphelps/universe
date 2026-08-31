import type { ReactNode } from 'react';
import type { LinearRgb } from '../../core/color/srgb';
import { bookmarkKey, isMarked, type Bookmark } from '../bookmarks';
import type { BodyRowSpec } from './bodyRow';
import { toggleCurrentMark } from '../store';

/** Display color: gamma-encoded swatch from linear RGB. */
export function cssColor(linearRgb: LinearRgb): string {
  const [r, g, b] = linearRgb.map((c) => Math.round(255 * c ** (1 / 2.2)));
  return `rgb(${r},${g},${b})`;
}

export interface PlateSpec {
  title: string;
  subtitle: string;
  badges?: ReactNode;
  /** Spectral strip color — the body's own light. Omitted, the strip stays dark. */
  color?: string;
  /** The focused body as a list row. Carried so that marking it saves
   *  the row too: a mark in another galaxy can never be regenerated to
   *  be measured, and this is the only chance to record what it is. */
  row?: BodyRowSpec;
  rows: Array<[string, ReactNode]>;
  extra?: ReactNode;
  onStep?: (delta: number) => void;
}

/**
 * The catalog plate: a designation, the smear of the body's own light,
 * and its measurements — the fixed card every level renders up top.
 * With a mark, the bookmark beside the name saves the focus as a POI.
 */
export function Plate({ spec, mark }: { spec: PlateSpec; mark?: Bookmark }): ReactNode {
  const onStep = spec.onStep;
  const strip = spec.color
    ? `linear-gradient(90deg, ${spec.color} 0%, transparent 92%)`
    : 'linear-gradient(90deg, rgba(200, 225, 255, 0.22) 0%, transparent 92%)';
  return (
    <>
      <div className="plate-head">
        <h1>{spec.title}</h1>
        {mark && <BookmarkToggle mark={mark} />}
        {onStep && (
          <span className="stepper">
            <button id="body-prev" title="previous body" onClick={() => onStep(-1)}>
              ‹
            </button>
            <button id="body-next" title="next body" onClick={() => onStep(1)}>
              ›
            </button>
          </span>
        )}
      </div>
      <div className="sub">
        {spec.subtitle}
        {spec.badges && <> {spec.badges}</>}
      </div>
      <div className="spectrum" style={{ background: strip }} />
      <table className="props">
        <tbody>
          {spec.rows.map(([label, value]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {spec.extra}
    </>
  );
}

/** The bookmark beside the plate name: click to save, click to unsave. */
function BookmarkToggle({ mark }: { mark: Bookmark }): ReactNode {
  const marked = isMarked(bookmarkKey(mark));
  return (
    <button
      id="bookmark-toggle"
      className={marked ? 'marked' : ''}
      title={marked ? 'unmark this point of interest' : 'mark as a point of interest'}
      onClick={() => toggleCurrentMark(mark)}
    >
      <svg viewBox="0 0 24 24" width="13" height="13">
        <path d="M6 3h12v18l-6-5-6 5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
