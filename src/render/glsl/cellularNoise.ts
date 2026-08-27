/**
 * 3D Worley cellular noise: distances to the nearest (F1) and
 * second-nearest (F2) feature points. F2−F1 vanishes exactly on the
 * boundaries between cells, which is what fractured crust actually
 * looks like — polygonal plates with thin seams, not noise ridges.
 */
export const CELLULAR_GLSL = /* glsl */ `
vec3 cellHash3(vec3 c) {
  c = vec3(
    dot(c, vec3(127.1, 311.7, 74.7)),
    dot(c, vec3(269.5, 183.3, 246.1)),
    dot(c, vec3(113.5, 271.9, 124.6))
  );
  return fract(sin(c) * 43758.5453123);
}

vec2 cellularF12(vec3 p) {
  vec3 base = floor(p);
  vec3 f = p - base;
  float f1 = 8.0;
  float f2 = 8.0;
  for (int k = -1; k <= 1; k++) {
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec3 offset = vec3(float(i), float(j), float(k));
        vec3 point = offset + cellHash3(base + offset) - f;
        float d = dot(point, point);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
  }
  return sqrt(vec2(f1, f2));
}
`;
