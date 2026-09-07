import { faceAngle, transportPhotons, type PhotonGrid, type PhotonLedger } from './photonTransport';

export interface NestedPhotonLedger {
  inner: PhotonLedger;
  outer: PhotonLedger;
  combined: PhotonLedger;
}

export type PhotonGeometry = Pick<PhotonGrid, 'size' | 'cellPc' | 'sourceCell' | 'photonRate'>;

export interface NestedPhotonTransfer {
  geometry: PhotonGeometry;
  minimum: [number, number, number];
  span: number;
  /** Six coarse face planes, in fractions of the shared source Q. */
  faceFractions: Float64Array;
  directBoundaryFraction: number;
  inner: PhotonLedger;
}

/** Solve the inner grid and retain only its boundary radiation. The
 * handoff is O(N²), so the inner gas arrays can be released before the
 * outer gas arrays are allocated. Fractional refinement splits fine
 * face flux by each overlap's solid angle. Angular mixing within the
 * transport cells remains an approximation. */
export function prepareNestedPhotonTransfer(
  outer: PhotonGeometry,
  inner: PhotonGrid,
  minimum: [number, number, number],
): NestedPhotonTransfer {
  const refinement = outer.cellPc / inner.cellPc;
  const span = inner.size / refinement;
  if (refinement < 1
    || Math.abs(span - Math.round(span)) > 1e-9
    || minimum.some(v => !Number.isInteger(v) || v < 0 || v + span > outer.size + 1e-9)
    || inner.sourceCell.some(s => s <= 0 || s >= inner.size)
    || inner.sourceCell.some((s, axis) => Math.abs(minimum[axis] + s / refinement - outer.sourceCell[axis]) > 1e-9)
    || inner.photonRate !== outer.photonRate) {
    throw new Error('nested photon grids must align, share a source, and enclose it strictly inside the inner grid');
  }
  const covered = Math.round(span);
  const faceFractions = new Float64Array(6 * covered ** 2);
  let directBoundaryFraction = 0;
  const innerLedger = transportPhotons({ ...inner, onBoundary(face, i, j, k, fraction) {
    const axis = Math.floor(face / 2);
    const coordinate = minimum[axis] + (face % 2 === 0 ? -1 : covered);
    if (coordinate < 0 || coordinate >= outer.size) {
      directBoundaryFraction += fraction;
      return;
    }
    const uAxis = axis === 0 ? 1 : 0, vAxis = axis === 2 ? 1 : 2;
    const uCell = uAxis === 0 ? i : j, vCell = vAxis === 1 ? j : k;
    const lowU = minimum[uAxis] + uCell / refinement, highU = minimum[uAxis] + (uCell + 1) / refinement;
    const lowV = minimum[vAxis] + vCell / refinement, highV = minimum[vAxis] + (vCell + 1) / refinement;
    const u0 = Math.floor(lowU + 1e-10), u1 = Math.ceil(highU - 1e-10);
    const v0 = Math.floor(lowV + 1e-10), v1 = Math.ceil(highV - 1e-10);
    // Most fine faces fit inside one coarse face. Its overlap weight is
    // exactly one: no angular subdivision or temporary patch list needed.
    if (u1 === u0 + 1 && v1 === v0 + 1) {
      faceFractions[(face * covered + v0 - minimum[vAxis]) * covered + u0 - minimum[uAxis]] += fraction;
      return;
    }
    const plane = minimum[axis] + (face % 2 === 0 ? 0 : covered);
    const distance = Math.abs(plane - outer.sourceCell[axis]);
    const patches: { at: number; angle: number }[] = [];
    let totalAngle = 0;
    for (let v = v0; v < v1; v++) {
      for (let u = u0; u < u1; u++) {
        const angle = faceAngle(distance,
          Math.max(lowU, u) - outer.sourceCell[uAxis], Math.min(highU, u + 1) - outer.sourceCell[uAxis],
          Math.max(lowV, v) - outer.sourceCell[vAxis], Math.min(highV, v + 1) - outer.sourceCell[vAxis]);
        patches.push({ at: (face * covered + v - minimum[vAxis]) * covered + u - minimum[uAxis], angle });
        totalAngle += angle;
      }
    }
    for (const patch of patches) faceFractions[patch.at] += fraction * patch.angle / totalAngle;
  } });
  return { geometry: { size: outer.size, cellPc: outer.cellPc,
    sourceCell: [...outer.sourceCell], photonRate: outer.photonRate },
    minimum: [...minimum], span: covered, faceFractions, directBoundaryFraction, inner: innerLedger };
}

/** The outer domain receives the transferred photons without emitting
 * a second source. Covered coarse cells receive no incoming radiation. */
export function finishNestedPhotonTransfer(outer: PhotonGrid, transfer: NestedPhotonTransfer): NestedPhotonLedger {
  const { geometry, minimum, span, faceFractions, directBoundaryFraction, inner: innerLedger } = transfer;
  if (outer.size !== geometry.size || outer.cellPc !== geometry.cellPc || outer.photonRate !== geometry.photonRate
    || outer.sourceCell.some((s, axis) => s !== geometry.sourceCell[axis])) {
    throw new Error('outer grid does not match its photon handoff');
  }
  const incoming = outer.workspace ?? new Float64Array(outer.size ** 3);
  incoming.fill(0);
  for (let face = 0; face < 6; face++) {
    const axis = Math.floor(face / 2);
    const coordinate = minimum[axis] + (face % 2 === 0 ? -1 : span);
    if (coordinate < 0 || coordinate >= outer.size) continue;
    const axes = [0, 1, 2].filter(a => a !== axis);
    const cell = [0, 0, 0]; cell[axis] = coordinate;
    for (let v = 0; v < span; v++) for (let u = 0; u < span; u++) {
      cell[axes[0]] = minimum[axes[0]] + u;
      cell[axes[1]] = minimum[axes[1]] + v;
      incoming[(cell[2] * outer.size + cell[1]) * outer.size + cell[0]] += faceFractions[(face * span + v) * span + u];
    }
  }
  const outerLedger = transportPhotons({ ...outer, emitSource: false, incomingFractions: incoming });
  const q = geometry.photonRate;
  const hydrogen = innerLedger.hydrogenAbsorptionsPerSecond + outerLedger.hydrogenAbsorptionsPerSecond;
  const dust = innerLedger.dustAbsorptionsPerSecond + outerLedger.dustAbsorptionsPerSecond;
  const boundary = directBoundaryFraction * q + outerLedger.boundaryPhotonsPerSecond;
  return { inner: innerLedger, outer: outerLedger, combined: {
    sourcePhotonsPerSecond: q, injectedPhotonsPerSecond: 0,
    hydrogenAbsorptionsPerSecond: hydrogen, dustAbsorptionsPerSecond: dust,
    boundaryPhotonsPerSecond: boundary,
    relativeResidual: q > 0 ? 1 - hydrogen / q - dust / q - boundary / q : 0,
  } };
}

/** Convenience entry point when both density grids already exist. */
export function transportNestedPhotons(
  outer: PhotonGrid, inner: PhotonGrid, minimum: [number, number, number],
): NestedPhotonLedger {
  return finishNestedPhotonTransfer(outer, prepareNestedPhotonTransfer(outer, inner, minimum));
}
