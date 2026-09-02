import { dustScatterTable } from '../universe/galaxy/dustScattering';

/**
 * The multiple-scattering table solved off the frame thread: the
 * successive-orders sweep is tens of milliseconds, and the first
 * nebula volume of a session used to pay it as a hitch on arrival.
 */
self.onmessage = () => {
  const table = dustScatterTable();
  (self as unknown as Worker).postMessage(table, [table.buffer]);
};
