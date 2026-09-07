import { hydrogenBetaLuminosity, RECOMBINATION_SCALE } from './ionization';
import type { PhotonLedger } from './photonTransport';

/** Rates inferred from the final density. A demand below Q alone is
 * not an escape fraction; transport supplies dust and domain-boundary
 * rates separately when a conservative solve has run. */
export interface NebulaPhotonAccounting {
  sourcePhotonsPerSecond: number;
  recombinationsPerSecond: number;
  encodedRecombinationsPerSecond: number;
  /** Null for an unlit cloud, where division by Q is undefined. */
  demandToSupply: number | null;
  /** Signed change in emission measure caused by byte quantization. */
  encodingRelativeError: number | null;
  hBetaErgPerSecond: number;
  /** One for a conservative bake. Without transport, reports the legacy
   * Q/encoded-demand diagnostic for comparison with earlier audits. */
  displayNormalization: number | null;
  /** Present when final gas has undergone conservative transport. */
  transport: PhotonLedger | null;
}

export function nebulaPhotonAccounting(
  sourcePhotonsPerSecond: number,
  emissionMeasurePc3: number,
  encodedEmissionMeasurePc3: number,
  transport?: PhotonLedger,
): NebulaPhotonAccounting {
  const recombinationsPerSecond = RECOMBINATION_SCALE * emissionMeasurePc3;
  const encodedRecombinationsPerSecond = RECOMBINATION_SCALE * encodedEmissionMeasurePc3;
  return {
    sourcePhotonsPerSecond,
    recombinationsPerSecond,
    encodedRecombinationsPerSecond,
    demandToSupply: sourcePhotonsPerSecond > 0 ? recombinationsPerSecond / sourcePhotonsPerSecond : null,
    encodingRelativeError: emissionMeasurePc3 > 0 ? encodedEmissionMeasurePc3 / emissionMeasurePc3 - 1 : null,
    hBetaErgPerSecond: hydrogenBetaLuminosity(recombinationsPerSecond),
    displayNormalization: encodedRecombinationsPerSecond > 0
      ? transport ? 1 : sourcePhotonsPerSecond / encodedRecombinationsPerSecond : null,
    transport: transport ?? null,
  };
}
