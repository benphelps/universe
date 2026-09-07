import { useState, type ReactNode } from 'react';

const FOLDS_KEY = 'level-folds';

/** The sections the traveler has folded or unfolded, by name. */
function folds(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(FOLDS_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

function remember(name: string, folded: boolean): void {
  try {
    localStorage.setItem(FOLDS_KEY, JSON.stringify({ ...folds(), [name]: folded }));
  } catch {
    // Fine: the fold lasts as long as the page.
  }
}

const CHEVRON = (
  <svg className="group-chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
    <path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

/**
 * A section of a level's list: the bar that names what follows and
 * how much of it there is, staying put while the rows scroll under
 * it, and folding them away on a press. A fold is remembered by the
 * section's name, so a list you never read stays out of the way; a
 * section can also start folded, for members that are not places to
 * go.
 */
export function LevelGroup({
  name,
  tally,
  folded = false,
  children,
}: {
  name: string;
  /** How much the section holds, after the name. */
  tally?: ReactNode;
  /** Start folded until the traveler unfolds it. */
  folded?: boolean;
  children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(() => !(folds()[name] ?? folded));
  return (
    <>
      <h2 className={open ? undefined : 'folded'}>
        <button
          aria-expanded={open}
          onClick={() => {
            remember(name, open);
            setOpen(!open);
          }}
        >
          <span>
            {name}
            {tally !== undefined && <> · {tally}</>}
          </span>
          {CHEVRON}
        </button>
      </h2>
      {open && children}
    </>
  );
}
