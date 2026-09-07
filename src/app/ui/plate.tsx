import { useState, type ReactNode } from 'react';
import type { LinearRgb } from '../../core/color/srgb';
import { bookmarkKey, isMarked, type Bookmark } from '../bookmarks';
import type { BodyRowSpec } from './bodyRow';
import { toggleCurrentMark } from '../store';

/** Display color: gamma-encoded swatch from linear RGB. */
export function cssColor(linearRgb: LinearRgb): string {
  const [r, g, b] = linearRgb.map((c) => Math.round(255 * c ** (1 / 2.2)));
  return `rgb(${r},${g},${b})`;
}

export type PlateRows = Array<[string, ReactNode]>;

export interface PlateSection {
  id: string;
  title: string;
  summary: ReactNode;
  rows: PlateRows;
  notes?: ReactNode;
  extra?: ReactNode;
}

/** Route existing catalog rows without losing conditional or future fields.
 * Each row is claimed once; unmatched measurements remain discoverable. */
export function groupPlateRows(rows: PlateRows, groups: Array<Omit<PlateSection, 'rows'> & { labels: string[] }>): PlateSection[] {
  const remaining = new Set(rows);
  const sections = groups.map(({ labels, ...section }) => ({
    ...section,
    rows: rows.filter(row => {
      if (!remaining.has(row) || !labels.includes(row[0])) return false;
      remaining.delete(row);
      return true;
    }),
  })).filter(section => section.rows.length > 0);
  if (remaining.size) sections.push({ id: 'other', title: 'Other measurements', summary: 'Additional catalog data', rows: [...remaining] });
  return sections;
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
  rows: PlateRows;
  classification?: string;
  metrics?: Array<{ label: string; value: string; unit: string }>;
  sections?: PlateSection[];
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
        {!spec.metrics && spec.badges && <> {spec.badges}</>}
      </div>
      {spec.metrics && (spec.classification || spec.badges) && <div className="plate-tags"><span className="plate-class">{spec.classification}</span>{spec.badges}</div>}
      <div className="spectrum" style={{ background: strip }} />
      {spec.metrics && <dl className="plate-metrics">
        {spec.metrics.map(metric => <div key={metric.label}>
          <dt>{metric.label}</dt>
          <dd>{metric.value} <span>{metric.unit}</span></dd>
        </div>)}
      </dl>}
      {spec.rows.length > 0 && <PropertyTable rows={spec.rows} />}
      {spec.sections?.map(section => <MeasurementSection key={section.id} section={section} />)}
      {spec.extra}
    </>
  );
}

function PropertyTable({ rows }: { rows: PlateRows }): ReactNode {
  return <table className="props"><tbody>{rows.map(([label, value]) => (
    <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>
  ))}</tbody></table>;
}

/** Keep topic choices while stepping between planets. Closed sections do not
 * mount live readouts, so hidden seasonal data does not keep polling. */
function MeasurementSection({ section }: { section: PlateSection }): ReactNode {
  const [open, setOpen] = useState(false);
  return <details className="plate-section" open={open} onToggle={event => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
  }}>
    <summary>
      <span><span className="plate-section-title">{section.title}</span><span className="plate-section-preview">{section.summary}</span></span>
      <svg className="plate-section-chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
    </summary>
    {open && <div className="plate-section-content">
      <PropertyTable rows={section.rows} />
      {section.extra}
      {section.notes && <details className="plate-model-notes"><summary>Model notes</summary><div>{section.notes}</div></details>}
    </div>}
  </details>;
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
