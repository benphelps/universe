import { CM_PER_PC, PROTON_MASS, SOLAR_MASS } from '../../core/physics/constants';
import { MASS_PER_HYDROGEN } from './gas';
import type { GasRemapLedger } from './gasRemap';

export interface NebulaGasInventory {
  /** Integrals over the same cells; includes helium at the model's fixed H/He ratio. */
  natalMassSolar: number;
  prescribedMassSolar: number;
  netChangeMassSolar: number;
  relativeChange: number | null;
  /** Signed inflow minus outflow; null for historical prescribed fields. */
  boundaryExchangeMassSolar: number | null;
  transport?: { incomingMassSolar: number; outgoingMassSolar: number; relativeResidual: number };
}

export interface GasInventoryExclusion {
  minimum: [number, number, number];
  span: number;
}

export function combineGasInventories(a: NebulaGasInventory, b: NebulaGasInventory): NebulaGasInventory {
  const result = inventory(a.natalMassSolar + b.natalMassSolar, a.prescribedMassSolar + b.prescribedMassSolar);
  if (a.transport && b.transport) {
    // The outer import comes from the inner export. Their internal
    // exchange cancels; no gas is injected from outside the whole box.
    const exchange = a.boundaryExchangeMassSolar! + b.boundaryExchangeMassSolar!;
    result.boundaryExchangeMassSolar = exchange;
    result.transport = { incomingMassSolar: Math.max(0, exchange), outgoingMassSolar: Math.max(0, -exchange),
      relativeResidual: (result.natalMassSolar + exchange - result.prescribedMassSolar) / (result.natalMassSolar || 1) };
  }
  return result;
}

export function remappedGasInventory(ledger: GasRemapLedger): NebulaGasInventory {
  const scale = CM_PER_PC ** 3 * MASS_PER_HYDROGEN * PROTON_MASS / SOLAR_MASS;
  return { ...inventory(ledger.natal * scale, ledger.retained * scale),
    boundaryExchangeMassSolar: (ledger.incoming - ledger.outgoing) * scale,
    transport: { incomingMassSolar: ledger.incoming * scale, outgoingMassSolar: ledger.outgoing * scale, relativeResidual: ledger.relativeResidual } };
}

function inventory(natal: number, prescribed: number): NebulaGasInventory {
  return { natalMassSolar: natal, prescribedMassSolar: prescribed,
    netChangeMassSolar: prescribed - natal, relativeChange: natal > 0 ? prescribed / natal - 1 : null,
    boundaryExchangeMassSolar: null };
}

/** Accumulate while a backend already visits the gas cells. No extra
 * 3D array or second evaluation of the natal noise field is needed.
 * A coarse member excludes cells replaced by its fine partner. */
export class NebulaGasAccumulator {
  private natal = 0;
  private prescribed = 0;
  constructor(private readonly cellPc: number, private readonly exclusion?: GasInventoryExclusion) {}

  add(i: number, j: number, k: number, natal: number, prescribed: number): void {
    const e = this.exclusion;
    if (e && i >= e.minimum[0] && i < e.minimum[0] + e.span
      && j >= e.minimum[1] && j < e.minimum[1] + e.span
      && k >= e.minimum[2] && k < e.minimum[2] + e.span) return;
    this.natal += natal;
    this.prescribed += prescribed;
  }

  finish(): NebulaGasInventory {
    const scale = (this.cellPc * CM_PER_PC) ** 3 * MASS_PER_HYDROGEN * PROTON_MASS / SOLAR_MASS;
    return inventory(this.natal * scale, this.prescribed * scale);
  }
}
