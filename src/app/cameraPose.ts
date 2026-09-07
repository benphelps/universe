/**
 * The camera as a link carries it: where it stands and where it
 * looks, in the focus body's own frame — km from the body's centre,
 * its spin axis up +Y — and whether it stands on the ground, where
 * the flight camera holds it clear of the terrain.
 */
export interface CameraPose {
  grounded: boolean;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  /** Where the orbit is anchored: the body's centre unless a pan moved it. */
  target: [number, number, number];
  headingRad: number;
  pitchRad: number;
}

/** A number at the precision the pose needs and no more: ten
 *  significant digits hold a millimetre at planetary radii. */
const sig = (value: number, digits: number): string => Number(value.toPrecision(digits)).toString();

/** The pose as one URL value: the regime, then the numbers, and the
 *  anchor only when a pan moved it off the body. */
export function encodePose(pose: CameraPose): string {
  const parts = [
    pose.grounded ? 'g' : 'o',
    ...pose.position.map(v => sig(v, 10)),
    ...pose.quaternion.map(v => sig(v, 6)),
    sig(pose.headingRad, 6),
    sig(pose.pitchRad, 6),
  ];
  if (pose.target.some(v => v !== 0)) parts.push(...pose.target.map(v => sig(v, 10)));
  return parts.join('_');
}

export function decodePose(value: string | null): CameraPose | null {
  if (!value) return null;
  const [mode, ...rest] = value.split('_');
  if ((mode !== 'g' && mode !== 'o') || (rest.length !== 9 && rest.length !== 12)) return null;
  const n = rest.map(Number);
  if (!n.every(Number.isFinite)) return null;
  const quaternion: [number, number, number, number] = [n[3], n[4], n[5], n[6]];
  if (Math.abs(Math.hypot(...quaternion) - 1) > 0.01) return null;
  return {
    grounded: mode === 'g',
    position: [n[0], n[1], n[2]],
    quaternion,
    target: rest.length === 12 ? [n[9], n[10], n[11]] : [0, 0, 0],
    headingRad: n[7],
    pitchRad: n[8],
  };
}

/** The clock as a link carries it: days, to well under a second. */
export const encodeDays = (days: number): string => Number(days.toFixed(8)).toString();

export function decodeDays(value: string | null): number | null {
  if (!value) return null;
  const days = Number(value);
  return Number.isFinite(days) ? days : null;
}
