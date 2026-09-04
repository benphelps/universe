import type { ReactNode } from 'react';
import type { AppSnapshot } from '../store';
import { TimeControls } from './timeControls';

/**
 * The clock strip along the foot of the view: which of the focus's
 * clocks runs, and how long one turn takes on screen.
 */
export function ClockStrip({ snap }: { snap: AppSnapshot | null }): ReactNode {
  return (
    <div id="clock-strip">
      <section className="group">
        <TimeControls snap={snap} />
      </section>
    </div>
  );
}
