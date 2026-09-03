import { AdditiveBlending, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { secondSunUniforms } from '../lighting/secondSun';
import { deckOpticalDepth } from '../../universe/planet/atmosphere';
import type { Characterization } from '../../universe/planet/types';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { WORLD_NORMAL_GLSL } from '../glsl/worldNormal';
import { AIR_REFRACT_GLSL, AIR_VIEW_GLSL, airViewUniforms } from '../lighting/airView';
import {
  horizonAirmass,
  SURFACE_LIGHT_GLSL,
  surfaceLightUniforms,
} from '../lighting/surfaceLight';
import { createShadowUniforms, SHADOW_GLSL } from './shadows';

const VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vCenter;
varying float vBodyRadius;

uniform float uInflation;

${WORLD_NORMAL_GLSL}

${AIR_REFRACT_GLSL}

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vBodyRadius = length(vec3(modelMatrix[0])) / uInflation;
  gl_Position = projectionMatrix * viewMatrix * vec4(airRefractPosition(worldPos.xyz), 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vCenter;
varying float vBodyRadius;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;

${SIMPLEX_NOISE_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}
${AIR_VIEW_GLSL}

// One sun's light scattered toward the eye by the air the sightline
// grazes: the beam reaching the tangent point over its own slant, the
// phase, and the tangent column — twice the horizontal column at that
// height, Chapman's √(πR/2H) times the depth there.
vec3 limbScatter(vec3 lightDir, vec3 lightColor, vec3 tangent, float tangentAlt, vec3 viewDir, float reach) {
  vec3 up = normalize(tangent - vCenter);
  float mus = dot(up, lightDir);
  float depthAtHeight = exp(-max(tangentAlt, 0.0) / max(uScaleHeight, 1e-4));
  vec3 tau = uOpticalDepth * depthAtHeight;
  vec3 beam = exp(-tau * airmass(mus));
  vec3 column = 2.0 * tau * uHorizonAirmass;
  float shadow = shadowFactor(tangent, lightDir, uStarAngularRadius, reach);
  return lightColor * phaseWeight(dot(viewDir, lightDir)) * beam * (1.0 - exp(-column))
    * twilight(mus) * shadow;
}

void main() {
  // The sightline's closest approach to the body: over the disc the
  // body's own shader carries the air; beyond it the air alone shows.
  vec3 viewDir = normalize(vWorldPos - cameraPosition);
  vec3 rel = vCenter - cameraPosition;
  float along = dot(rel, viewDir);
  vec3 tangent = cameraPosition + viewDir * along;
  float miss = length(tangent - vCenter);
  if (miss <= vBodyRadius || along <= 0.0) discard;
  float tangentAlt = miss - vBodyRadius;
  vec3 scatter = limbScatter(uLightDir, uLightColor, tangent, tangentAlt, viewDir, 1e30)
    + limbScatter(uLight2Dir, uLight2Color, tangent, tangentAlt, viewDir, uLight2Reach);
  gl_FragColor = vec4(scatter * airTransmittanceTo(vWorldPos), 1.0);
}
`;

/**
 * The limb of air beyond a body's disc: an inflated additive shell a
 * few scale heights deep, lit by the same column the disc stands under
 * along the sightlines that graze past it. Over the disc it yields to
 * the body's own shader, which carries that air itself.
 */
export function createAtmosphereShell(
  physical: Characterization,
  planetRadiusUnits: number,
): Mesh | null {
  const { atmosphere, bulk } = physical;
  if (atmosphere.class === 'none') return null;

  const relativeHeight = Math.min(0.12, Math.max(0.015, (8 * atmosphere.scaleHeightKm) / (bulk.radiusEarth * 6371)));
  const radiusKm = bulk.radiusEarth * 6371;
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      ...airViewUniforms(),
      ...surfaceLightUniforms({
        ...deckOpticalDepth(atmosphere, bulk),
        horizon: horizonAirmass(radiusKm, atmosphere.scaleHeightKm),
        radius: radiusKm,
        scaleHeight: atmosphere.scaleHeightKm,
      }),
      uInflation: { value: 1 + relativeHeight },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(new SphereGeometry(1, 64, 32), material);
  // Additive limb glow, depth-mute: drawn after the sky composite so a
  // dark cloud behind the planet cannot eat the rim, and before the
  // rings, which pass in front of it (reversed-Z: lowest order last).
  mesh.renderOrder = -2.05;
  // The gas follows the rotating body's figure: an oblate planet wears
  // an equally oblate limb, not a spherical halo lifted off its poles.
  const r = planetRadiusUnits * (1 + relativeHeight);
  mesh.scale.set(r, r * (1 - bulk.oblateness), r);
  return mesh;
}
