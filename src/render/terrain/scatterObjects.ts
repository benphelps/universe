import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  ShaderMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TreeSpecies } from '../../universe/surface/flora';
import { SECOND_SUN_GLSL, secondSunUniforms } from '../lighting/secondSun';
import { SURFACE_LIGHT_GLSL, surfaceLightUniforms } from '../lighting/surfaceLight';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { createShadowUniforms, SHADOW_GLSL } from '../planet/shadows';

const VERTEX = /* glsl */ `
attribute vec3 color;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorldPos;

void main() {
  vec4 local = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    n = mat3(instanceMatrix) * n;
  #endif
  // Baked per-vertex color (bark vs canopy) tinted by the instance.
  #ifdef USE_INSTANCING_COLOR
    vColor = color * instanceColor;
  #else
    vColor = color * vec3(0.4);
  #endif
  // Chunk-anchored groups never rotate: model rotation is identity.
  vNormal = normalize(n);
  // Directions and shadow rays only — see terrainMaterial.
  vWorldPos = (modelMatrix * local).xyz;
  // Through modelViewMatrix (CPU-composed camera-relative in f64), never
  // via a materialized f32 world position — see terrainMaterial.
  vec4 mvPosition = modelViewMatrix * local;
  vViewPos = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorldPos;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
${SECOND_SUN_GLSL}

${SIMPLEX_NOISE_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 up = normalize(vWorldPos);
  float shadow = shadowFactor(vWorldPos, uLightDir, uStarAngularRadius, 1e30);
  vec3 light = surfaceLight(uOpticalDepth, uLightDir, uLightColor, normal, up, shadow, diffuseShadow(shadow));
  bool lit2 = secondSunLit();
  if (lit2) {
    float shadow2 = shadowFactor(vWorldPos, uLight2Dir, uStar2AngularRadius, uLight2Reach);
    light += surfaceLight(uOpticalDepth, uLight2Dir, uLight2Color, normal, up, shadow2, diffuseShadow(shadow2));
  }
  vec3 color = vColor * (light + uNightFloor);
  // Aerial perspective: the air along the run to the eye keeps some of
  // the ground's light and adds the sunlight it scatters — blue by day,
  // red under a low sun, nothing in a vacuum.
  float eyeAlt = length(cameraPosition) - uPlanetRadius;
  float pointAlt = length(vWorldPos) - uPlanetRadius;
  float run = length(vViewPos);
  vec3 column = airSegmentColumn(eyeAlt, pointAlt, run);
  vec3 midUp = normalize(0.5 * (cameraPosition + vWorldPos));
  vec3 midPoint = 0.5 * (cameraPosition + vWorldPos);
  vec3 toEye = normalize(cameraPosition - vWorldPos);
  float airShadow = shadowFactor(midPoint, uLightDir, uStarAngularRadius, 1e30);
  vec3 seen = color * exp(-column)
    + uLightColor * airSegmentScatter(column, 0.5 * (eyeAlt + pointAlt), dot(midUp, uLightDir), -dot(toEye, uLightDir)) * airShadow;
  if (lit2) {
    float airShadow2 = shadowFactor(midPoint, uLight2Dir, uStar2AngularRadius, uLight2Reach);
    seen += uLight2Color * airSegmentScatter(column, 0.5 * (eyeAlt + pointAlt), dot(midUp, uLight2Dir), -dot(toEye, uLight2Dir)) * airShadow2;
  }
  gl_FragColor = vec4(seen, 1.0);
}
`;

/** Shared by every scatter instance; per-frame uniforms set by the viewer. */
export function createScatterMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      ...surfaceLightUniforms(),
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
    },
  });
}

/** Fill a geometry's vertex-color attribute with one flat color. */
function bakeColor(geometry: BufferGeometry, r: number, g: number, b: number): void {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
}

/** Deterministically lumpy unit rock, shared by every boulder instance.
 *  Dense enough to stand next to: the walker sees these at arm's reach. */
export function createRockGeometry(): BufferGeometry {
  const geometry = new IcosahedronGeometry(0.55, 2);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    // Hash-displaced vertices: irregular but identical every run.
    const wobble =
      1 +
      0.3 * Math.sin(x * 37.7 + y * 17.3 + z * 51.1) +
      0.16 * Math.sin(x * 91.3 - z * 63.7) +
      0.07 * Math.sin(x * 171.1 + y * 133.7 + z * 89.3);
    positions.setXYZ(i, x * wobble, y * wobble * 0.8, z * wobble);
  }
  geometry.computeVertexNormals();
  bakeColor(geometry, 1, 1, 1);
  return geometry;
}

/**
 * One tree species grown from its numeric recipe, at unit trunk height
 * (the instance scale is the tree's height in meters). Bark and canopy
 * colors are baked per vertex; instances tint with a neutral tone.
 */
export function createTreeGeometry(species: TreeSpecies): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // Non-indexed to match the polyhedron blobs, or the merge refuses.
  const trunk = new CylinderGeometry(0.035, 0.06, 0.68, 5, 1).toNonIndexed();
  trunk.translate(0, 0.34, 0);
  bakeColor(trunk, ...species.barkColor);
  parts.push(trunk);

  const spread = species.canopySpread;
  for (let b = 0; b < species.blobs; b++) {
    const angle = (b / species.blobs) * 2 * Math.PI + species.trunkHM;
    const blobR = spread * (species.blobs === 1 ? 1 : 0.62);
    const blob = new IcosahedronGeometry(blobR, 1);
    const positions = blob.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const wobble = 1 + 0.22 * Math.sin(x * 47.9 + y * 31.1 + z * 67.3 + b * 2.1);
      positions.setXYZ(i, x * wobble, y * wobble * species.canopyTaper, z * wobble);
    }
    const offset = species.blobs === 1 ? 0 : spread * 0.45;
    blob.translate(
      Math.cos(angle) * offset,
      0.62 + blobR * species.canopyTaper * 0.5 + (b % 2) * spread * 0.2,
      Math.sin(angle) * offset,
    );
    blob.computeVertexNormals();
    const shade = 0.82 + 0.3 * ((b * 0.37) % 0.6);
    bakeColor(
      blob,
      species.canopyColor[0] * shade,
      species.canopyColor[1] * shade,
      species.canopyColor[2] * shade,
    );
    parts.push(blob);
  }
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

/** Broad low tuft for ground cover, shared by every shrub instance. */
export function createShrubGeometry(): BufferGeometry {
  const geometry = new IcosahedronGeometry(0.6, 1);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const wobble = 1 + 0.42 * Math.sin(x * 53.9 + y * 29.1 + z * 77.3);
    positions.setXYZ(i, x * wobble, Math.max(-0.1, y * 0.55 * wobble), z * wobble);
  }
  geometry.computeVertexNormals();
  bakeColor(geometry, 1, 1, 1);
  return geometry;
}
