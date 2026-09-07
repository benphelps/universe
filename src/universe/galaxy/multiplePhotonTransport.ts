import { cellEmissionWeight } from '../../core/physics/radiativeTransfer';
import { RECOMBINATION_SCALE } from './ionization';
import { transportPhotons, type PhotonGrid, type PhotonLedger } from './photonTransport';

export interface PhotonSource { sourceCell: [number, number, number]; photonRate: number }

/** Group only within the same transport cell; preserve Q and its
 * centroid. Sorting makes grouping independent of catalogue order. */
export function groupPhotonSources(sources: readonly PhotonSource[]): PhotonSource[] {
  const cells = new Map<string, PhotonSource>();
  const ordered = [...sources].filter(s => s.photonRate > 0).sort((a, b) =>
    a.sourceCell[0] - b.sourceCell[0] || a.sourceCell[1] - b.sourceCell[1] || a.sourceCell[2] - b.sourceCell[2] || a.photonRate - b.photonRate);
  for (const source of ordered) {
    const key = source.sourceCell.map(Math.floor).join(',');
    const prior = cells.get(key);
    if (!prior) { cells.set(key, { sourceCell: [...source.sourceCell], photonRate: source.photonRate }); continue; }
    const q = prior.photonRate + source.photonRate;
    for (let axis = 0; axis < 3; axis++) prior.sourceCell[axis] += (source.sourceCell[axis] - prior.sourceCell[axis]) * source.photonRate / q;
    prior.photonRate = q;
  }
  return [...cells.values()];
}

/** Synchronous source iteration for the static case-B filling model.
 * Each cell's recombination capacity is partitioned once among sources;
 * each source sees the entire dust column. New allocations use the
 * arriving radiation that can support recombination after dust losses.
 * Every iterate conserves photons and bounds emission by n_H². The
 * reported convergence measures redistribution, separately from closure.
 * This remains a Cartesian angular-mixing approximation, not C²-Ray. */
function iterateSources(
  grid: PhotonGrid, sources: readonly PhotonSource[],
  options: {
    maximumIterations?: number;
    tolerance?: number;
    solve?: (grid: PhotonGrid, source: number) => PhotonLedger;
  } = {},
): PhotonLedger {
  const solve = options.solve ?? transportPhotons;
  if (sources.length <= 1) {
    grid.ionized.fill(0); grid.hardness.fill(0);
    const source = sources[0] ?? { sourceCell: grid.sourceCell, photonRate: 0 };
    const capacityScale = RECOMBINATION_SCALE * grid.cellPc ** 3;
    return solve({ ...grid, ...source, onCell(at, _incoming, _depth, absorbedH, u) {
      grid.ionized[at] = Math.sqrt(absorbedH * source.photonRate / capacityScale);
      grid.hardness[at] = u;
    } }, 0);
  }
  const q = sources.reduce((sum, source) => sum + source.photonRate, 0);
  const cells = grid.size ** 3;
  // Only gas-bearing cells need a source allocation. The outward sweep
  // still crosses vacuum normally, using one reused full-grid workspace.
  const indices = new Int32Array(cells).fill(-1);
  let activeCount = 0;
  for (let i = 0; i < cells; i++) if (grid.hydrogen[i] > 0) indices[i] = activeCount++;
  const active = new Uint32Array(activeCount);
  for (let i = 0; i < cells; i++) if (indices[i] >= 0) active[indices[i]] = i;
  const weights = sources.map(() => new Float32Array(active.length));
  const totals = new Float64Array(active.length), previous = new Float32Array(active.length);
  const workspace = new Float64Array(cells);
  for (let c = 0; c < active.length; c++) {
    const at = active[c], x = at % grid.size + 0.5, y = Math.floor(at / grid.size) % grid.size + 0.5, z = Math.floor(at / grid.size ** 2) + 0.5;
    for (let s = 0; s < sources.length; s++) {
      const source = sources[s];
      weights[s][c] = source.photonRate / q / Math.max(0.25, (x - source.sourceCell[0]) ** 2 + (y - source.sourceCell[1]) ** 2 + (z - source.sourceCell[2]) ** 2);
    }
  }
  let result: PhotonLedger = { sourcePhotonsPerSecond: 0, injectedPhotonsPerSecond: 0,
    hydrogenAbsorptionsPerSecond: 0, dustAbsorptionsPerSecond: 0, boundaryPhotonsPerSecond: 0, relativeResidual: 0 };
  let change = Infinity, count = 0;
  const maximum = options.maximumIterations ?? 20, tolerance = options.tolerance ?? 0.002;
  const capacityScale = RECOMBINATION_SCALE * grid.cellPc ** 3;
  for (; count < maximum; count++) {
    totals.fill(0);
    for (const weight of weights) for (let c = 0; c < active.length; c++) totals[c] += weight[c];
    grid.ionized.fill(0); grid.hardness.fill(0);
    result = { sourcePhotonsPerSecond: 0, injectedPhotonsPerSecond: 0,
      hydrogenAbsorptionsPerSecond: 0, dustAbsorptionsPerSecond: 0, boundaryPhotonsPerSecond: 0, relativeResidual: 0 };
    sources.forEach((source, s) => {
      const weight = weights[s], qFraction = source.photonRate / q;
      const ledger = solve({ ...grid, ...source, workspace,
        capacityShare(at) { const c = indices[at]; return c < 0 ? 0 : totals[c] > 0 ? weight[c] / totals[c] : qFraction; },
        onCell(at, incoming, depth, absorbedH, u) {
          const c = indices[at];
          if (c < 0) return;
          weight[c] = incoming * qFraction * Math.exp(-depth) / cellEmissionWeight(depth);
          grid.ionized[at] += absorbedH * source.photonRate / capacityScale;
          grid.hardness[at] += u;
        },
      }, s);
      result.sourcePhotonsPerSecond += ledger.sourcePhotonsPerSecond;
      result.injectedPhotonsPerSecond += ledger.injectedPhotonsPerSecond;
      result.hydrogenAbsorptionsPerSecond += ledger.hydrogenAbsorptionsPerSecond;
      result.dustAbsorptionsPerSecond += ledger.dustAbsorptionsPerSecond;
      result.boundaryPhotonsPerSecond += ledger.boundaryPhotonsPerSecond;
    });
    let delta = 0, total = 0;
    for (let c = 0; c < active.length; c++) {
      const at = active[c], measure = grid.ionized[at];
      delta += Math.abs(measure - previous[c]); total += measure; previous[c] = measure;
      grid.ionized[at] = Math.sqrt(Math.min(grid.hydrogen[at] ** 2, measure));

    }
    change = delta / (total || 1);
    if (count > 0 && change <= tolerance) { count++; break; }
  }
  const supplied = result.sourcePhotonsPerSecond + result.injectedPhotonsPerSecond;
  result.relativeResidual = supplied > 0 ? (supplied - result.hydrogenAbsorptionsPerSecond - result.dustAbsorptionsPerSecond - result.boundaryPhotonsPerSecond) / supplied : 0;
  result.iteration = { sources: sources.length, count, converged: change <= tolerance, relativeChange: change,
    workspaceBytes: indices.byteLength + active.byteLength + workspace.byteLength + totals.byteLength + previous.byteLength + weights.reduce((sum, w) => sum + w.byteLength, 0) };
  return result;
}


