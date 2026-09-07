import { Color, IcosahedronGeometry, InstancedBufferAttribute, ShaderMaterial, Vector3 } from 'three';
import { AU } from '../../core/physics/constants';
import { AIR_VIEW_GLSL, airViewUniforms } from '../lighting/airView';
import { BELT_LOD_GLSL } from './beltLod';

export const BELT_ROCK_CAPACITY = 320;

const VERTEX = /* glsl */ `
attribute float aRadiusKm;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vReflectance;
varying float vWeight;
${BELT_LOD_GLSL}
void main() {
  vec4 local = instanceMatrix * vec4(position, 1.0);
  vWorldPos = (modelMatrix * local).xyz;
  // Inverse transpose of a rotation + nonuniform scale, without an
  // inverse per vertex. Multiplying the uncorrected normal by the
  // instance matrix distorts terminators on elongated bodies.
  mat3 axes = mat3(instanceMatrix);
  vec3 n = normal / vec3(dot(axes[0], axes[0]), dot(axes[1], axes[1]), dot(axes[2], axes[2]));
  vNormal = mat3(modelMatrix) * axes * n;
  vReflectance = instanceColor;
  vec3 centerView = (modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vWeight = beltMeshWeight(aRadiusKm / max(length(centerView), 1e-9));
  gl_Position = projectionMatrix * modelViewMatrix * local;
}
`;
const FRAGMENT = /* glsl */ `
uniform vec3 uHostPositionKm;
uniform vec3 uHostLightAtAu;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vReflectance;
varying float vWeight;
${AIR_VIEW_GLSL}
void main() {
  // Opaque dither keeps depth occlusion through the glint/mesh handoff.
  float threshold = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (vWeight <= threshold) discard;
  vec3 toHost = uHostPositionKm - vWorldPos;
  float distanceAu = max(length(toHost) / ${(AU / 1000).toFixed(3)}, 1e-9);
  vec3 light = uHostLightAtAu * (1.0 / (distanceAu * distanceAu));
  float diffuse = max(dot(normalize(vNormal), normalize(toHost)), 0.0);
  gl_FragColor = vec4(vReflectance * light * diffuse * airTransmittanceTo(vWorldPos), 1.0);
}
`;

/** Independent illumination for resolved belt members, never ground-scatter state. */
export function createBeltRockMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
    uniforms: {
      uHostPositionKm: { value: new Vector3() },
      uHostLightAtAu: { value: new Color(0, 0, 0) },
      ...airViewUniforms(),
    },
  });
}

/** A bounded coarse silhouette. Fine seeded topography arrives on focus. */
export function createBeltRockGeometry(): IcosahedronGeometry {
  const geometry = new IcosahedronGeometry(1, 2);
  geometry.setAttribute('aRadiusKm', new InstancedBufferAttribute(new Float32Array(BELT_ROCK_CAPACITY), 1));
  return geometry;
}
