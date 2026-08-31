import type { ReactNode } from 'react';

/** A measurement and the unit it is in; the unit is what lets a row be
 *  read without a column header above it. */
export type Figure = readonly [value: string, unit?: string];

export type BadgeTone = 'hz' | 'lock' | 'res' | 'bio' | 'here' | 'far';

export interface Badge {
  tone: BadgeTone;
  label: string;
}

export interface BodyRowSpec {
  /** The body's own colour: class for a planet, spectral for a star,
   *  the flow's temperature for a hole. Absent for a thing with none —
   *  a complex, a belt — which keeps the slot hollow so every name in
   *  every list still starts on the same pixel. */
  color?: string;
  name: string;
  /** What it is, in the body's own vocabulary: rocky, M3V, hot torus. */
  kind?: string;
  /** Two at the very most. The row has to survive a 390 px sidebar with
   *  its name whole, and everything past the second figure belongs on
   *  the plate, which is one click away and has room for all of it. */
  figures?: readonly Figure[];
  badges?: readonly Badge[];
  /** The row you are already standing at. */
  here?: boolean;
  /** A note the traveler wrote. The one thing that makes a row two
   *  lines, and only saved marks ever carry one. */
  note?: ReactNode;
  /** A trailing control — the × that unmarks a point of interest. */
  action?: ReactNode;
  onClick?: () => void;
  title?: string;
}

/**
 * One body, one row — the element every list in the sidebar is built
 * from.
 *
 * Each level used to write its own table, so the same planet arrived
 * one way in the system list and another in the points of interest,
 * and neither could be read without the header far above it. There is
 * one element now and the lists only decide what goes in its slots,
 * never their shape, their order, or where the name starts. A body
 * looks the same wherever it turns up, which is the whole of it.
 */
export function BodyRow({ spec }: { spec: BodyRowSpec }): ReactNode {
  const row = (
    <div
      className={`body-row${spec.here ? ' here' : ''}${spec.onClick ? ' pick' : ''}`}
      onClick={spec.onClick}
      onKeyDown={
        spec.onClick
          ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              spec.onClick?.();
            }
          : undefined
      }
      role={spec.onClick ? 'button' : undefined}
      tabIndex={spec.onClick ? 0 : undefined}
      title={spec.title}
    >
      <span className={`swatch${spec.color ? '' : ' hollow'}`} style={swatchStyle(spec.color)} />
      <span className="body-name">
        {spec.name}
        {spec.kind && <span className="kind">{spec.kind}</span>}
      </span>
      <span className="body-figs">
        {spec.figures?.map(([value, unit]) => (
          <span key={`${value}${unit ?? ''}`}>
            {value}
            {unit && <span className="u"> {unit}</span>}
          </span>
        ))}
        {spec.badges?.map((badge) => (
          <span key={badge.tone + badge.label} className={`badge ${badge.tone}`}>
            {badge.label}
          </span>
        ))}
        {spec.action}
      </span>
    </div>
  );
  if (!spec.note) return row;
  return (
    <div className="body-row-group">
      {row}
      <div className="body-note">{spec.note}</div>
    </div>
  );
}

function swatchStyle(color?: string): { background: string } | undefined {
  return color ? { background: color } : undefined;
}