/** Maximum source-budget fraction treated as a faint, one-way update.
 * This bounds the omitted feedback's available photons, not spatial or
 * spectral error. Set faintSourceFraction=0 for a fully coupled check. */
export const NEBULA_FAINT_SOURCE_FRACTION = 0.001;

export function transportMultiplePhotons(
  grid: PhotonGrid, sources: readonly PhotonSource[],
  options: Parameters<typeof iterateSources>[2] & { faintSourceFraction?: number } = {},
): PhotonLedger {
  const solve = options.solve ?? transportPhotons;
  const q = sources.reduce((sum, source) => sum + source.photonRate, 0);
  // Canonical ordering makes the residual-capacity update reproducible.
  // No source moves or disappears; only the small tail's feedback onto
  // the converged dominant radiation field is omitted.
  const order = sources.map((source, index) => ({ source, index })).sort((a, b) =>
    b.source.photonRate - a.source.photonRate || a.source.sourceCell[0] - b.source.sourceCell[0]
    || a.source.sourceCell[1] - b.source.sourceCell[1] || a.source.sourceCell[2] - b.source.sourceCell[2]);
  let split = order.length, faintQ = 0;
  const budget = Math.max(0, Math.min(NEBULA_FAINT_SOURCE_FRACTION, options.faintSourceFraction ?? 0)) * q;
  while (split > 1 && faintQ + order[split - 1].source.photonRate <= budget) faintQ += order[--split].source.photonRate;
  const result = iterateSources(grid, order.slice(0, split).map(s => s.source), {
    ...options, solve(g, source) { return solve(g, order[source]?.index ?? 0); },
  });
  const workspace = split < order.length ? new Float64Array(grid.size ** 3) : undefined;
  const scale = RECOMBINATION_SCALE * grid.cellPc ** 3;
  for (let s = split; s < order.length; s++) {
    const { source, index } = order[s];
    const ledger = solve({ ...grid, ...source, workspace,
      capacityShare(at) { return grid.hydrogen[at] > 0 ? Math.max(0, 1 - (grid.ionized[at] / grid.hydrogen[at]) ** 2) : 0; },
      onCell(at, _incoming, _depth, h, u) {
        grid.ionized[at] = Math.sqrt(Math.min(grid.hydrogen[at] ** 2, grid.ionized[at] ** 2 + h * source.photonRate / scale));
        grid.hardness[at] += u;
      },
    }, index);
    result.sourcePhotonsPerSecond += ledger.sourcePhotonsPerSecond;
    result.injectedPhotonsPerSecond += ledger.injectedPhotonsPerSecond;
    result.hydrogenAbsorptionsPerSecond += ledger.hydrogenAbsorptionsPerSecond;
    result.dustAbsorptionsPerSecond += ledger.dustAbsorptionsPerSecond;
    result.boundaryPhotonsPerSecond += ledger.boundaryPhotonsPerSecond;
  }
  for (let at = 0; at < grid.hardness.length; at++) {
    const u = grid.hardness[at]; grid.hardness[at] = u > 0 ? Math.min(1, Math.max(0, (Math.log10(u) + 3.5) / 2)) : 0;
  }
  const supplied = result.sourcePhotonsPerSecond + result.injectedPhotonsPerSecond;
  result.relativeResidual = supplied > 0 ? (supplied - result.hydrogenAbsorptionsPerSecond - result.dustAbsorptionsPerSecond - result.boundaryPhotonsPerSecond) / supplied : 0;
  if (result.iteration || faintQ > 0) {
    result.iteration ??= { sources: split, count: 1, converged: true, relativeChange: 0, workspaceBytes: 0 };
    result.iteration.sources = sources.length;
    result.iteration.coupledSources = split;
    result.iteration.faintSourceFraction = q > 0 ? faintQ / q : 0;
    result.iteration.workspaceBytes = Math.max(result.iteration.workspaceBytes, workspace?.byteLength ?? 0);
  }
  return result;
}
