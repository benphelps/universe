import { useRef, useState, type ReactNode } from 'react';
import { seedToHex } from '../../core/rng/hash';
import { galaxySeed } from '../../universe/galaxy/galaxySeed';
import { SURVEY_MARKS, bookmarkKey, savedMarks, type Bookmark } from '../bookmarks';
import { removeSavedMark, saveCaption, travelToMark } from '../store';

/**
 * The POI tab: the survey's shipped highlights up top, the traveler's
 * own marks below — every row a travel link, marks made in another
 * galaxy carrying it along. The catalog plate above stays on the
 * current body; this tab is the address book, not a camera level.
 */
export function PoiLevel(): ReactNode {
  const here = seedToHex(galaxySeed());
  const saved = savedMarks();
  const [editingKey, setEditingKey] = useState<string | null>(null);

  return (
    <>
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
