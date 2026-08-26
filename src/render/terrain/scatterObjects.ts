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
import { secondSunUniforms } from '../lighting/secondSun';

const VERTEX = /* glsl */ `
attribute vec3 color;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vViewPos;

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

uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;
uniform vec3 uFogColor;
uniform float uFogDensity;

void main() {
  float diffuse = max(dot(normalize(vNormal), uLightDir), 0.0);
  float diffuse2 = max(dot(normalize(vNormal), uLight2Dir), 0.0);
  vec3 color = vColor * (uLightColor * (diffuse + 0.02) + uLight2Color * diffuse2);
  float fog = 1.0 - exp(-length(vViewPos) * uFogDensity);
  gl_FragColor = vec4(mix(color, uFogColor, fog), 1.0);
}
`;

/** Shared by every scatter instance; per-frame uniforms set by the viewer. */
export function createScatterMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      uFogColor: { value: new Color(0, 0, 0) },
      uFogDensity: { value: 0 },
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
