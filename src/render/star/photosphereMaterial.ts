import { ShaderMaterial, type DataTexture } from 'three';
import type { Star } from '../../universe/star/types';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { seedOffset } from './seedOffset';
import { stellarSurfaceModel, stellarSurfaceStateAt } from './surfaceModel';

const VERTEX = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  vObjPos = position;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

uniform sampler2D uLut;
uniform float uTeff;
uniform float uRotationPhase;
uniform float uSpotRotationPhase;
uniform float uGranuleFrequency;
uniform float uGranuleEpoch;
uniform float uGranulePhase;
uniform float uGranulationStrength;
uniform float uGranulationDeltaK;
uniform float uSpotCoverage;
uniform float uSpotLatitude;
uniform float uSpotCurrentEpoch;
uniform float uSpotPreviousEpoch;
uniform float uSpotPhase;
uniform float uSpotTemperatureDeficitK;
uniform float uFaculaTemperatureExcessK;
uniform float uCloudPatchiness;
uniform float uLimbU;
uniform float uIntensity;
uniform float uLuminosityMultiplier;
uniform float uDetailFade;
uniform vec3 uSeedOffset;

${SIMPLEX_NOISE_GLSL}

// Mired-parameterized blackbody LUT coordinate (matches core/color/blackbody).
float lutCoord(float temperature) {
  float mired = 1.0e6 / max(temperature, 1.0);
  return clamp((mired - 20.0) / 980.0, 0.0, 1.0);
}

vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

