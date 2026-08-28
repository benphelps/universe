import {
  BufferAttribute,
  BufferGeometry,
  Points,
  ShaderMaterial,
} from 'three';
import type { GalacticLandmark } from '../../universe/galaxy/regions';

const VERTEX = /* glsl */ `
attribute float aSize;
varying float vSize;

void main() {
  vSize = aSize;
  gl_PointSize = aSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Reversed-Z far plane sits at z = 0: pin inside, like the sky
  // (see neighborStars on the floor value).
  gl_Position.z = clamp(gl_Position.z, 1e-24 * gl_Position.w, gl_Position.w);
}
`;

const FRAGMENT = /* glsl */ `
varying float vSize;

void main() {
  // Map ink, not light: a hollow diamond.
  vec2 c = abs(2.0 * gl_PointCoord - 1.0);
  float d = c.x + c.y;
  float edge = 2.5 / vSize;
  float ring = smoothstep(1.0, 1.0 - edge, d) * smoothstep(0.55 - edge, 0.55, d);
  if (ring < 0.05) discard;
  gl_FragColor = vec4(0.62, 0.68, 0.78, ring * 0.85);
}
`;

/** Chart markers for the galaxy's landmark complexes: hollow diamonds
 *  in the sky's pc frame, sized by territorial prominence. */
export function createLandmarkMarkers(
  landmarks: GalacticLandmark[],
  scenePc: Float32Array,
): Points {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(scenePc, 3));
  const sizes = new Float32Array(landmarks.length);
  for (let i = 0; i < landmarks.length; i++) {
    sizes[i] = 7 + 4 * Math.max(0, landmarks[i].weight - 0.6);
  }
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  const points = new Points(
    geometry,
    new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }),
  );
  points.frustumCulled = false;
  points.renderOrder = -4;
  return points;
}
