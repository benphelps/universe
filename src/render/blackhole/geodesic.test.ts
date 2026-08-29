import { describe, expect, it } from 'vitest';
import {
  iscoRadiusRg,
  MAX_SPIN,
  photonSphereRadiusRg,
  shadowImpactParameterRg,
} from '../../core/physics/blackHole';
import {
  DISPLAY_FALLOFF,
  GEODESIC_GLSL,
  LENSING_REACH_RG,
  profileStretch,
  RENDER_INNER_FLOOR_RG,
} from './geodesicGlsl';

/** Numeric value of a `const float NAME = …;` in the shader source. */
function shaderConstant(name: string): number {
  const match = GEODESIC_GLSL.match(new RegExp(`const float ${name} = ([-0-9.e]+);`));
  if (!match) throw new Error(`${name} is not a float constant of the tracer`);
  return Number(match[1]);
}

describe('the geodesic tracer', () => {
  it('draws the shadow at the impact parameter the physics gives', () => {
    // The shader shortcuts capture below the critical impact parameter
    // rather than integrating through the photon sphere, so this
    // constant *is* the shadow's edge: it has to be 3√3, and it has to
    // stay tied to the model the info panel quotes.
    expect(shaderConstant('CRITICAL_IMPACT')).toBeCloseTo(shadowImpactParameterRg(), 6);
    expect(shaderConstant('HORIZON')).toBe(2);
  });

  it('keeps the flow outside the radius where circular orbits die', () => {
    // No circular orbit exists inside the photon sphere at 3 r_g, and
    // none is bound inside 4 — the emitter kinematics the shader uses
    // are only defined outside that.
    expect(RENDER_INNER_FLOOR_RG).toBeGreaterThan(photonSphereRadiusRg(0));
    // Spin still moves the inner edge: the floor bites only for a hole
    // spinning fast enough that its ISCO has come inside it.
    expect(RENDER_INNER_FLOOR_RG).toBeLessThan(iscoRadiusRg(0));
    expect(iscoRadiusRg(MAX_SPIN)).toBeLessThan(RENDER_INNER_FLOOR_RG);
  });

  it('gives either flow regime the same readable falloff', () => {
    // A hot torus runs T ∝ r^-1 and a thin disc r^-3/4; both have to
    // reach the screen falling at the same rate, or one is a haze and
    // the other a dot. Ten times the radius, twenty-five times fainter.
    for (const profileExponent of [1, 0.75, 0.5]) {
      const gamma = profileStretch(profileExponent);
      const decade = (10 ** (-4 * profileExponent)) ** gamma;
      expect(decade).toBeCloseTo(10 ** -DISPLAY_FALLOFF, 6);
      expect(gamma).toBeGreaterThan(0);
      expect(gamma).toBeLessThanOrEqual(1);
    }
  });

  it('takes over the sky only where the bending is worth the blur', () => {
    // Inside the reach the background is the hole's own cube map, which
    // is coarser than the screen. So the boundary has to fall where a
    // ray still bends appreciably — a degree or more, deflection 4/b —
    // and not out where it would be trading softness for a pixel.
    const bendDeg = ((4 / LENSING_REACH_RG) * 180) / Math.PI;
    expect(bendDeg).toBeGreaterThan(1);
    expect(bendDeg).toBeLessThan(20);
    // And it must still clear the shadow itself by a wide margin, or
    // the hole would be drawing its own edge against unlensed sky.
    expect(LENSING_REACH_RG).toBeGreaterThan(20 * shadowImpactParameterRg());
    expect(GEODESIC_GLSL).toContain(`LENSING_REACH = ${LENSING_REACH_RG}.0`);
  });
});
