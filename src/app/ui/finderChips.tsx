import type { ReactNode } from 'react';

export interface FinderChip<K extends string> {
  key: K;
  label: string;
  count: number;
}

/** The kinds a shortlist holds, with counts. One chip narrows the list
 *  to its kind; pressing it again, or All, shows the whole list. */
export function FinderChips<K extends string>({
  chips,
  value,
  onChange,
}: {
  chips: FinderChip<K>[];
  value: K | null;
  onChange: (value: K | null) => void;
}): ReactNode {
  const chip = (key: K | null, label: string, count: number): ReactNode => (
    <button
      key={key ?? ''}
      className={value === key ? 'finder-chip on' : 'finder-chip'}
      aria-pressed={value === key}
      onClick={() => onChange(value === key ? null : key)}
    >
      {label}
      <i>{count}</i>
    </button>
  );
  return (
    <div className="finder-chips">
      {chip(null, 'All', chips.reduce((sum, c) => sum + c.count, 0))}
      {chips.map(c => chip(c.key, c.label, c.count))}
    </div>
  );
}
