import { centredPhotonAngles, faceAngle, LayeredPhotonGeometry } from './photonGeometry';
import { CM_PER_PC, CM_PER_S_LIGHT } from '../../core/physics/constants';
import { cellEmissionWeight } from '../../core/physics/radiativeTransfer';
import { RECOMBINATION_SCALE } from './ionization';
import { HYDROGEN_PER_DUST } from './gas';

/** Gray ionizing absorption cross section per H at solar dust abundance
 * (Draine 2011, arXiv:1003.0474). The stored dust already carries its
 * metallicity/depletion; visual extinction is not an EUV absorption
 * coefficient. Frequency-dependent dust and helium remain unresolved. */
export const IONIZING_DUST_OPACITY_PER_PC = 1e-21 * HYDROGEN_PER_DUST * CM_PER_PC;

export interface PhotonLedger {
  sourcePhotonsPerSecond: number;
  /** Radiation supplied by a nested grid, excluding the local source. */
  injectedPhotonsPerSecond: number;
  hydrogenAbsorptionsPerSecond: number;
  dustAbsorptionsPerSecond: number;
  /** Photons crossing this grid's boundary, not necessarily escaping its host cloud. */
  boundaryPhotonsPerSecond: number;
  relativeResidual: number;
  iteration?: { sources: number; coupledSources?: number; faintSourceFraction?: number; count: number; converged: boolean; relativeChange: number; workspaceBytes: number };
}

/** A uniform-density cell in case-B equilibrium. A sharp front fills
 * fraction f of the cell: recombinations = f α_B n² V. Dust competes
 * along that ionized path. This is a filling fraction, not a uniform
 * ionization fraction; the emission grid stores n sqrt(f).
 * All photon quantities can be divided by the same source Q. */
export function absorbPhotonCell(incoming: number, capacity: number, dustDepth: number): {
  outgoing: number; hydrogen: number; dust: number; filling: number;
} {
  if (incoming <= 0) return { outgoing: 0, hydrogen: 0, dust: 0, filling: 0 };
  const tau = Math.max(0, dustDepth);
  const fullOutgoing = incoming * Math.exp(-tau) - capacity * cellEmissionWeight(tau);
  let hydrogen: number;
  let outgoing: number;
  let filling: number;
  if (capacity > 0 && fullOutgoing <= 0) {
    filling = tau > 1e-8 ? Math.log1p(incoming * tau / capacity) / tau : incoming / capacity;
    filling = Math.min(1, Math.max(0, filling));
    hydrogen = Math.min(incoming, capacity * filling);
    outgoing = 0;
  } else {
    filling = 1;
    hydrogen = Math.min(capacity, incoming);
    outgoing = Math.max(0, fullOutgoing);
  }
  return { outgoing, hydrogen, dust: Math.max(0, incoming - outgoing - hydrogen), filling };
}

export { faceAngle } from './photonGeometry';

export interface PhotonGrid {
  size: number;
  cellPc: number;
  /** Source in grid coordinates: [0,size] spans the box faces. */
  sourceCell: [number, number, number];
  photonRate: number;
  hydrogen: Float32Array;
  dust: Float32Array;
  /** RMS ionized density, cm⁻³, so squaring preserves cell emission measure. */
  ionized: Float32Array;
  hardness: Float32Array;
  dustOpacityPerPc?: number;
  /** Disable the point source when continuing radiation from an inner grid. */
  emitSource?: boolean;
  /** Fractions of photonRate entering each cell; consumed as working storage. */
  incomingFractions?: Float64Array;
  /** Reusable zeroed transport workspace, distinct from boundary injection. */
  workspace?: Float64Array;
  /** A multiple-source solve assigns a disjoint share of each cell's
   * recombination capacity to this sweep. Dust is never partitioned. */
  capacityShare?: (index: number) => number;
  /** Observer replaces emission writes; incoming/H are fractions of Q. */
  onCell?: (index: number, incoming: number, dustDepth: number, hydrogen: number, ionizationParameter: number) => void;
  /** Outgoing face flux, in fractions of photonRate. Faces are -x,+x,-y,+y,-z,+z. */
  onBoundary?: (face: number, i: number, j: number, k: number, fraction: number) => void;
}

