import type { MolecularCloud } from './clouds';
import type { Nebula } from './nebula';
import { planNebulaPair } from './nebulaPair';
import { nebulaPhotonSources } from './nebulaVolume';
import { NEBULA_FAINT_SOURCE_FRACTION } from './multiplePhotonTransport';

/** Admission estimate for live typed arrays, not a browser RSS limit.
 * GPU staging/readback and persistent geometry caches are budgeted separately.
 * Assume every cell contains gas: sparse source weights can only cost less.
 * Keep both domains' gas arrays in the estimate across the nested handoff.
 * Unreachable allocations awaiting GC and driver overhead are not measurable here. */
export function nebulaBakeWorkingBytes(cloud: MolecularCloud, nebula: Nebula | null, size: number): number {
  return nebulaBakeMemory(cloud, nebula, size).workingBytes;
}

export function nebulaBakeMemory(cloud: MolecularCloud, nebula: Nebula | null, size: number): { workingBytes: number; domains: number } {
  const plan = planNebulaPair(cloud, nebula, size);
  const sources = nebulaPhotonSources(plan.fine ?? plan.coarse);
  const rates = sources.map(s => s.photonRate).sort((a, b) => b - a);
  const budget = rates.reduce((sum, q) => sum + q, 0) * NEBULA_FAINT_SOURCE_FRACTION;
  let coupled = rates.length, faint = 0;
  while (coupled > 1 && faint + rates[coupled - 1] <= budget) faint += rates[--coupled];
  const cells = size ** 3, domains = plan.fine ? 2 : 1;
  // Five Float32 fields, Float64 remap/export and RGBA8 result per domain.
  const fields = cells * domains * (20 + 8 + 4);
  // Indices, active cells, totals, previous iterate, reusable incoming flux,
  // and one weight per coupled source. Single-source transport only needs flux.
  const transport = cells * (coupled > 1 ? 28 + 4 * coupled : 8);
  const tail = coupled < rates.length ? cells * 8 : 0;
  const boundaries = plan.fine ? 6 * plan.coarse.inventoryExclusion!.span ** 2 * 8 * (sources.length + 1) : 0;
  // Continuum/raw/packed fields, layered face geometry (<2.4 MiB at 160),
  // small source textures and bookkeeping. Resident uploads have a separate cap.
  return { workingBytes: fields + transport + tail + boundaries + 8 * 2 ** 20, domains };
}
