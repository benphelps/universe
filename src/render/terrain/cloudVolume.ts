/** First visible interval in a spherical cloud layer, clipped to solid depth.
 * A ray below the layer starts at its inner exit; an orbit ray stops at its
 * first inner entry. The opaque body hides the opposite side of the shell. */
export const CLOUD_VOLUME_GLSL = /* glsl */ `
uniform float uCloudInnerRadius;
uniform float uCloudOuterRadius;

vec2 cloudSphereInterval(vec3 origin, vec3 dir, float radius) {
  float b = dot(origin, dir);
  float r = length(origin);
  // Factoring the radial difference avoids subtracting squared planetary
  // radii when the observer is just metres from a cloud boundary.
  float c = (r - radius) * (r + radius);
  float discriminant = b * b - c;
  if (discriminant < 0.0) return vec2(1e30, -1e30);
  float q = -b - (b >= 0.0 ? sqrt(discriminant) : -sqrt(discriminant));
  if (abs(q) < 1e-8) return vec2(-b);
  return vec2(min(q, c / q), max(q, c / q));
}

vec2 cloudRaySegment(vec3 origin, vec3 dir, float maxDistance) {
  vec2 outer = cloudSphereInterval(origin, dir, uCloudOuterRadius);
  vec2 inner = cloudSphereInterval(origin, dir, uCloudInnerRadius);
  float start = max(0.0, outer.x);
  float end = min(maxDistance, outer.y);
  if (inner.x < inner.y) {
    if (inner.x > start) end = min(end, inner.x);
    else if (inner.y > start) start = inner.y;
  }
  return vec2(start, max(start, end));
}

vec3 cloudVolume(vec3 rayDir, vec2 segment, vec3 deck, vec3 seedOffset, float timeDays) {
  vec3 startPoint = cameraPosition + rayDir * segment.x;
  float thickness = max(uCloudOuterRadius - uCloudInnerRadius, 0.001);
  float path = min(segment.y - segment.x, 12.0 * thickness);
  vec3 endPoint = startPoint + rayDir * path;
  float integrated = 0.0;
  float heightSum = 0.0;
  const int STEPS = 8;
  for (int i = 0; i < STEPS; i++) {
    float along = (float(i) + 0.5) / float(STEPS);
    vec3 samplePoint = mix(startPoint, endPoint, along);
    float h = clamp((length(samplePoint) - uCloudInnerRadius) / thickness, 0.0, 1.0);
    float top = clamp(0.28 + 0.72 * deck.y, 0.18, 1.0);
    float vertical = smoothstep(0.0, 0.13, h)
      * (1.0 - smoothstep(max(top - 0.22, 0.02), top, h));
    vec3 cellP = normalize(samplePoint) * uCloudScale * 6.5
      + seedOffset.yzx + vec3(0.0, h * 3.2, timeDays * uCloudDrift * 0.06);
    float cell = 0.5 + 0.5 * snoise(cellP);
    float footprintFade = smoothstep(0.0, 0.8, deck.x);
    float billow = footprintFade
      * smoothstep(0.08, 0.9, 0.58 * deck.x + 0.42 * cell);
    float density = vertical * billow;
    integrated += density;
    heightSum += density * h;
  }
  float pathInLayers = path / thickness;
  float tau = uCloudOpticalDepth * integrated / float(STEPS) * pathInLayers;
  float opacity = 1.0 - exp(-0.55 * tau);
  float meanHeight = integrated > 1e-4 ? heightSum / integrated : deck.y;
  return vec3(opacity, meanHeight, integrated / float(STEPS));
}
`;
