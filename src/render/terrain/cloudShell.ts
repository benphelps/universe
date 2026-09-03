import { Color, DoubleSide, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { SECOND_SUN_GLSL, secondSunUniforms } from '../lighting/secondSun';
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
import { CLOUD_PATTERN_GLSL, cloudPatternUniforms } from '../planet/cloudPattern';
import { CLOUD_VOLUME_GLSL } from './cloudVolume';

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
${SECOND_SUN_GLSL}
uniform vec3 uSeedOffset;
uniform vec3 uCloudColor;
uniform float uTimeDays;
uniform vec3 uSurfaceRayleighDepth;     // the whole column, below the deck too
uniform vec3 uSurfaceAerosolDepth;

${SIMPLEX_NOISE_GLSL}
${CLOUD_PATTERN_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}
${CLOUD_VOLUME_GLSL}

void main() {
  // Use the analytic sphere hit for every close-range calculation. The
  // interpolated geometry position lies on a flat triangle, not the deck.
  vec3 shellPoint = cloudOuterPoint(vWorldPos);
  float range = distance(cameraPosition, shellPoint);
  float volumeWeight = 1.0 - smoothstep(600.0, 3500.0, range);
  bool nearDeck = volumeWeight > 0.001;
  if (nearDeck) {
    // Transparent DoubleSide spheres are drawn once per side. At close
    // range only the boundary facing the camera owns this ray segment;
    // integrating both sides would double the same volume, so the other
    // side leaves before it samples the weather at all.
    bool outsideDeck = length(cameraPosition) > uCloudOuterRadius;
    if ((outsideDeck && !gl_FrontFacing) || (!outsideDeck && gl_FrontFacing)) discard;
  }
  vec3 p = normalize(shellPoint);
  vec3 cloud = cloudDeckSample(p, dot(p, uLightDir), uSeedOffset, uTimeDays);
  float mask = cloudOpacity(cloud.x);
  if (nearDeck) {
    vec3 volume = cloudVolume(shellPoint, cloud, uSeedOffset, uTimeDays);
    mask = mix(mask, volume.x, volumeWeight);
    cloud.y = mix(cloud.y, volume.y, volumeWeight);
  }
  vec3 cloudNormal = cloudReliefNormal(p, cloud.y);

  // Radially-lit tops through the thin air above the deck: bright by
  // day, reddened at the terminator, eclipsed under a moon's shadow.
  float shadow = shadowFactor(shellPoint, uLightDir, uStarAngularRadius, 1e30);
  vec3 light = surfaceLight(uOpticalDepth, uLightDir, uLightColor, cloudNormal, p, shadow, diffuseShadow(shadow));
  if (secondSunLit()) {
    float shadow2 = shadowFactor(shellPoint, uLight2Dir, uStar2AngularRadius, uLight2Reach);
    light += surfaceLight(uOpticalDepth, uLight2Dir, uLight2Color, cloudNormal, p, shadow2, diffuseShadow(shadow2));
  }
  vec3 color = uCloudColor * mix(0.65, 1.12, cloud.z) * (light + uNightFloor);
  // Below the deck we see its shaded base rather than the sunlit top.
  float aboveDeck = step(length(shellPoint), length(cameraPosition));
  color *= mix(0.42 + 0.25 * (1.0 - cloud.y), 1.0, aboveDeck);
  // Seen through the air between the eye and the deck.
  float eyeAlt = length(cameraPosition) - uPlanetRadius;
  float pointAlt = length(shellPoint) - uPlanetRadius;
  float viewDistance = distance(cameraPosition, shellPoint);
  vec3 column = airSegmentComponent(
      uSurfaceRayleighDepth, uScaleHeight, uHorizonAirmass,
      eyeAlt, pointAlt, viewDistance
    ) + airSegmentComponent(
      uSurfaceAerosolDepth, uAerosolScaleHeight, uAerosolHorizonAirmass,
      eyeAlt, pointAlt, viewDistance
    );
  vec3 midUp = normalize(0.5 * (cameraPosition + shellPoint));
  vec3 midPoint = 0.5 * (cameraPosition + shellPoint);
  vec3 toEye = normalize(cameraPosition - shellPoint);
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
  float fade = smoothstep(1.0, 6.0, range);
  gl_FragColor = vec4(color, mask * fade);
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
  if (atmosphere.class === 'none' || appearance.clouds.coverage < 0.01) return null;
  // The deck must clear the highest terrain by more than its own
  // triangulation sag, or quad centers dip below mountaintops and the
  // depth test punches a grid of holes through the clouds.
  const terrainClearanceKm = Math.max(seaLevelKm, 0) + reliefKm + 1;
  const deckKm = Math.max(terrainClearanceKm, appearance.clouds.topAltitudeKm);
  const baseKm = Math.max(terrainClearanceKm, deckKm - appearance.clouds.thicknessKm);
  const column = atmosphereColumn(atmosphere, bulk);
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      ...cloudPatternUniforms(physical),
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
      uCloudColor: { value: appearance.clouds.color },
      uTimeDays: { value: 0 },
      uCloudInnerRadius: { value: radiusKm + baseKm },
      uCloudOuterRadius: { value: radiusKm + deckKm },
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
