import { cloudReachPc, type MolecularCloud } from './clouds';
import type { Nebula } from './nebula';
import {
  evolveNebulaGas, attenuateNebulaContinuum, nebulaPhotonSources,
  bubbleNeedsOwnBake, finishNebulaBake, planNebulaBake, sampleNebulaCpu, solveNebulaIonization,
  type NebulaBakeFields, type NebulaBakePlan, type NebulaVolumeBake,
} from './nebulaVolume';
import { prepareNestedPhotonTransfer, finishNestedPhotonTransfer, type PhotonGeometry, type NestedPhotonTransfer } from './nestedPhotonTransport';
import { NEBULA_FAINT_SOURCE_FRACTION, transportMultiplePhotons } from './multiplePhotonTransport';
import { combineGasInventories } from './nebulaGasInventory';
import { depositGas, type GasGrid } from './gasRemap';

export interface NebulaVolumePair {
  coarse: NebulaVolumeBake;
  fine: NebulaVolumeBake | null;
}

export function planNebulaPair(cloud: MolecularCloud, nebula: Nebula | null, size: number): {
  coarse: NebulaBakePlan;
  fine: NebulaBakePlan | null;
  minimum: [number, number, number];
} {
  const reach = cloudReachPc(cloud);
  const coarse = planNebulaBake(cloud, nebula, size, reach);
  const minimum: [number, number, number] = [0, 0, 0];
  if (!nebula || !bubbleNeedsOwnBake(nebula, reach)) return { coarse, fine: null, minimum };
  const fine = planNebulaBake(cloud, nebula, size);
  const source = coarse.ionizePc.map(v => (v + coarse.boxPc) / coarse.cellPc);
  // A strict interior source lets every outward photon cross a resolved
  // fine face. A boundary source uses the existing single-domain path.
  if (source.some(v => v <= 0 || v >= size)) return { coarse, fine: null, minimum };
  const wanted = Math.max(2, Math.ceil(2 * fine.boxPc / coarse.cellPc));
  const span = wanted;
  if (span >= size) return { coarse, fine: null, minimum };
  for (let axis = 0; axis < 3; axis++) {
    minimum[axis] = Math.max(0, Math.min(size - span, Math.round(source[axis] - span / 2)));
    const origin = coarse.originPc[axis] - coarse.boxPc + (minimum[axis] + span / 2) * coarse.cellPc;
    const shift = fine.originPc[axis] - origin;
    fine.ionizePc[axis] += shift;
    fine.scatterSourcePc[axis] += shift;
    fine.originPc[axis] = origin;
  }
  fine.boxPc = span * coarse.cellPc / 2;
  fine.cellPc = 2 * fine.boxPc / size;
  if (nebulaPhotonSources(fine).some(s => s.sourceCell.some(p => p <= 0 || p >= size))
    || fine.continuumSources?.some(s => s.positionPc.some((p, axis) => Math.abs(p - fine.originPc[axis]) >= fine.boxPc))) {
    return { coarse, fine: null, minimum };
  }
  coarse.inventoryExclusion = { minimum, span };
  return { coarse, fine, minimum };
}

function photonGeometry(plan: NebulaBakePlan): PhotonGeometry {
  return { size: plan.size, cellPc: plan.cellPc, photonRate: plan.photonRate,
    sourceCell: plan.ionizePc.map(v => (v + plan.boxPc) / plan.cellPc) as [number, number, number] };
}

/** A matched pair is one job and one cache/display transaction. Both
 * backends sample natal gas and attenuate continuum; shared remapping
 * conserves material and the shared ionizing solve spends Q once. */
