import {
  BEAM_SR,
  DISPLAY_CEIL,
  DISPLAY_GAIN,
  DISPLAY_GAMMA,
  DISPLAY_PIVOT_LSUN_PC2,
} from '../universe/galaxy/displayLaw';

/**
 * The sky's shared photometric law as shader uniforms
 * (universe/galaxy/displayLaw): extended light shows as the marginal
 * display energy above the sky's own subtracted pedestal. Uniforms
 * rather than constants so the instrument — exposure, a display
 * mode — can change without re-baking a sky.
 */
export const TRANSFER_GLSL = /* glsl */ `
uniform float uGamma;
uniform float uGain;
uniform float uCeil;
uniform float uBeamPivot;
uniform float uPedestalBeam;
uniform float uPedestalDisplay;

float displayRadiance(float radiance) {
  return min(uCeil,
    uGain * pow(uPedestalBeam + max(radiance, 0.0) * uBeamPivot, uGamma) - uPedestalDisplay);
}
`;

/** The law's uniforms, one fresh set per material, seated at the
 *  camera transfer over the sky's own measured pedestal. */
export function transferUniforms(pedestalRadiance: number): Record<string, { value: number }> {
  const beamPivot = (4 * Math.PI * BEAM_SR) / DISPLAY_PIVOT_LSUN_PC2;
  const pedestalBeam = pedestalRadiance * beamPivot;
  return {
    uGamma: { value: DISPLAY_GAMMA },
    uGain: { value: DISPLAY_GAIN },
    uCeil: { value: DISPLAY_CEIL },
    uBeamPivot: { value: beamPivot },
    uPedestalBeam: { value: pedestalBeam },
    uPedestalDisplay: { value: DISPLAY_GAIN * pedestalBeam ** DISPLAY_GAMMA },
  };
}
