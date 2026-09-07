import type { ReactNode } from 'react';
import { fmt } from './format';
import { kelvinTooltip } from './temperature';

/** Keep Kelvin on the panel, with familiar scales and existing context on hover. */
export function Temperature({ kelvin, maximumK, difference = false, digits = 3, note, children }: {
  kelvin: number;
  maximumK?: number;
  difference?: boolean;
  digits?: number;
  note?: string;
  children?: ReactNode;
}): ReactNode {
  const title = [kelvinTooltip(kelvin, maximumK, difference), note].filter(Boolean).join('\n');
  return <span title={title || undefined}>
    {children ?? <>{fmt(kelvin, digits)}{maximumK === undefined ? '' : `–${fmt(maximumK, digits)}`} K</>}
  </span>;
}
