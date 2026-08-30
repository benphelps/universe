import { useRef, useState, type ReactNode } from 'react';
import { seedToHex } from '../../core/rng/hash';
import type { FlowRegime } from '../../universe/galaxy/accretionFlow';
import { galaxySeed } from '../../universe/galaxy/galaxySeed';
import { galacticNucleus } from '../../universe/galaxy/nucleus';
import { bookmarkKey, savedMarks, type Bookmark } from '../bookmarks';
import { poiFolders, type GalaxyFolder } from '../poiFolders';
import { removeSavedMark, saveCaption, travelToGalaxy, travelToMark } from '../store';

/**
 * The POI tab: one folder per galaxy, each holding the marks saved
 * inside it. The galaxy is the folder because a mark cannot cross one
 * — the same system seed names a different star in every galaxy — so
 * the address book is grouped the way the universe is.
 *
 * Nothing ships in the folders. What ships is the folders themselves:
 * four galactic centres chosen across the two things that decide what
 * a hole looks like, and the traveler fills the rest.
 */
export function PoiLevel(): ReactNode {
  const here = seedToHex(galaxySeed());
  const folders = poiFolders(here, savedMarks());
  const [editingKey, setEditingKey] = useState<string | null>(null);

  return (
    <>
      <h2>Galaxies · {folders.length}</h2>
      {folders.map((folder) => (
        <Folder
          key={folder.galaxy}
          folder={folder}
          editingKey={editingKey}
          onEdit={setEditingKey}
        />
      ))}
    </>
  );
}

/** One galaxy, the hole at the middle of it, and what is marked inside. */
function Folder({
  folder,
  editingKey,
  onEdit,
}: {
  folder: GalaxyFolder;
  editingKey: string | null;
  onEdit: (key: string | null) => void;
}): ReactNode {
  return (
    <div className="folder">
      <div className="mark pick" onClick={() => travelToGalaxy(folder)}>
        <div className="mark-head">
          <span className="kind">core</span> {folder.name}
          {folder.here && <span className="badge here">you are here</span>}
        </div>
        <div className="mark-note figures">{figures(folder)}</div>
      </div>
      <div className="folder-marks">
        {folder.marks.map((mark) => {
          const key = bookmarkKey(mark);
          return (
            <MarkRow
              key={key}
              mark={mark}
              editing={editingKey === key}
              onEdit={(open) => onEdit(open ? key : null)}
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
  );
}

/** The flow in two words, for a row with no room for more. */
const FLOW_SHORT: Record<FlowRegime, string> = {
  'thin-disc': 'thin disc',
  riaf: 'hot torus',
};

/**
 * What the centre will look like, in one line: the shape of the flow,
 * how wide the hole is, how far its spin drags the shadow out of
 * round, and the temperature that sets its colour.
 *
 * The galaxy this session materialized answers for itself. Any other
 * cannot — the galaxy seed locks at first use, so its nucleus is
 * ungeneratable from here — and the catalogue answers instead. For a
 * galaxy the traveler reached on their own there is no answer to give
 * until they are standing in it again, and the row says so.
 */
function figures(folder: GalaxyFolder): string {
  const core = folder.here ? live() : folder.entry;
  if (!core) return 'centre unsurveyed';
  return [
    FLOW_SHORT[core.regime],
    `${solarMasses(core.massSolar)} M☉`,
    `a★ ${core.spin.toFixed(2)}`,
    `${kelvin(core.innerTemperatureK)} K`,
  ].join(' · ');
}

/**
 * Temperature always in exponent form, which fmt would not do — these
 * run from three thousand kelvin to a million and a half, and the
 * whole point of the row is comparing one folder against the next. A
 * column that switches notation halfway down cannot be scanned.
 */
function kelvin(value: number): string {
  return value.toExponential(1);
}

function live(): {
  regime: FlowRegime;
  massSolar: number;
  spin: number;
  innerTemperatureK: number;
} {
  const nucleus = galacticNucleus();
  return {
    regime: nucleus.flow.regime,
    massSolar: nucleus.massSolar,
    spin: nucleus.spin,
    innerTemperatureK: nucleus.flow.innerTemperatureK,
  };
}

/** Solar masses, in the units the eye reads fastest. */
function solarMasses(value: number): string {
  if (value >= 1e8) return `${(value / 1e6).toFixed(0)}M`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
  return value.toFixed(0);
}

function MarkRow({
  mark,
  editing,
  onEdit,
}: {
  mark: Bookmark;
  editing: boolean;
  onEdit: (open: boolean) => void;
}): ReactNode {
  return (
    <div className="mark pick" onClick={() => travelToMark(mark)}>
      <div className="mark-head">
        <span className="kind">{kindOf(mark)}</span> {mark.name}
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
      </div>
      {editing ? (
        <div className="mark-note">
          <NoteEdit mark={mark} onDone={() => onEdit(false)} />
        </div>
      ) : (
        <div
          className="mark-note editable"
          title="click to edit the note"
          onClick={(event) => {
            event.stopPropagation();
            onEdit(true);
          }}
        >
          {mark.caption || <span className="note-hint">add a note</span>}
        </div>
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
  if (mark.core) return 'core';
  if (mark.view !== 'planet') return mark.view;
  return mark.moon !== undefined ? 'moon' : 'planet';
}