export function bakeNebulaPair(
  cloud: MolecularCloud, nebula: Nebula | null, size: number,
  sample: (plan: NebulaBakePlan) => NebulaBakeFields = sampleNebulaCpu,
  attenuate: (plan: NebulaBakePlan, fields: NebulaBakeFields) => void = attenuateNebulaContinuum,
): NebulaVolumePair {
  const plan = planNebulaPair(cloud, nebula, size);
  if (!plan.fine) {
    const fields = evolveNebulaGas(plan.coarse, sample(plan.coarse));
    attenuate(plan.coarse, fields);
    solveNebulaIonization(plan.coarse, fields);
    return { coarse: finishNebulaBake(plan.coarse, fields), fine: null };
  }
  const fineSources = nebulaPhotonSources(plan.fine);
  // Keep identical source groups across the interface. Coarse cells may
  // resolve less, but cannot relabel an already transported fine beam.
  const refinement = plan.coarse.cellPc / plan.fine.cellPc;
  const coarseSources = fineSources.map(s => ({ photonRate: s.photonRate,
    sourceCell: s.sourceCell.map((p, axis) => plan.minimum[axis] + p / refinement) as [number, number, number] }));
  // Keep the inner work in its own scope. Its encoded bake, six photon
  // boundary planes and any exported gas survive into the outer stage.
  let gasTransfer: Float64Array | undefined;
  const outerGrid: GasGrid = { size, cellPc: plan.coarse.cellPc, originPc: plan.coarse.originPc,
    hydrogen: new Float32Array(), exclusion: plan.coarse.inventoryExclusion };
  const inner = (() => {
    const fields = evolveNebulaGas(plan.fine!, sample(plan.fine!), { onOutgoing(x, y, z, mass) {
      if (Math.abs(x - outerGrid.originPc[0]) > plan.coarse.boxPc
        || Math.abs(y - outerGrid.originPc[1]) > plan.coarse.boxPc
        || Math.abs(z - outerGrid.originPc[2]) > plan.coarse.boxPc) return;
      gasTransfer ??= new Float64Array(size ** 3);
      if (!depositGas(gasTransfer, outerGrid, x, y, z, mass)) throw new Error('gas crossed into an invalid nested cell');
    } });
    attenuate(plan.fine!, fields);
    const transfers: NestedPhotonTransfer[] = [];
    fields.photonLedger = transportMultiplePhotons({ ...fields, ...photonGeometry(plan.fine!) }, fineSources, { faintSourceFraction: NEBULA_FAINT_SOURCE_FRACTION,
      solve(grid, source) {
        const transfer = prepareNestedPhotonTransfer({ ...photonGeometry(plan.coarse), ...coarseSources[source] }, grid, plan.minimum);
        transfers[source] = transfer;
        return transfer.inner;
      },
    });
    return { fine: finishNebulaBake(plan.fine!, fields), transfers };
  })();
  const coarseFields = evolveNebulaGas(plan.coarse, sample(plan.coarse), { incoming: gasTransfer });
  // Coarse shadow rays through the hidden region use the fine bake's
  // evolved dust, sampled at coarse centres, rather than natal gas.
  // This is a coarse continuum approximation; the ionizing solve still
  // uses the explicitly coupled fine-boundary photon rates.
  const span = plan.coarse.inventoryExclusion!.span;
  const fineCell = 2 * inner.fine.halfExtentsPc[0] / size;
  for (let k = plan.minimum[2]; k < plan.minimum[2] + span; k++) {
    for (let j = plan.minimum[1]; j < plan.minimum[1] + span; j++) {
      for (let i = plan.minimum[0]; i < plan.minimum[0] + span; i++) {
        const index = [i, j, k].map((v, axis) => Math.max(0, Math.min(size - 1, Math.floor(
          (plan.coarse.originPc[axis] - plan.coarse.boxPc + (v + 0.5) * plan.coarse.cellPc
            - inner.fine.originPc[axis] + inner.fine.halfExtentsPc[0]) / fineCell))));
        const dust = inner.fine.data[((index[2] * size + index[1]) * size + index[0]) * 4];
        coarseFields.dust[(k * size + j) * size + i] = (dust / 255) ** 2 * inner.fine.dustRef;
      }
    }
  }
  attenuate(plan.coarse, coarseFields);
  coarseFields.photonLedger = transportMultiplePhotons({ ...coarseFields, ...photonGeometry(plan.coarse) }, coarseSources, { faintSourceFraction: NEBULA_FAINT_SOURCE_FRACTION,
    solve(grid, source) { return finishNestedPhotonTransfer(grid, inner.transfers[source]).outer; },
  });
  const coarse = finishNebulaBake(plan.coarse, coarseFields);
  const inside = inner.fine.photonAccounting.transport!, outside = coarseFields.photonLedger;
  const q = inside.sourcePhotonsPerSecond;
  const hydrogen = inside.hydrogenAbsorptionsPerSecond + outside.hydrogenAbsorptionsPerSecond;
  const dust = inside.dustAbsorptionsPerSecond + outside.dustAbsorptionsPerSecond;
  const boundary = outside.boundaryPhotonsPerSecond + inner.transfers.reduce((sum, transfer) => sum + transfer.directBoundaryFraction * transfer.geometry.photonRate, 0);
  coarse.compositePhotonLedger = { sourcePhotonsPerSecond: q, injectedPhotonsPerSecond: 0,
    hydrogenAbsorptionsPerSecond: hydrogen, dustAbsorptionsPerSecond: dust, boundaryPhotonsPerSecond: boundary,
    relativeResidual: q > 0 ? (q - hydrogen - dust - boundary) / q : 0 };
  if (coarse.gasInventory && inner.fine.gasInventory) {
    coarse.compositeGasInventory = combineGasInventories(coarse.gasInventory, inner.fine.gasInventory);
  }
  return { coarse, fine: inner.fine };
}