float smooth01(float value) {
  float x = clamp(value, 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}

vec3 epochOffset(float epoch) {
  float e = mod(epoch, 4096.0);
  return 11.0 * vec3(
    sin(e * 1.6180339 + 0.7),
    sin(e * 2.4142136 + 2.1),
    sin(e * 3.1415927 + 4.3)
  );
}

/** Smoothly replace short-lived convection cells instead of translating
 *  one noise volume forever. This is the same non-accumulating principle
 *  as the magma flow shader, with a cellular rather than ridged signal. */
float evolvingNoise(vec3 p, float epoch, float phase) {
  float blend = smooth01(phase);
  return mix(
    snoise(p + epochOffset(epoch)),
    snoise(p + epochOffset(epoch + 1.0)),
    blend
  );
}

float activeField(vec3 p, float epoch) {
  vec3 offset = epochOffset(epoch) + uSeedOffset.zxy;
  // Several smaller umbra/penumbra groups read as an active complex;
  // one very low-frequency field produces continent-sized paint blobs.
  float broad = snoise(p * 3.15 + offset);
  float middle = snoise(p * 6.8 - offset.yzx * 0.73);
  float broken = snoise(p * 12.2 + offset.xzy * 0.41);
  return 0.62 * broad + 0.27 * middle + 0.11 * broken;
}

float activeTexture(vec3 p, float epoch) {
  vec3 offset = epochOffset(epoch) + uSeedOffset.yxz;
  float filaments = snoise(p * 23.0 + offset * 0.37);
  float mottling = snoise(p * 41.0 - offset.zxy * 0.21);
  return 0.68 * filaments + 0.32 * mottling;
}

void activeMasks(
  vec3 p,
  float epoch,
  float band,
  float threshold,
  out float penumbra,
  out float umbra,
  out float facula
) {
  float field = activeField(p, epoch);
  float expanded = smoothstep(threshold - 0.16, threshold - 0.025, field) * band;
  penumbra = smoothstep(threshold - 0.035, threshold + 0.09, field) * band;
  umbra = smoothstep(threshold + 0.105, threshold + 0.2, field) * band;
  facula = max(expanded - penumbra, 0.0);
}

void main() {
  vec3 p = normalize(vObjPos);
  float latitude = asin(clamp(p.y, -1.0, 1.0));
  float mu = clamp(dot(normalize(vWorldNormal), normalize(vViewDir)), 0.0, 1.0);

  // Granules co-rotate, but their topology is replaced on the pressure-
  // scale-height clock. Zero contours form cool intergranular lanes around
  // hotter cell interiors. A derivative gate substitutes the mean before
  // cells become subpixel, avoiding the old dotted/striped aliasing.
  vec3 surfaceP = rotateY(p, uRotationPhase);
  vec3 granuleP = surfaceP * uGranuleFrequency + uSeedOffset;
  vec3 warp = vec3(
    evolvingNoise(granuleP * 0.115, uGranuleEpoch, uGranulePhase),
    evolvingNoise(granuleP * 0.115 + vec3(4.1, -2.7, 1.3), uGranuleEpoch, uGranulePhase),
    evolvingNoise(granuleP * 0.115 + vec3(-1.8, 3.6, 5.2), uGranuleEpoch, uGranulePhase)
  );
  float cell = evolvingNoise(granuleP + warp * 0.72, uGranuleEpoch, uGranulePhase);
  float cellFine = evolvingNoise(granuleP * 1.9 - warp * 0.38, uGranuleEpoch, uGranulePhase);
  float lane = exp(-abs(cell) * 7.5) * (0.72 + 0.28 * (0.5 + 0.5 * cellFine));
  float hotInterior = smoothstep(-0.32, 0.66, cell);
  float granulePattern = 0.68 * (hotInterior - 0.46) - 0.58 * lane + 0.24 * cellFine;
  float granuleFootprint = uGranuleFrequency * length(fwidth(p));
  float granuleVisible = (1.0 - smoothstep(0.22, 0.62, granuleFootprint))
    * uGranulationStrength * uDetailFade;
  // The true granules disappear below a pixel on a full-disc view, but
  // broader convective organization still modulates the surface weakly.
  // Keeping it at much lower contrast preserves scale rather than inflating
  // individual granules merely to make them visible.
  float broadFrequency = max(3.0, uGranuleFrequency * 0.14);
  float broadConvection = evolvingNoise(
    surfaceP * broadFrequency + uSeedOffset.zxy,
    uGranuleEpoch,
    uGranulePhase
  );
  float broadFootprint = broadFrequency * length(fwidth(p));
  float broadVisible = (1.0 - smoothstep(0.35, 0.95, broadFootprint))
    * uGranulationStrength * uDetailFade;
  float deltaT = uGranulationDeltaK
    * (granulePattern * granuleVisible + 0.16 * broadConvection * broadVisible);

  // Magnetic regions are finite-lived coherent structures. The whole
  // active belt rotates at its own observed latitude; it is never sheared
  // per fragment by an angle that grows without bound. Two generations
  // crossfade, yielding irregular penumbrae, darker umbrae, and a facular
  // skirt that becomes more conspicuous toward the limb.
  if (uSpotCoverage > 0.0001 && uDetailFade > 0.001) {
    vec3 spotP = rotateY(p, uSpotRotationPhase);
    float activity = sqrt(clamp(uSpotCoverage / 0.4, 0.0, 1.0));
    float bandWidth = mix(0.16, 0.31, activity);
    float bandDistance = (abs(latitude) - uSpotLatitude) / bandWidth;
    float band = exp(-bandDistance * bandDistance);
    float threshold = mix(0.87, 0.27, activity);
    float prevPen;
    float prevUmbra;
    float prevFacula;
    float currPen;
    float currUmbra;
    float currFacula;
    activeMasks(spotP, uSpotPreviousEpoch, band, threshold, prevPen, prevUmbra, prevFacula);
    activeMasks(spotP, uSpotCurrentEpoch, band, threshold, currPen, currUmbra, currFacula);
    float handoff = smooth01(uSpotPhase);
    float penumbra = mix(prevPen, currPen, handoff);
    float umbra = mix(prevUmbra, currUmbra, handoff);
    float facula = mix(prevFacula, currFacula, handoff);
    float prevTexture = activeTexture(spotP, uSpotPreviousEpoch);
    float currTexture = activeTexture(spotP, uSpotCurrentEpoch);
    float spotTexture = mix(prevTexture, currTexture, handoff);
    // Penumbrae are filamented and the umbra remains mottled rather than
    // becoming a single flat cut-out. Umbra is already contained in the
    // penumbral mask, so the second term deepens only the magnetic core.
    float penumbraDepth = 0.54 + 0.2 * spotTexture;
    float umbraDepth = 0.28 + 0.08 * spotTexture;
    float spotCooling = clamp(penumbra * penumbraDepth + umbra * umbraDepth, 0.0, 1.0);
    deltaT -= uSpotTemperatureDeficitK * spotCooling * uDetailFade;
    float faculaTexture = 0.62 + 0.38 * max(spotTexture, -0.25);
    float limbFacula = 0.04 + 1.42 * pow(1.0 - mu, 0.65);
    deltaT += uFaculaTemperatureExcessK
      * facula * faculaTexture * limbFacula * uDetailFade;
  }

  // L/T-transition brown dwarfs carry condensate weather rather than
  // magnetic sunspots. Reuse the finite active-region clock so patches
  // form and disperse instead of becoming zonal scars.
  if (uCloudPatchiness > 0.001 && uDetailFade > 0.001) {
    float cloud = evolvingNoise(surfaceP * 3.2 + uSeedOffset.yzx,
      uSpotCurrentEpoch, uSpotPhase);
    float cloudBands = 0.65 + 0.35 * sin(latitude * 7.0 + 1.8 * cloud);
    deltaT += uTeff * 0.12 * uCloudPatchiness * cloud * cloudBands * uDetailFade;
  }

  float localT = max(uTeff * 0.3, uTeff + deltaT);
  vec3 color = texture2D(uLut, vec2(lutCoord(localT), 0.5)).rgb;

  // Local radiance follows T⁴; limb darkening from the linear law.
  float radiance = pow(localT / uTeff, 4.0);
  float limb = 1.0 - uLimbU * (1.0 - mu);

  vec3 hdr = color * radiance * limb * uIntensity * uLuminosityMultiplier;
  gl_FragColor = vec4(hdr, 1.0);
}
`;

export function createPhotosphereMaterial(star: Star, lut: DataTexture): ShaderMaterial {
  const model = stellarSurfaceModel(star);
  const state = stellarSurfaceStateAt(star, model, 0);
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uLut: { value: lut },
      uTeff: { value: star.tEff },
      uRotationPhase: { value: state.rotationPhase },
      uSpotRotationPhase: { value: state.spotRotationPhase },
      uGranuleFrequency: { value: model.granuleFrequency },
      uGranuleEpoch: { value: state.granuleEpoch },
      uGranulePhase: { value: state.granulePhase },
      uGranulationStrength: { value: model.granulationStrength },
      uGranulationDeltaK: { value: model.granulationDeltaK },
      uSpotCoverage: { value: star.activity.spotCoverage },
      uSpotLatitude: { value: star.activity.spotLatitudeRad },
      uSpotCurrentEpoch: { value: state.spotCurrentEpoch },
      uSpotPreviousEpoch: { value: state.spotPreviousEpoch },
      uSpotPhase: { value: state.spotPhase },
      uSpotTemperatureDeficitK: { value: model.spotTemperatureDeficitK },
      uFaculaTemperatureExcessK: { value: model.faculaTemperatureExcessK },
      uCloudPatchiness: { value: star.activity.cloudPatchiness },
      uLimbU: { value: star.activity.limbDarkeningU },
      uIntensity: { value: 0.78 },
      uLuminosityMultiplier: { value: 1 },
      uDetailFade: { value: 1 },
      uSeedOffset: { value: seedOffset(star) },
    },
  });
}
