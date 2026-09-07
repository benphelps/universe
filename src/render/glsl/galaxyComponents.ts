import { STELLAR_HALO_MODEL as halo, stellarHaloNumberNormalization } from '../../universe/galaxy/stellarHalo';
import { SMOOTH_MODEL } from '../../universe/galaxy/density';
import { fieldPopulationMoments } from '../../universe/galaxy/fieldPopulation';
import { bulgeDensityModel } from '../../universe/galaxy/spheroid';
import { SCATTER_OPACITY_RGB } from '../../universe/galaxy/dustScattering';
import { glslFloat as f } from './format';

/** Shared density/light evaluator for the sky bake and exterior rays.
 * Coordinates are kpc; number densities remain stars/pc³. Uniforms
 * carry seed-dependent bulge geometry and component population means. */
export const GALAXY_COMPONENT_GLSL = /* glsl */ `
uniform vec3 uBulgeModel;
uniform vec3 uBulgeCore;
uniform vec4 uPopulationR;
uniform vec4 uPopulationG;
uniform vec4 uPopulationB;
const vec3 GALAXY_DUST_RGB = vec3(${SCATTER_OPACITY_RGB.map(f).join(", ")});
vec3 galaxyFieldDensity(vec3 p) {
  float r = length(p.xy);
  float z = abs(p.z);
  float h = max(length(vec3(p.xy, p.z / ${f(halo.flattening)})), ${f(halo.corePc / 1000)});
  float haloDensity = ${f(stellarHaloNumberNormalization())} *
    pow(min(h, ${f(halo.breakPc / 1000)}) / ${f(halo.referencePc / 1000)}, ${f(-halo.innerSlope)});
  if (h > ${f(halo.breakPc / 1000)}) haloDensity *= pow(h / ${f(halo.breakPc / 1000)}, ${f(-halo.outerSlope)});
  return vec3(
    ${f(SMOOTH_MODEL.thinNorm)} * exp(-r / ${f(SMOOTH_MODEL.thinScaleLengthPc / 1000)}) * exp(-z / ${f(SMOOTH_MODEL.thinScaleHeightPc / 1000)}),
    ${f(SMOOTH_MODEL.thickNorm)} * exp(-r / ${f(SMOOTH_MODEL.thickScaleLengthPc / 1000)}) * exp(-z / ${f(SMOOTH_MODEL.thickScaleHeightPc / 1000)}),
    haloDensity
  );
}
float galaxyBulgeDensity(vec3 p) {
  float r = length(p);
  if (r < uBulgeModel.y) {
    float t2 = (r / uBulgeModel.y) * (r / uBulgeModel.y);
    return (uBulgeCore.z * t2 + uBulgeCore.y) * t2 + uBulgeCore.x;
  }
  float s = r + uBulgeModel.x;
  return uBulgeModel.z / (r * s * s * s);
}
vec3 galaxyEmissionDensity(vec3 p, float armBoost) {
  vec3 n = galaxyFieldDensity(p);
  n.x *= 1.0 + armBoost;
  vec4 counts = vec4(n, galaxyBulgeDensity(p));
  return vec3(dot(counts, uPopulationR), dot(counts, uPopulationG), dot(counts, uPopulationB));
}
`;

export function galaxyComponentUniforms(): { bulge: [number, number, number]; core: [number, number, number]; optical: [number, number, number, number][] } {
  const { scalePc, corePc, coefficient, corePolynomial } = bulgeDensityModel();
  return {
    bulge: [scalePc / 1000, corePc / 1000, coefficient / 1e12],
    core: corePolynomial,
    optical: [0, 1, 2].map(channel => ['thin-disk', 'thick-disk', 'halo', 'bulge'].map(c =>
      fieldPopulationMoments(c as Parameters<typeof fieldPopulationMoments>[0]).opticalRgbSolar[channel],
    ) as [number, number, number, number]),
  };
}
