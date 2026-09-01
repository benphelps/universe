/**
 * The sky's one photometric law: what a pixel shows for the light that
 * reaches it. Every tier of the night sky — resolved star points, the
 * nebula volumes and their sprite impostors, the Milky Way glow —
 * passes its physical brightness through this same curve, so relative
 * brightness across tiers is physics, and the curve itself is the one
 * instrument dial (a display-mode split — eye, camera, narrowband —
 * would swap this curve, nothing else).
 *
 * The sky spans ten decades of brightness and a display holds barely
 * two, so the law is a power-law compression: display energy goes as
 * brightness to the 0.36. Because it is a pure power, dimming a point
 * commutes with it exactly — display(B·T) = display(B)·T^γ — so
 * extinction can be applied in display space with the transmittance
 * raised to the same exponent.
 *
 * Extended light passes through the same curve, but as every deep
 * exposure shows it: sky-subtracted. The smooth sky has a floor in
 * every direction — the integrated starlight of the whole column,
 * about a solar luminosity per pc² per steradian toward the poles —
 * and a stretch this deep would render that floor as fog across the
 * entire display. What an instrument shows of an extended source is
 * its marginal response above that pedestal, display(P + R) −
 * display(P): an increment far below the pedestal vanishes into it,
 * a nebula standing above it keeps its full stature. Points are
 * different on purpose — PSF photometry stands a star's whole flux
 * above any background, which is why the eye picks faint stars out
 * of skies it cannot see glow in.
 *
 * Brightness convention: a point source counts as its luminosity over
 * distance squared, L☉/pc² (the 4π of true flux folded in, as the star
 * accumulators store it). Extended light is radiance, L☉ pc⁻² sr⁻¹ —
 * distance-independent, as surface brightness really is — and enters
 * as the brightness one reference beam collects of it.
 */

/** Exponent of the display law: how hard ten decades of sky are
 *  pressed into two of display. */
export const DISPLAY_GAMMA = 0.36;

/** Display energy at the pivot brightness. */
export const DISPLAY_GAIN = 0.055;

/** Pivot brightness, L☉/pc²: around the faintest stars the sweep
 *  keeps, so the law's knee sits where the sky's population thins. */
export const DISPLAY_PIVOT_LSUN_PC2 = 2 ** -17;

/** Ceiling on display energy — headroom above white for the very
 *  nearest stars to bloom against. */
export const DISPLAY_CEIL = 1.7;

/** Floor for resolved star points only: a point below it would flicker
 *  between pixels, so it holds at a dim constant instead. Extended
 *  light takes no floor — faintness is allowed to vanish. */
export const DISPLAY_FLOOR = 0.012;

/** The reference beam, sr: one pixel of the reference display — the
 *  55° camera over 1080 rows. Surface brightness never changes with
 *  distance; this beam is what turns a radiance into the brightness a
 *  single pixel collects of it. */
export const BEAM_SR = ((55 * Math.PI) / 180 / 1080) ** 2;

/** The sky's diffuse pedestal, L☉ pc⁻² sr⁻¹: the integrated starlight
 *  of a typical dark column (the real pole sky is ~23.3 mag/arcsec²,
 *  about one of these units). The instrument subtracts it, and every
 *  extended tier displays as contrast above it. */
export const SKY_PEDESTAL_LSUN_PC2_SR = 1;

/** Display energy for a point brightness, L☉/pc². Unclamped — the
 *  point tier applies its own floor and ceiling. */
export function displayEnergy(brightnessLsunPc2: number): number {
  return DISPLAY_GAIN * (Math.max(0, brightnessLsunPc2) / DISPLAY_PIVOT_LSUN_PC2) ** DISPLAY_GAMMA;
}

/** Display energy for a surface brightness, L☉ pc⁻² sr⁻¹, above the
 *  smooth sky: the law's marginal response over the pedestal, at what
 *  one reference beam collects, in the point convention's 4π units,
 *  ceiling applied. */
export function displaySurfaceBrightness(radianceLsunPc2Sr: number): number {
  const beam = 4 * Math.PI * BEAM_SR;
  return Math.min(
    DISPLAY_CEIL,
    displayEnergy(beam * (SKY_PEDESTAL_LSUN_PC2_SR + Math.max(0, radianceLsunPc2Sr))) -
      displayEnergy(beam * SKY_PEDESTAL_LSUN_PC2_SR),
  );
}

/** The radiance above the sky a display energy stands for — the
 *  marginal law inverted, for tests and probes that decode a map. */
export function radianceFromDisplay(display: number): number {
  const beam = 4 * Math.PI * BEAM_SR;
  const pedestal = displayEnergy(beam * SKY_PEDESTAL_LSUN_PC2_SR);
  return (
    (((display + pedestal) / DISPLAY_GAIN) ** (1 / DISPLAY_GAMMA) * DISPLAY_PIVOT_LSUN_PC2) /
      beam -
    SKY_PEDESTAL_LSUN_PC2_SR
  );
}
