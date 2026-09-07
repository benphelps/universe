import { Fragment, useState, type ReactNode } from 'react';

export interface FinderEntry {
  key: string;
  glyph: ReactNode;
  title: string;
  /** A quieter second line under the title, with the row's whole
   *  width to itself, so it wraps rather than clips. */
  sub?: string;
  /** 0–100, drawn as the bar beside the label. */
  score: number;
  scoreLabel: string;
  detail: ReactNode;
}

export interface FinderGroup {
  label: string;
  entries: FinderEntry[];
}

/**
 * Survey results as one-line rows under sticky group heads. A row
 * opens in place to show its notes and its action and closes again;
 * one stands open at a time, so a full shortlist stays a screen or
 * two long instead of a corridor of cards.
 */
export function FinderList({ groups }: { groups: FinderGroup[] }): ReactNode {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="finder-list">
      {groups.map(group => (
        <Fragment key={group.label}>
          <div className="finder-group">
            {group.label}
            <i>{group.entries.length}</i>
          </div>
          {group.entries.map(entry => {
            const opened = open === entry.key;
            return (
              <Fragment key={entry.key}>
                <button
                  className={opened ? 'finder-row open' : 'finder-row'}
                  aria-expanded={opened}
                  onClick={() => setOpen(opened ? null : entry.key)}
                >
                  <span className="finder-glyph">{entry.glyph}</span>
                  <span className="finder-row-name">{entry.title}</span>
                  <span className="finder-score">
                    <span className="finder-bar"><i style={{ width: `${entry.score}%` }} /></span>
                    {entry.scoreLabel}
                  </span>
                  {entry.sub && <small className="finder-row-sub">{entry.sub}</small>}
                </button>
                {opened && <div className="finder-detail">{entry.detail}</div>}
              </Fragment>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
