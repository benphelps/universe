import { describe, expect, it } from 'vitest';
import {
  CAMERA_INSTRUMENT,
  displaySurfaceBrightness,
  NARROWBAND_INSTRUMENT,
} from '../universe/galaxy/displayLaw';
import { seatExtendedInstrument, transferUniforms } from './displayTransfer';

/** The shader's displayRadiance, evaluated on the seated uniforms. */
function shown(uniforms: Record<string, { value: number }>, radiance: number): number {
  const { uGain, uGamma, uPedestalBeam, uBeamPivot, uPedestalDisplay, uCeil } = uniforms;
  return Math.min(
    uCeil.value,
    uGain.value * (uPedestalBeam.value + radiance * uBeamPivot.value) ** uGamma.value -
      uPedestalDisplay.value,
  );
}

describe('the extended-light seating', () => {
  it('is the display law over the sky pedestal at the camera', () => {
    const uniforms = transferUniforms(1.3);
    for (const radiance of [0, 0.5, 4, 230]) {
      expect(shown(uniforms, radiance)).toBeCloseTo(displaySurfaceBrightness(radiance, 1.3), 9);
    }
  });

  it('subtracts only the continuum the narrowband filters pass', () => {
    // The sky pedestal is starlight. A stack that rejects continuum
    // sees a far lower floor, and a line radiance stands taller over
    // it than the same radiance stands over the broadband sky — the
    // point of narrowband imaging.
    const camera = transferUniforms(1);
    const narrow = transferUniforms(1);
    seatExtendedInstrument(narrow, 1, NARROWBAND_INSTRUMENT, 1);
    seatExtendedInstrument(camera, 1, CAMERA_INSTRUMENT, 1);
    expect(narrow.uPedestalBeam.value).toBeCloseTo(
      camera.uPedestalBeam.value * NARROWBAND_INSTRUMENT.continuumShare,
      12,
    );
    expect(shown(narrow, 0.5)).toBeGreaterThan(2 * shown(camera, 0.5));
    expect(shown(narrow, 0)).toBe(0);
  });
});
