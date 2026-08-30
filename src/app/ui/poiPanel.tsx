import { useRef, useState, type ReactNode } from 'react';
import { seedToHex } from '../../core/rng/hash';
import { galaxySeed } from '../../universe/galaxy/galaxySeed';
import { SURVEY_MARKS, bookmarkKey, savedMarks, type Bookmark } from '../bookmarks';
import { CATALOG_GALAXIES, type CatalogGalaxy } from '../galaxyCatalog';
import { removeSavedMark, saveCaption, travelToGalaxy, travelToMark } from '../store';

/**
 * The POI tab: galaxies first, then the survey's shipped bodies, then
 * the traveler's own marks — every row a travel link, and the ones in
 * another galaxy carrying it along. The catalog plate above stays on
 * the current body; this tab is the address book, not a camera level.
 */
export function PoiLevel(): ReactNode {
  const here = seedToHex(galaxySeed());
  const saved = savedMarks();
  const [editingKey, setEditingKey] = useState<string | null>(null);

  return (
    <>
      <h2>Galaxies · {CATALOG_GALAXIES.length}</h2>
      {CATALOG_GALAXIES.map((entry) => (
        <GalaxyRow key={entry.galaxy} entry={entry} here={here} />
      ))}
      <h2>Survey highlights · {SURVEY_MARKS.length}</h2>
      {SURVEY_MARKS.map((mark) => (
        <MarkRow key={bookmarkKey(mark)} mark={mark} here={here} />
      ))}
      <h2>Your marks · {saved.length}</h2>
      {saved.length > 0 ? (
        saved.map((mark) => {
          const key = bookmarkKey(mark);
          return (
            <MarkRow
              key={key}
              mark={mark}
              here={here}
              own
              editing={editingKey === key}
              onEdit={(open) => setEditingKey(open ? key : null)}
            />
          );
        })
      ) : (
        <div className="empty">
          nothing marked yet — the bookmark beside a body’s name saves it here
        </div>
      )}
    </>
  );
}

/**
 * One galaxy, and the hole at the middle of it. The figures are the
 * model's own and are checked against it by galaxyCatalog.test, so what
 * this row says is what standing there will show.
 */
function GalaxyRow({ entry, here }: { entry: CatalogGalaxy; here: string }): ReactNode {
  return (
    <div className="mark pick" onClick={() => travelToGalaxy(entry)}>
      <div className="mark-head">
        <span className="kind">core</span> {entry.name}
        {entry.galaxy === here && <span className="badge">you are here</span>}
      </div>
      <div className="mark-note">{entry.note}</div>
      <div className="mark-note figures">
        {solarMasses(entry.massSolar)} M☉ · a★ {entry.spin.toFixed(3)} ·{' '}
        {eddington(entry.eddingtonRatio)} L_Edd ·{' '}
        {entry.regime === 'thin-disc' ? 'thin disc' : 'hot torus'}
      </div>
    </div>
  );
}

/** Solar masses, in the units the eye reads fastest. */
function solarMasses(value: number): string {
  if (value >= 1e8) return `${(value / 1e6).toFixed(0)}M`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
  return value.toFixed(0);
}

/** Eddington ratio: percentages where it means something, exponents
 *  where the hole is starving. */
function eddington(value: number): string {
  if (value >= 0.01) return `${(value * 100).toFixed(0)}%`;
  return value.toExponential(0);
}

function MarkRow({
  mark,
  here,
  own = false,
  editing = false,
  onEdit,
}: {
  mark: Bookmark;
  here: string;
  own?: boolean;
  editing?: boolean;
  onEdit?: (open: boolean) => void;
}): ReactNode {
  return (
    <div className="mark pick" onClick={() => travelToMark(mark)}>
      <div className="mark-head">
        <span className="kind">{kindOf(mark)}</span> {mark.name}
        {mark.galaxy !== here && <span className="badge far">other galaxy</span>}
        {own && (
          <button
            className="unmark"
            title="remove this mark"
            onClick={(event) => {
              event.stopPropagation();
              removeSavedMark(bookmarkKey(mark));
            }}
          >
            ×
          </button>
        )}
      </div>
      {own && editing ? (
        <div className="mark-note">
          <NoteEdit mark={mark} onDone={() => onEdit?.(false)} />
        </div>
      ) : own ? (
        <div
          className="mark-note editable"
          title="click to edit the note"
          onClick={(event) => {
            event.stopPropagation();
            onEdit?.(true);
          }}
        >
          {mark.caption || <span className="note-hint">add a note</span>}
        </div>
      ) : (
        <div className="mark-note">{mark.caption}</div>
      )}
    </div>
  );
}

/** Swap the note for an input in place: Enter or blur keeps, Escape doesn't. */
function NoteEdit({ mark, onDone }: { mark: Bookmark; onDone: () => void }): ReactNode {
  const settled = useRef(false);
  const finish = (keep: boolean, value: string): void => {
    if (settled.current) return;
    settled.current = true;
    if (keep) saveCaption(bookmarkKey(mark), value.trim());
    onDone();
  };
  return (
    <input
      type="text"
      className="note-edit"
      maxLength={160}
      defaultValue={mark.caption}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(true, event.currentTarget.value);
        else if (event.key === 'Escape') finish(false, '');
      }}
      onBlur={(event) => finish(true, event.currentTarget.value)}
    />
  );
}

function kindOf(mark: Bookmark): string {
  if (mark.view !== 'planet') return mark.view;
  return mark.moon !== undefined ? 'moon' : 'planet';
}
