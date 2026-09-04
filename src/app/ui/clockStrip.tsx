import type { ReactNode } from 'react';
import type { AppSnapshot } from '../store';
import { TimeControls } from './timeControls';

/** The clock, along the foot of the view: pause, and the rate. */
export function ClockStrip({ snap }: { snap: AppSnapshot | null }): ReactNode {
  return (
    <div id="clock-strip">
      <TimeControls snap={snap} />
    </div>
  );
}
