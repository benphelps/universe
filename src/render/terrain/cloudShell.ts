import { AlwaysDepth, BufferGeometry, Color, Float32BufferAttribute, Matrix4, Mesh, NoBlending, ShaderMaterial } from 'three';
import { SECOND_SUN_GLSL, secondSunUniforms } from '../lighting/secondSun';
import {
  horizonAirmass,
  SURFACE_LIGHT_GLSL,
  surfaceLightUniforms,
} from '../lighting/surfaceLight';
import {
  aerosolSurfaceExposure,
  atmosphereColumn,
} from '../../universe/planet/atmosphere';
import type { Characterization } from '../../universe/planet/types';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { createShadowUniforms, SHADOW_GLSL } from '../planet/shadows';
import { CLOUD_PATTERN_GLSL, cloudPatternUniforms, planetSeedOffset } from '../planet/cloudPattern';
import { CLOUD_VOLUME_GLSL } from './cloudVolume';
import { bodyGasProfile } from '../lighting/gasProfile';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform mat4 uInverseProjection;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
${SECOND_SUN_GLSL}
uniform vec3 uSeedOffset;
uniform vec3 uCloudColor;
uniform float uTimeDays;
uniform vec3 uSurfaceRayleighDepth;     // the whole column, below the deck too
uniform vec3 uSurfaceAerosolDepth;

${SIMPLEX_NOISE_GLSL}
// Ray misses and terrain occlusion branch per pixel. Screen derivatives
// after those branches have undefined neighbors, especially at the limb.
#define CLOUD_PATTERN_NO_DERIVATIVES
${CLOUD_PATTERN_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}
${CLOUD_VOLUME_GLSL}

