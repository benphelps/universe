import { useRef, useState, type ReactNode } from 'react';
import { seedToHex } from '../../core/rng/hash';
import { galaxySeed } from '../../universe/galaxy/galaxySeed';
import { bookmarkKey, savedMarks, type Bookmark } from '../bookmarks';
import { poiFolders } from '../poiFolders';
import { removeSavedMark, saveCaption, travelToMark } from '../store';
import { BodyRow, type BodyRowSpec } from './bodyRow';
import { galaxyRowSpec } from './universePanel';

/**
 * The marks tray: the marks saved, one folder per galaxy. The galaxy
 * is the folder because a mark cannot cross one — the same system
 * seed names a different star in every galaxy — so the address book
 * is grouped the way the universe is; a galaxy with nothing marked in
 * it has its row on the galaxy rung instead.
 *
 * Nothing here has a look of its own. A marked planet is the row that
 * planet has in the system list, and a galaxy is the row its centre
 * has in the galaxy list, because both ask the same BodyRow the rest
 * of the sidebar does.
 */
export function PoiLevel(): ReactNode {
  const here = seedToHex(galaxySeed());
  const folders = poiFolders(here, savedMarks()).filter(
    (folder) => folder.here || folder.marks.length > 0,
  );
  const [editingKey, setEditingKey] = useState<string | null>(null);

  return (
    <>
      {folders.map((folder) => (
        <div key={folder.galaxy} className="body-group">
          <BodyRow spec={galaxyRowSpec(folder)} />
          <div className="body-group-marks">
            {folder.marks.map((mark) => {
              const key = bookmarkKey(mark);
              return (
                <BodyRow
                  key={key}
                  spec={markRowSpec(mark, {
                    editing: editingKey === key,
                    onEdit: (open) => setEditingKey(open ? key : null),
                  })}
                />
              );
            })}
            {folder.here && folder.marks.length === 0 && (
              <div className="empty">
                nothing marked here yet — the bookmark beside a body’s name saves it
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * A mark as the row its body had when it was saved.
 *
 * There is no branch here on whether the body can be reached. The row
 * was recorded at the moment the traveler marked it, from the body
 * itself, which is the only moment it could have been: a galaxy locks
 * at first use, so a world in another one can never be rebuilt from
 * here to be measured. A mark saved before the survey kept rows falls
 * back to what its address alone can say.
 */
function markRowSpec(
  mark: Bookmark,
  edit: { editing: boolean; onEdit: (open: boolean) => void },
): BodyRowSpec {
  const row = mark.row;
  return {
    color: row?.color,
    name: mark.name,
    kind: row?.kind ?? kindOf(mark),
    figures: row?.figures,
    badges: row?.badges,
    onClick: () => travelToMark(mark),
    note: edit.editing ? (
      <NoteEdit mark={mark} onDone={() => edit.onEdit(false)} />
    ) : (
      <span
        className="editable"
        title="click to edit the note"
        onClick={(event) => {
          event.stopPropagation();
          edit.onEdit(true);
        }}
      >
        {mark.caption || <span className="note-hint">add a note</span>}
      </span>
    ),
    action: (
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
    ),
  };
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

/** What a mark is, when its own row was never recorded. */
function kindOf(mark: Bookmark): string {
  if (mark.core) return 'core';
  if (mark.view !== 'planet') return mark.view;
  return mark.moon !== undefined ? 'moon' : 'planet';
}