/** Conservative radial finite-volume transport on a Cartesian grid.
 * Each cell receives photons once from its inward faces and partitions
 * surviving photons among outward faces by their exact solid angles.
 * Acyclic octant sweeps preserve the budget even in optically thick
 * cells. Mixing within a cell numerically diffuses oblique shadows;
 * angular accuracy and gas dynamics require separate convergence tests.
 * One source, static gas, case B at 10⁴ K, gray dust absorption. */
export function transportPhotons(grid: PhotonGrid): PhotonLedger {
  const { size, cellPc, sourceCell, photonRate, hydrogen, dust, ionized, hardness } = grid;
  if (sourceCell.some(s => s < 0 || s > size)) throw new Error('photon source lies outside the transport grid');
  if (!grid.onCell) { ionized.fill(0); hardness.fill(0); }
  if (photonRate <= 0) return {
    sourcePhotonsPerSecond: 0, injectedPhotonsPerSecond: 0, hydrogenAbsorptionsPerSecond: 0,
    dustAbsorptionsPerSecond: 0, boundaryPhotonsPerSecond: 0, relativeResidual: 0,
  };
  // Fractions of Q keep intermediates well scaled. Double precision
  // prevents loss in long chains of nearly transparent cells.
  const incoming = grid.incomingFractions ?? grid.workspace ?? new Float64Array(size ** 3);
  if (incoming.length !== size ** 3) throw new Error('invalid photon injection grid');
  if (!grid.incomingFractions) incoming.fill(0);
  let injected = 0;
  if (grid.incomingFractions) for (let at = 0; at < incoming.length; at++) injected += incoming[at];
  const sourceFraction = grid.emitSource === false ? 0 : 1;
  if (sourceFraction + injected === 0) {
    // An ionization-bounded fine grid sends no light to the outer one.
    // Clear source allocations without sorting axes or walking faces.
    if (grid.onCell) for (let at = 0; at < hydrogen.length; at++) if (hydrogen[at] > 0) grid.onCell(at, 0, 0, 0, 0);
    return { sourcePhotonsPerSecond: 0, injectedPhotonsPerSecond: 0, hydrogenAbsorptionsPerSecond: 0,
      dustAbsorptionsPerSecond: 0, boundaryPhotonsPerSecond: 0, relativeResidual: 0 };
  }
  const order = sourceCell.map(s => Array.from({ length: size }, (_, i) => i)
    .sort((a, b) => Math.abs(a + 0.5 - s) - Math.abs(b + 0.5 - s)));
  const centred = sourceCell.every(p => p - Math.floor(p) === 0.5);
  const layered = centred ? null : new LayeredPhotonGeometry(size, sourceCell);
  const sx = Math.floor(sourceCell[0]), sy = Math.floor(sourceCell[1]), sz = Math.floor(sourceCell[2]);
  const faceAngles = new Float64Array(6);
  const capacityScale = RECOMBINATION_SCALE * cellPc ** 3 / photonRate;
  const opacity = grid.dustOpacityPerPc ?? IONIZING_DUST_OPACITY_PER_PC;
  const fluxScale = photonRate / (CM_PER_S_LIGHT * (cellPc * CM_PER_PC) ** 2);
  const offsets = [-1, 1, -size, size, -size * size, size * size];
  let absorbedH = 0;
  let absorbedDust = 0;
  // A source exactly on an exterior face/edge/corner emits the
  // complementary half/three-quarters/seven-eighths straight outside.
  let boundary = sourceFraction * (1 - sourceCell.reduce((fraction, s) => fraction * (s === 0 || s === size ? 0.5 : 1), 1));
  const sourceLowX = Math.ceil(sourceCell[0]) - 1, sourceHighX = Math.floor(sourceCell[0]);
  for (let zk = 0; zk < size; zk++) {
    const k = order[2][zk], z0 = k - sourceCell[2], z1 = z0 + 1;
    if (layered?.compatible) layered.setLayer(k);
    for (let yj = 0; yj < size; yj++) {
      const j = order[1][yj], row = (k * size + j) * size;
      const y0 = j - sourceCell[1], y1 = y0 + 1;
      const sourceRow = y0 <= 0 && y1 >= 0 && z0 <= 0 && z1 >= 0;
      for (let xi = 0; xi < size; xi++) {
        const i = order[0][xi], at = row + i;
        const containsSource = sourceRow && i >= sourceLowX && i <= sourceHighX;
        if (incoming[at] === 0 && !(containsSource && sourceFraction)) {
          grid.onCell?.(at, 0, 0, 0, 0);
          continue;
        }
        const x0 = i - sourceCell[0], x1 = x0 + 1;
        const angles = faceAngles;
        if (centred) centredPhotonAngles(size, i - sx, j - sy, k - sz, angles);
        else if (layered?.compatible) layered.angles(i, j, angles);
        else {
          angles[0] = faceAngle(-x0, y0, y1, z0, z1); angles[1] = faceAngle(x1, y0, y1, z0, z1);
          angles[2] = faceAngle(-y0, x0, x1, z0, z1); angles[3] = faceAngle(y1, x0, x1, z0, z1);
          angles[4] = faceAngle(-z0, x0, x1, y0, y1); angles[5] = faceAngle(z1, x0, x1, y0, y1);
        }
        // Preserve summation order without invoking a typed-array callback
        // six times for every illuminated cell of every source iteration.
        const solidAngle = angles[0] + angles[1] + angles[2] + angles[3] + angles[4] + angles[5];
        const photons = incoming[at] + (containsSource ? sourceFraction * solidAngle / (4 * Math.PI) : 0);
        let outgoing: number;
        if (hydrogen[at] === 0 && dust[at] === 0) {
          // Vacuum still transports the same directional face flux, but
          // has no absorption, emission or ionization parameter to solve.
          outgoing = Math.max(0, photons);
          grid.onCell?.(at, photons, 0, 0, 0);
        } else {
          const r2 = Math.max(0.25, (x0 + 0.5) ** 2 + (y0 + 0.5) ** 2 + (z0 + 0.5) ** 2);
          // Volume / projected face area gives the cell's mean chord. The
          // point-source cell uses a finite representative radius; its dust
          // path error shrinks with cell size.
          const pathPc = cellPc / (r2 * solidAngle);
          const share = grid.capacityShare?.(at) ?? 1;
          const depth = dust[at] * opacity * pathPc;
          const result = absorbPhotonCell(photons, hydrogen[at] ** 2 * capacityScale * share, depth);
          const u = hydrogen[at] > 0 ? fluxScale * 0.5 * (photons + result.outgoing) / (solidAngle * r2 * hydrogen[at]) : 0;
          if (grid.onCell) grid.onCell(at, photons, depth, result.hydrogen, u);
          else {
            ionized[at] = hydrogen[at] * Math.sqrt(result.filling * share);
            hardness[at] = u > 0 ? Math.min(1, Math.max(0, (Math.log10(u) + 3.5) / 2)) : 0;
          }
          absorbedH += result.hydrogen;
          absorbedDust += result.dust;
          outgoing = result.outgoing;
        }
        if (outgoing === 0) continue;
        for (let face = 0; face < 6; face++) {
          const share = outgoing * angles[face] / solidAngle;
          if (share === 0) continue;
          const coordinate = face < 2 ? i : face < 4 ? j : k;
          if (coordinate === (face % 2 === 0 ? 0 : size - 1)) {
            boundary += share;
            grid.onBoundary?.(face, i, j, k, share);
          }
          else incoming[at + offsets[face]] += share;
        }
      }
    }
  }
  return {
    sourcePhotonsPerSecond: sourceFraction * photonRate,
    injectedPhotonsPerSecond: injected * photonRate,
    hydrogenAbsorptionsPerSecond: absorbedH * photonRate,
    dustAbsorptionsPerSecond: absorbedDust * photonRate,
    boundaryPhotonsPerSecond: boundary * photonRate,
    relativeResidual: (sourceFraction + injected - absorbedH - absorbedDust - boundary) / (sourceFraction + injected || 1),
  };
}
