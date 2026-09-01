import {
  BEAM_SR,
  CAMERA_INSTRUMENT,
  type DisplayInstrument,
} from '../universe/galaxy/displayLaw';

/**
 * The sky's shared photometric law as shader uniforms
 * (universe/galaxy/displayLaw): extended light shows as the marginal
 * display energy above the sky's own subtracted pedestal, and colour
 * drains below the instrument's mesopic knee. Uniforms rather than
 * constants so the instrument — exposure, a display mode — can change
 * without re-baking a sky.
 */
export const TRANSFER_GLSL = /* glsl */ `
uniform float uGamma;
uniform float uGain;
uniform float uCeil;
uniform float uBeamPivot;
uniform float uPedestalBeam;
uniform float uPedestalDisplay;
uniform float uColorKnee;
uniform float uContinuumShare;

float displayRadiance(float radiance) {
  return min(uCeil,
    uGain * pow(uPedestalBeam + max(radiance, 0.0) * uBeamPivot, uGamma) - uPedestalDisplay);
}

// Rod vision: below the knee the light is real but the colour is not
// there to see — grey with the rods' blue-green cast, saturating over
// the two decades above the knee. A zero knee is full colour always.
vec3 scotopic(vec3 shown, float radiance) {
  if (uColorKnee <= 0.0) return shown;
  float sat = clamp(log2(max(radiance, 1e-7) / uColorKnee) * 0.1505, 0.0, 1.0);
  float lum = dot(shown, vec3(0.2126, 0.7152, 0.0722));
  return mix(lum * vec3(0.86, 1.02, 1.07), shown, sat);
}
`;

/** Seat an instrument on an extended-light material's uniforms.
 *  Exposure scales what a given physical brightness lands at — pivot
 *  and the mesopic knee both slide with it, so a longer exposure digs
 *  deeper and a darker adaptation sees colour later. */
export function seatExtendedInstrument(
  uniforms: Record<string, { value: unknown }>,
  pedestalRadiance: number,
  instrument: DisplayInstrument,
  exposure: number,
): void {
  const beamPivot = ((4 * Math.PI * BEAM_SR) / instrument.pivotLsunPc2) * exposure;
  const pedestalBeam = pedestalRadiance * beamPivot;
  uniforms.uGamma.value = instrument.gamma;
  uniforms.uGain.value = instrument.gain;
  uniforms.uCeil.value = instrument.ceil;
  uniforms.uBeamPivot.value = beamPivot;
  uniforms.uPedestalBeam.value = pedestalBeam;
  uniforms.uPedestalDisplay.value = instrument.gain * pedestalBeam ** instrument.gamma;
  uniforms.uColorKnee.value = instrument.colorKneeRadiance / exposure;
  uniforms.uContinuumShare.value = instrument.continuumShare;
}

/** The extended block at the camera transfer — a material's initial
 *  seating. */
export function transferUniforms(pedestalRadiance: number): Record<string, { value: number }> {
  const uniforms: Record<string, { value: number }> = {
    uGamma: { value: 0 },
    uGain: { value: 0 },
    uCeil: { value: 0 },
    uBeamPivot: { value: 0 },
    uPedestalBeam: { value: 0 },
    uPedestalDisplay: { value: 0 },
    uColorKnee: { value: 0 },
    uContinuumShare: { value: 1 },
  };
  seatExtendedInstrument(uniforms, pedestalRadiance, CAMERA_INSTRUMENT, 1);
  return uniforms;
}

/** Seat an instrument on the star-point material's uniforms. */
export function seatPointInstrument(
  uniforms: Record<string, { value: unknown }>,
  instrument: DisplayInstrument,
  exposure: number,
): void {
  uniforms.uGamma.value = instrument.gamma;
  uniforms.uGain.value = instrument.gain;
  uniforms.uLogPivot.value = Math.log2(instrument.pivotLsunPc2 / exposure);
  uniforms.uFloor.value = instrument.floor;
  uniforms.uCeil.value = instrument.ceil;
  uniforms.uCutoff.value = instrument.cutoffLsunPc2 / exposure;
  uniforms.uPointColorKnee.value = instrument.pointColorKnee;
}

/** Seat an instrument on a 3D star-point material (neighborStars):
 *  these carry a per-population zero point of their own, so the
 *  instrument's pivot rides in as a shift against the camera's. */
export function seatFieldPointInstrument(
  uniforms: Record<string, { value: unknown }>,
  instrument: DisplayInstrument,
  exposure: number,
): void {
  uniforms.uGamma.value = instrument.gamma;
  uniforms.uGain.value = instrument.gain;
  uniforms.uFloor.value = instrument.floor;
  uniforms.uCeil.value = instrument.ceil;
  uniforms.uZeroShift.value = Math.log2(exposure / instrument.pivotLsunPc2) - 17;
  uniforms.uCutoff.value = instrument.cutoffLsunPc2 / exposure;
  uniforms.uPointColorKnee.value = instrument.pointColorKnee;
}

/** The 3D star-point block at the camera transfer. */
export function fieldPointUniforms(): Record<string, { value: number }> {
  const uniforms: Record<string, { value: number }> = {
    uGamma: { value: 0 },
    uGain: { value: 0 },
    uFloor: { value: 0 },
    uCeil: { value: 0 },
    uZeroShift: { value: 0 },
    uCutoff: { value: 0 },
    uPointColorKnee: { value: 0 },
  };
  seatFieldPointInstrument(uniforms, CAMERA_INSTRUMENT, 1);
  return uniforms;
}

/** The point block at the camera transfer. */
export function pointUniforms(): Record<string, { value: number }> {
  const uniforms: Record<string, { value: number }> = {
    uGamma: { value: 0 },
    uGain: { value: 0 },
    uLogPivot: { value: 0 },
    uFloor: { value: 0 },
    uCeil: { value: 0 },
    uCutoff: { value: 0 },
    uPointColorKnee: { value: 0 },
  };
  seatPointInstrument(uniforms, CAMERA_INSTRUMENT, 1);
  return uniforms;
}
