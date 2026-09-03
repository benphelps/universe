/** Close-range integration through a shallow spherical cloud layer.
 * The caller supplies the shared large-scale deck sample; this adds a
 * vertical profile and billowing cells without changing the orbit view. */
export const CLOUD_VOLUME_GLSL = /* glsl */ `
uniform float uCloudInnerRadius;
uniform float uCloudOuterRadius;

float raySphereNear(vec3 origin, vec3 dir, float radius) {
  float b = dot(origin, dir);
  float discriminant = b * b - (dot(origin, origin) - radius * radius);
  return discriminant < 0.0 ? -1.0 : -b - sqrt(discriminant);
}

float raySphereFar(vec3 origin, vec3 dir, float radius) {
  float b = dot(origin, dir);
  float discriminant = b * b - (dot(origin, origin) - radius * radius);
  return discriminant < 0.0 ? -1.0 : -b + sqrt(discriminant);
}

// Recover the analytic cloud boundary hit from the view ray. A rasterized
// sphere is made of flat chords: using its interpolated fragment position
// directly lets the centre of each polygon sag below a shallow cloud layer,
// exposing the mesh as a regular field of circular holes.
vec3 cloudOuterPoint(vec3 rasterPoint) {
  vec3 rayDir = normalize(rasterPoint - cameraPosition);
  float cameraRadius = length(cameraPosition);
  float hit = cameraRadius > uCloudOuterRadius
    ? raySphereNear(cameraPosition, rayDir, uCloudOuterRadius)
    : raySphereFar(cameraPosition, rayDir, uCloudOuterRadius);
  return hit >= 0.0 ? cameraPosition + rayDir * hit : rasterPoint;
}

vec3 cloudVolume(vec3 outerPoint, vec3 deck, vec3 seedOffset, float timeDays) {
  vec3 rayDir = normalize(outerPoint - cameraPosition);
  float cameraRadius = length(cameraPosition);
  float outerNear = raySphereNear(cameraPosition, rayDir, uCloudOuterRadius);
  float outerFar = raySphereFar(cameraPosition, rayDir, uCloudOuterRadius);
  float innerNear = raySphereNear(cameraPosition, rayDir, uCloudInnerRadius);
  float innerFar = raySphereFar(cameraPosition, rayDir, uCloudInnerRadius);
  float startDistance;
  float endDistance;

  if (cameraRadius > uCloudOuterRadius) {
    // From orbit, integrate the near cloud segment. If the ray only
    // grazes the shell, its far outer hit closes the segment instead.
    startDistance = max(outerNear, 0.0);
    endDistance = innerNear > startDistance ? innerNear : outerFar;
  } else if (cameraRadius >= uCloudInnerRadius) {
    // Inside the layer, march only until the first boundary in view.
    startDistance = 0.0;
    endDistance = innerNear > 0.0 ? innerNear : outerFar;
  } else {
    // Below the deck, begin where the sightline exits its empty interior.
    startDistance = max(innerFar, 0.0);
    endDistance = outerFar;
  }

  vec3 startPoint = cameraPosition + rayDir * startDistance;
  vec3 endPoint = cameraPosition + rayDir * max(endDistance, startDistance);
  float thickness = max(uCloudOuterRadius - uCloudInnerRadius, 0.1);
  float path = min(distance(startPoint, endPoint), 12.0 * thickness);
  endPoint = startPoint + rayDir * path;
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
