import { Color, DoubleSide, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { secondSunUniforms } from '../lighting/secondSun';
import {
  horizonAirmass,
  SURFACE_LIGHT_GLSL,
  surfaceLightUniforms,
} from '../lighting/surfaceLight';
import { atmosphereColumn, columnAbove } from '../../universe/planet/atmosphere';
import type { Characterization } from '../../universe/planet/types';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { createShadowUniforms, SHADOW_GLSL } from '../planet/shadows';
import { planetSeedOffset } from '../planet/solidPlanetMaterial';

const VERTEX = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldPos;

void main() {
  vObjPos = position;
  // vWorldPos feeds directions only; clip runs through modelViewMatrix
  // for f32 stability near the ground — see terrainMaterial.
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0));
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldPos;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;
uniform vec3 uSeedOffset;
uniform vec3 uCloudColor;
uniform float uCloudCoverage;
uniform float uTimeDays;
uniform vec3 uSurfaceRayleighDepth;     // the whole column, below the deck too
uniform vec3 uSurfaceAerosolDepth;

${SIMPLEX_NOISE_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}

vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

void main() {
  vec3 p = normalize(vObjPos);
  // The same drifting field as the shader-sphere planets, so the focus
  // view keeps the cloud climate the far view promised.
  vec3 cloudP = rotateY(p, uTimeDays * 0.35);
  float cloudField = fbm(cloudP * 3.2 + uSeedOffset + vec3(0.0, 0.0, uTimeDays * 0.02)) * 0.5 + 0.5;
  float threshold = 1.0 - uCloudCoverage;
  float mask = smoothstep(threshold - 0.12, threshold + 0.12, cloudField);
  // Finer structure fades in up close so decks read as weather, not
  // blobs — and stays out of the far view, where its top octave would
  // alias into a lattice and break parity with the shader-sphere look.
  float detail = fbm(cloudP * 7.0 + uSeedOffset.zxy) * 0.5 + 0.5;
  float detailWeight = 1.0 - smoothstep(300.0, 3000.0, distance(cameraPosition, vWorldPos));
  mask = clamp(mask * mix(1.0, 0.35 + 1.1 * detail, detailWeight), 0.0, 1.0);

  // Radially-lit tops through the thin air above the deck: bright by
  // day, reddened at the terminator, eclipsed under a moon's shadow.
  float shadow = shadowFactor(vWorldPos, uLightDir, uStarAngularRadius, 1e30);
  float shadow2 = shadowFactor(vWorldPos, uLight2Dir, uStar2AngularRadius, uLight2Reach);
  vec3 light = surfaceLight(uOpticalDepth, uLightDir, uLightColor, p, p, shadow, diffuseShadow(shadow))
    + surfaceLight(uOpticalDepth, uLight2Dir, uLight2Color, p, p, shadow2, diffuseShadow(shadow2));
  vec3 color = uCloudColor * (light + uNightFloor);
  // Seen through the air between the eye and the deck.
  float eyeAlt = length(cameraPosition) - uPlanetRadius;
  float pointAlt = length(vWorldPos) - uPlanetRadius;
  float viewDistance = distance(cameraPosition, vWorldPos);
  vec3 column = airSegmentComponent(
      uSurfaceRayleighDepth, uScaleHeight, uHorizonAirmass,
      eyeAlt, pointAlt, viewDistance
    ) + airSegmentComponent(
      uSurfaceAerosolDepth, uAerosolScaleHeight, uAerosolHorizonAirmass,
      eyeAlt, pointAlt, viewDistance
    );
  vec3 midUp = normalize(0.5 * (cameraPosition + vWorldPos));
  vec3 midPoint = 0.5 * (cameraPosition + vWorldPos);
  vec3 toEye = normalize(cameraPosition - vWorldPos);
  float midAlt = max(0.5 * (eyeAlt + pointAlt), 0.0);
  float airShadow = shadowFactor(midPoint, uLightDir, uStarAngularRadius, 1e30);
  vec3 scatter = uLightColor * phaseWeight(-dot(toEye, uLightDir))
    * exp(
      -uSurfaceRayleighDepth * exp(-midAlt / max(uScaleHeight, 1e-4))
        * airmassFor(dot(midUp, uLightDir), uHorizonAirmass)
      -uSurfaceAerosolDepth * exp(-midAlt / max(uAerosolScaleHeight, 1e-4))
        * airmassFor(dot(midUp, uLightDir), uAerosolHorizonAirmass)
    ) * (1.0 - exp(-column))
    * twilight(dot(midUp, uLightDir)) * airShadow;
  color = color * exp(-column) + scatter;

  // Fade out around the camera so descending through the deck never
  // crosses a hard sheet.
  float fade = smoothstep(1.0, 6.0, distance(cameraPosition, vWorldPos));
  gl_FragColor = vec4(color, mask * 0.92 * fade);
}
`;

/**
 * The focus planet's cloud deck: a translucent shell clearing the
 * highest terrain, visible from orbit as global weather and from the
 * ground as an overhead sky deck.
 */
export function createCloudShell(
  physical: Characterization,
  radiusKm: number,
  seaLevelKm: number,
  reliefKm: number,
): Mesh | null {
  const { appearance, atmosphere, bulk } = physical;
  if (atmosphere.class === 'none' || appearance.cloudCoverage < 0.02) return null;
  // The deck must clear the highest terrain by more than its own
  // triangulation sag, or quad centers dip below mountaintops and the
  // depth test punches a grid of holes through the clouds.
  const deckKm =
    Math.max(seaLevelKm, 0) + reliefKm + Math.max(3, atmosphere.scaleHeightKm * 0.9);
  const column = atmosphereColumn(atmosphere, bulk);
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      ...surfaceLightUniforms({
        ...columnAbove(column, atmosphere, deckKm),
        horizon: horizonAirmass(radiusKm, atmosphere.scaleHeightKm),
        radius: radiusKm,
        scaleHeight: atmosphere.scaleHeightKm,
      }),
      uSurfaceRayleighDepth: { value: new Color(...column.rayleigh) },
      uSurfaceAerosolDepth: { value: new Color(...column.aerosolExtinction) },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      uSeedOffset: { value: planetSeedOffset(physical.seedHex) },
      uCloudColor: { value: appearance.cloudColor },
      uCloudCoverage: { value: appearance.cloudCoverage },
      uTimeDays: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const shell = new Mesh(new SphereGeometry(radiusKm + deckKm, 256, 128), material);
  // The deck stands kilometres up, in front of everything stellar: it
  // draws after the sky composite, the star points and the haze dome
  // (reversed-Z: lowest order last). At 2 it drew before them all —
  // stars shone through an overcast, and a dark nebula's occlusion
  // multiplied the deck's own light away, cutting black holes into a
  // lit sky that stands between the cloud and the eye.
  shell.renderOrder = -2.5;
  return shell;
}