void main() {
  vec4 background = texture2D(uSceneColor, vUv);
  float depth = texture2D(uSceneDepth, vUv).x;
  // Preserve the beauty depth for later bloom occlusion. AlwaysDepth and
  // depth writes are required even on rays without any cloud contribution.
  gl_FragDepth = depth;
  gl_FragColor = background;
  #ifdef USE_REVERSED_DEPTH_BUFFER
    float ndcDepth = depth;
    float nearDepth = 1.0;
    bool clearSky = depth <= 0.0;
  #else
    float ndcDepth = depth * 2.0 - 1.0;
    float nearDepth = -1.0;
    bool clearSky = depth >= 1.0;
  #endif
  vec4 viewNear = uInverseProjection * vec4(vUv * 2.0 - 1.0, nearDepth, 1.0);
  vec3 rayDir = normalize(viewNear.xyz * mat3(viewMatrix));
  vec4 viewSurface = uInverseProjection * vec4(vUv * 2.0 - 1.0, ndcDepth, 1.0);
  float surfaceDistance = clearSky ? 1e30 : length(viewSurface.xyz / viewSurface.w);
  vec2 fullSegment = cloudRaySegment(cameraPosition, rayDir, 1e30);
  vec2 segment = vec2(fullSegment.x, min(fullSegment.y, surfaceDistance));
  float path = segment.y - segment.x;
  if (path <= 0.0) return;

  // A single representative weather sample shared with the distant globe;
  // near the deck, eight bounded samples resolve its vertical structure.
  float volumeWeight = 1.0 - smoothstep(600.0, 3500.0, segment.x);
  vec3 shellPoint = cameraPosition + rayDir * mix(segment.x, segment.y, 0.5);
  vec3 p = normalize(shellPoint);
  vec3 cloud = cloudDeckSample(p, dot(p, uLightDir), uSeedOffset, uTimeDays);
  // Clear weather occupies most rays on sparse decks. Skip all eight
  // billow samples, eclipse queries and air transport where no condensate
  // exists, rather than calculating them only to multiply by zero opacity.
  if (cloud.x <= 0.0) return;
  float fraction = path / max(fullSegment.y - fullSegment.x, 1e-6);
  float mask = 1.0 - exp(-uCloudOpticalDepth * max(cloud.x, 0.0) * fraction);
  if (volumeWeight > 0.001) {
    vec3 volume = cloudVolume(rayDir, segment, cloud, uSeedOffset, uTimeDays);
    mask = mix(mask, volume.x, volumeWeight);
  }
  // This is a volume interval, not one continuous height surface. Its
  // midpoint and sampled height jump at grazing/depth boundaries. Shade
  // against the layer normal; actual billows still determine opacity.
  vec3 cloudNormal = p;

  // Radially-lit tops through the thin air above the deck: bright by
  // day, reddened at the terminator, eclipsed under a moon's shadow.
  float shadow = shadowFactor(shellPoint, uLightDir, uStarAngularRadius, 1e30);
  float pointAlt = length(shellPoint) - uPlanetRadius;
  vec3 light = surfaceLightAt(pointAlt, uLightDir, uLightColor, cloudNormal, p, shadow, diffuseShadow(shadow));
  if (secondSunLit()) {
    float shadow2 = shadowFactor(shellPoint, uLight2Dir, uStar2AngularRadius, uLight2Reach);
    light += surfaceLightAt(pointAlt, uLight2Dir, uLight2Color, cloudNormal, p, shadow2, diffuseShadow(shadow2));
  }
  vec3 color = uCloudColor * mix(0.65, 1.12, cloud.z) * light;
  // Below the deck we see transmitted diffuse flux, not an arbitrary shaded
  // copy of the sunlit top. An optically thick scattering slab passes roughly
  // 1/(1+3τ/4) of the incident diffuse field.
  float aboveDeck = step(length(shellPoint), length(cameraPosition));
  float deckTau = uCloudOpticalDepth * max(cloud.x, 1e-4);
  float deckTransmission = 1.0 / (1.0 + 0.75 * deckTau);
  color *= mix(displayTransmittance(deckTransmission), 1.0, aboveDeck);
  // Seen through the air between the eye and the deck.
  float eyeAlt = length(cameraPosition) - uPlanetRadius;
  float viewDistance = distance(cameraPosition, shellPoint);
  vec3 column = gasSegmentColumn(
      uSurfaceRayleighDepth,
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
      -uSurfaceRayleighDepth * gasColumnAt(midAlt)
        * airmassFor(dot(midUp, uLightDir), uHorizonAirmass)
      -uSurfaceAerosolDepth * exp(-midAlt / max(uAerosolScaleHeight, 1e-4))
        * airmassFor(dot(midUp, uLightDir), uAerosolHorizonAirmass)
    ) * (1.0 - exp(-column))
    * twilight(dot(midUp, uLightDir)) * airShadow;
  // A direct beam seen from above follows Beer-Lambert. Beneath a cloud,
  // photons arrive as a diffuse field and scattering redirects rather than
  // simply destroying them, so use the slab transport solution. The sky dome
  // owns foreground air scatter below the deck and is cloud-masked there.
  color = mix(
    color * displayTransmittance(diffuseTransmittance(column)),
    color * exp(-column) + scatter,
    aboveDeck
  );

  // Finite path opacity is continuous on entry; there is no camera-distance
  // fade that makes a cloud disappear while the observer is inside it.
  gl_FragColor = vec4(mix(background.rgb, color, mask), background.a);
}
`;

/**
 * The focus planet's cloud deck at its characterized altitude. Terrain
 * occlusion is supplied by CloudPass, not an artificial clearance height.
 */
export function cloudShellBounds(
  physical: Characterization,
): { baseKm: number; topKm: number } | null {
  if (
    physical.atmosphere.class === 'none' ||
    physical.appearance.clouds.coverage < 0.01
  ) return null;
  const topKm = Math.max(0.001, physical.appearance.clouds.topAltitudeKm);
  return {
    topKm,
    baseKm: Math.max(
      0,
      topKm - physical.appearance.clouds.thicknessKm,
    ),
  };
}

export function createCloudShell(
  physical: Characterization,
  radiusKm: number,
): Mesh | null {
  const { appearance, atmosphere, bulk } = physical;
  const bounds = cloudShellBounds(physical);
  if (!bounds) return null;
  const { baseKm, topKm: deckKm } = bounds;
  const column = atmosphereColumn(
    atmosphere,
    bulk,
    aerosolSurfaceExposure(atmosphere, physical.climate.iceCapLatitudeRad),
  );
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uSceneColor: { value: null },
      uSceneDepth: { value: null },
      uInverseProjection: { value: new Matrix4() },
      ...createShadowUniforms(),
      ...cloudPatternUniforms(physical),
      ...surfaceLightUniforms({
        ...column,
        gasProfile: bodyGasProfile(physical),
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
    blending: NoBlending,
    depthTest: true,
    depthFunc: AlwaysDepth,
    depthWrite: true,
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const shell = new Mesh(geometry, material);
  shell.frustumCulled = false;
  return shell;
}
