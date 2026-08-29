/**
 * Null geodesics in the Schwarzschild metric, traced backwards from
 * the eye, one ray per pixel.
 *
 * Lengths are gravitational radii (r_g = GM/c², so M = 1): the geometry
 * has no other scale, and a hole of any mass is the same picture blown
 * up. In those units the orbit of a photon obeys
 *
 *     d²x/dλ² = −3 b² x / r⁵ ,   b = |x × dx/dλ| ,
 *
 * which is the Binet equation u″ + u = 3u² written in Cartesian form —
 * exact for null geodesics, not an approximation, and well behaved for
 * radial rays where the angle-parameterised version is not. The affine
 * parameter is normalised so the conserved energy is 1, which makes b
 * exactly the impact parameter and lets |dx/dλ| grow as 1 + 2b²/r³ near
 * the hole the way it should.
 *
 * What comes out of that, with nothing else added: the shadow (every
 * ray with b < 3√3 ends on the horizon), the photon ring stacked at its
 * edge from rays that wind one or more times before escaping, the
 * Einstein ring of whatever is behind, and the accretion flow's far
 * side lifted into view over the top of the hole and under the bottom,
 * because the rays that reach the eye from there went over and under.
 *
 * Rotation is carried by the disc, not the metric: the flow's inner
 * edge, its radiative efficiency and its orbital speeds all come from
 * the Kerr model, while ray propagation is Schwarzschild. Frame
 * dragging therefore does not skew the shadow — at the spins a fed
 * hole reaches, that is a few percent of the shadow's radius. The
 * flow's inner edge is held at the traced metric's marginally bound
 * orbit for the same reason: a Kerr disc reaches closer than
 * Schwarzschild supports a circular orbit at all.
 */
/**
 * Innermost radius the accretion flow is drawn from, r_g: the
 * marginally bound circular orbit of the traced metric. Inside it
 * Schwarzschild admits no bound circular orbit — material there is
 * plunging, and treating it as orbiting sends the Doppler factor
 * through infinity. A rapid Kerr disc's real inner edge lies inside
 * this, so spin's effect on the size of the inner hole is compressed
 * rather than lost: 4 r_g at high spin against 6 at none.
 */
export const RENDER_INNER_FLOOR_RG = 4;

/**
 * How far out the flow is drawn, in units of its own inner radius.
 *
 * A cold disc's true outer edge is where its own gravity fragments it
 * into stars — thousands of r_g out, hundreds of times the shadow. But
 * σT⁴ ∝ r^−3 puts five sixths of its light inside a dozen inner radii,
 * and the cold decades past that carry a few percent of the luminosity
 * across nearly all of the area. Drawn, they are an opaque plane that
 * swallows the frame and leaves the hole a speck in the middle of it;
 * that is why no photograph, render or GRMHD simulation of an accretion
 * disc shows them either. A hot flow has faded four orders of magnitude
 * by the same radius, so the limit costs it nothing. The model keeps
 * the true edge — this is what a picture of it holds.
 */
export const FLOW_DRAW_SPAN = 12;

/**
 * How steeply the flow's *source* falls off on screen: σT⁴ compressed
 * to r^−1. What reaches the eye falls faster than that wherever the
 * flow has gone translucent, because a thinning column emits less of
 * what it holds — so the picture's own falloff is this plus the
 * opacity's, and it is the source alone that is compressed.
 *
 * This is the one presentation choice in the whole render. Physically
 * the flow falls as σT⁴, which across a hot torus is five decades and
 * across a thin disc out to its self-gravity radius is eleven — further
 * than any screen reaches, and a linear exposure shows either the inner
 * edge or nothing. Fixing the falloff instead of the exposure gives
 * both regimes the same readable contrast without either being told
 * what its temperatures are. Nothing else is bent: colour is the
 * shifted blackbody and the beaming stays δ⁴.
 */
export const DISPLAY_FALLOFF = 1.0;

/**
 * Display gamma on the flow's radial profile, from the profile's own
 * slope: T ∝ r^−p makes σT⁴ ∝ r^−4p, and this is the power that turns
 * that into r^−DISPLAY_FALLOFF.
 */
export function profileStretch(profileExponent: number): number {
  return Math.min(1, DISPLAY_FALLOFF / (4 * Math.max(profileExponent, 0.05)));
}

/**
 * Impact parameter, in r_g, out to which the hole draws the sky itself.
 *
 * Not where bending stops — that reaches thousands of r_g — but where
 * it stops being worth what it costs. A bent ray's background comes
 * from the cube map captured at the hole, and that is coarser than the
 * screen; taking over the sky buys a ray a deflection of 4/b radians
 * and charges it the cube's resolution. At 160 r_g the bend is still a
 * degree and a half and the sky around it is visibly wrapped, so the
 * trade is worth making. Much past that it is paying blur for a shift
 * of a pixel, which is what turns a sharp star field soft the moment
 * the camera crosses the boundary.
 */
export const LENSING_REACH_RG = 160;

export const GEODESIC_GLSL = /* glsl */ `
uniform vec3 uCamRg;
uniform mat3 uViewToBh;
uniform vec2 uTanHalfFov;

uniform float uInnerRg;
uniform float uInnerRenderRg;
uniform float uOuterRg;
uniform float uInnerTempK;
uniform float uProfileExp;
uniform float uEdgeTaper;
uniform float uOpticalDepth;
uniform float uOpacityExp;
uniform float uRefTempK;
uniform float uProfileStretch;
uniform float uTurbSigma;
uniform float uDiscGain;
uniform sampler2D uLut;

/** Horizon of the traced metric. Rays that reach it are gone. */
const float HORIZON = 2.0;
const float LENSING_REACH = ${LENSING_REACH_RG}.0;
/** 3√3: below this a ray has no turning point at all. */
const float CRITICAL_IMPACT = 5.19615242;
const int MAX_STEPS = 256;

/**
 * The flow's density where a ray crosses it, relative to the smooth
 * profile. The magnetorotational instability leaves accreting gas
 * clumped on a log-normal distribution, and differential rotation
 * draws every clump out into a trailing spiral — so the field is
 * sampled in coordinates that wind with the Keplerian shear and are
 * stretched along it, which is what turns blobs into filaments. The
 * range is clipped to the one or two sigma that simulated density
 * histograms actually span.
 */
float flowDensity(vec3 hit, float r) {
  float wind = 9.0 * pow(r / uInnerRenderRg, -1.5);
  float a = atan(hit.y, hit.x) + wind;
  // Sheared hard along the radius and stretched around it: turbulence
  // in a flow that orbits differentially is drawn out into filaments
  // far longer than they are wide, which is what banding is.
  vec3 q = vec3(6.5 * log(r), 4.0 * cos(a), 4.0 * sin(a));
  float xi = (snoise(q) + 0.5 * snoise(q * 2.7) + 0.25 * snoise(q * 6.1)) / 1.32;
  // Log-normal, with the −σ²/2 that keeps the mean density unchanged.
  return clamp(exp(uTurbSigma * xi - 0.5 * uTurbSigma * uTurbSigma), 0.2, 4.0);
}

/** The whole of the field equations, for a null ray: −3b²x/r⁵. */
vec3 pull(vec3 x, float b2) {
  float r2 = dot(x, x);
  return x * (-3.0 * b2 / (r2 * r2 * sqrt(r2)));
}

/** Blackbody hue at T, from the same mired-indexed table the stars use. */
vec3 lutColor(float tempK) {
  float mired = 1.0e6 / max(tempK, 1.0);
  return texture2D(uLut, vec2(clamp((mired - 20.0) / 980.0, 0.0, 1.0), 0.5)).rgb;
}

/**
 * How much flow is left at radius r, 0 to 1. The drawn edge is a limit
 * of the picture, not of the disc — the real one runs on out to where
 * its own gravity fragments it, still tens of thousands of degrees at
 * the radius drawn here — so the flow is thinned away rather than cut,
 * and thinned in substance: emission and opacity together, so it
 * dissolves and lets the sky through instead of ending in an opaque
 * dark rim it does not have.
 */
float flowPresence(float r) {
  if (r < uInnerRenderRg || r > uOuterRg) return 0.0;
  return 1.0 - smoothstep(0.5 * uOuterRg, uOuterRg, r);
}

/** Effective temperature of the flow at radius r, kelvin — the model's
 *  own profile, anchored on its own inner edge. */
float flowTemperature(float r) {
  if (r < uInnerRenderRg || r > uOuterRg) return 0.0;
  float taper = uEdgeTaper > 0.5
    ? pow(max(0.0, 1.0 - sqrt(uInnerRg / r)), 0.25)
    : 1.0;
  return uInnerTempK * pow(r / uInnerRg, -uProfileExp) * taper;
}

/**
 * What the eye sees along one ray: the flow it crosses, and the sky
 * behind wherever it escapes to. escaped tells the caller whether a
 * background sample is owed and in which direction — a captured ray
 * carries only the light it picked up before falling in.
 */
vec3 traceGeodesic(vec3 dir, out vec3 escapeDir, out bool escaped, out float transmittance) {
  vec3 cam = uCamRg;
  // A camera lying exactly in the disc plane would have every ray stay
  // in it and never register a crossing.
  if (abs(cam.z) < 1.0e-4) cam.z = 1.0e-4;
  float camR = length(cam);
  vec3 camHat = cam / camR;

  // Impact parameter as the static observer at the camera measures it:
  // b = r sinψ / √(1 − 2/r), with ψ the angle off the outward radial.
  float cosPsi = dot(dir, camHat);
  vec3 tangent = dir - cosPsi * camHat;
  float sinPsi = length(tangent);
  float lapse = sqrt(max(1.0 - HORIZON / camR, 1.0e-6));
  float b = camR * sinPsi / lapse;

  escapeDir = dir;
  escaped = true;
  transmittance = 1.0;
  if (b > LENSING_REACH) return vec3(0.0);

  vec3 tHat = sinPsi > 1.0e-9 ? tangent / sinPsi : normalize(cross(camHat, vec3(0.0, 0.0, 1.0)));
  vec3 hHat = normalize(cross(camHat, tHat));

  // Far from the hole a ray is a straight line to one part in r/b, so
  // the integration starts where bending begins: keeping every
  // coordinate within a few thousand r_g is what lets a camera eight
  // kiloparsecs out still resolve a shadow a light-hour across.
  float reach = max(max(320.0, 24.0 * b), 1.3 * uOuterRg);
  vec3 pos;
  vec3 vel;
  if (camR <= reach) {
    pos = cam;
    vel = cosPsi * camHat + (b / camR) * tHat;
  } else {
    float tClose = -dot(cam, dir);
    float entry = tClose - sqrt(max(reach * reach - b * b, 0.0));
    pos = cam + dir * max(entry, 0.0);
    float r = length(pos);
    vec3 rHat = pos / r;
    vec3 rTan = normalize(cross(hHat, rHat));
    float radial = -sqrt(max(1.0 - (1.0 - HORIZON / r) * b * b / (r * r), 0.0));
    vel = radial * rHat + (b / r) * rTan;
  }

  // The photon's angular momentum about the spin axis, per unit
  // energy. The trace runs against the photon's flight, so the sign
  // flips: this is what decides which limb of the flow is approaching.
  float bAxis = -b * hHat.z;
  float b2 = b * b;

  // The shadow, exactly. Below the critical impact parameter the
  // effective potential has no turning point, so a ray already falling
  // inward can only reach the horizon — no amount of integration will
  // change that, and asserting it keeps the shadow's edge analytic
  // instead of leaving it to whatever the arithmetic does while a ray
  // hovers at the photon sphere.
  bool doomed = b < CRITICAL_IMPACT && dot(pos, vel) < 0.0;

  vec3 accum = vec3(0.0);
  vec3 prev = pos;
  vec3 prevVel = vel;
  bool settled = false;

  for (int i = 0; i < MAX_STEPS; i++) {
    float r = length(pos);
    if (r < HORIZON) { escaped = false; settled = true; break; }
    // A doomed ray only ever moves inward: once it is under the flow
    // there is nothing left for it to pick up.
    if (doomed && r < uInnerRenderRg) { escaped = false; settled = true; break; }
    if (!doomed && r > reach && dot(pos, vel) > 0.0) { settled = true; break; }

    // Steps scale with radius: coarse where the ray is straight, fine
    // where it winds. The r^-5 pull is stiff and RK4 earns its cost.
    float dt = clamp(0.11 * (r - 1.55), 0.02, 0.12 * reach);
    vec3 k1v = pull(pos, b2);
    vec3 p2 = pos + vel * (dt * 0.5);
    vec3 k2v = pull(p2, b2);
    vec3 v2 = vel + k1v * (dt * 0.5);
    vec3 p3 = pos + v2 * (dt * 0.5);
    vec3 k3v = pull(p3, b2);
    vec3 v3 = vel + k2v * (dt * 0.5);
    vec3 p4 = pos + v3 * dt;
    vec3 k4v = pull(p4, b2);
    vec3 v4 = vel + k3v * dt;

    prev = pos;
    prevVel = vel;
    pos += (dt / 6.0) * (vel + 2.0 * v2 + 2.0 * v3 + v4);
    vel += (dt / 6.0) * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);

    // The equatorial flow is the z = 0 plane of this frame; the step
    // that changes the sign of z crossed it.
    if (prev.z * pos.z < 0.0) {
      float f = prev.z / (prev.z - pos.z);
      vec3 hit = mix(prev, pos, f);
      float rHit = length(hit);
      float tEmit = flowTemperature(rHit);
      float presence = flowPresence(rHit);
      if (tEmit > 0.0 && presence > 0.002) {
        // Where the gas piles up it dissipates more and radiates
        // hotter: an optically thick surface emits σT⁴ per unit area
        // whatever its density, so a clump shows as the fourth root of
        // itself in temperature — and, through T⁴, as itself in
        // brightness. The same clump thickens the column.
        float density = flowDensity(hit, rHit);
        tEmit *= pow(density, 0.25);
        // Doppler and gravity in one factor: g = √(1 − 3/r) / (1 − Ω b_z),
        // the ratio of received to emitted frequency for a circular
        // geodesic seen from infinity. A blackbody stays a blackbody
        // under it, at temperature gT — so the shift is the colour and,
        // through σ(gT)⁴, the beaming as well.
        float omega = 1.0 / (rHit * sqrt(rHit));
        // Orbital speed reaches 1/√2 at the innermost radius drawn, so
        // the shift factor is bounded — the clamp is only a guard.
        float g = sqrt(max(1.0 - 3.0 / rHit, 1.0e-4)) / max(1.0 - omega * bAxis, 0.15);
        float tObs = g * tEmit;
        vec3 through = normalize(mix(prevVel, vel, f));
        float slant = max(abs(through.z), 0.04);
        // Column through the flow: its vertical depth thinned by the
        // radial fall-off, stretched by how obliquely the ray cuts it.
        float column =
          uOpticalDepth * pow(rHit / uInnerRenderRg, -uOpacityExp) * presence * density;
        float alpha = 1.0 - exp(-column / slant);
        // Brightness splits in two. The radial profile carries the
        // flow's own σT⁴ from its inner edge outward, and between the
        // edges that is four or more decades — further than any single
        // exposure reaches, so it is shown under the gamma stretch
        // every published image of an accretion flow uses. The Doppler
        // and gravitational shift is left alone at its full δ⁴, so the
        // beaming asymmetry on screen is the physical one and not a
        // curve: what is compressed is the radius, never the physics.
        float emitted = tEmit / uRefTempK;
        float profile = emitted * emitted * emitted * emitted;
        float shown = pow(profile, uProfileStretch);
        float shift = tObs / max(tEmit, 1.0);
        float beamed = shift * shift * shift * shift;
        accum += transmittance * alpha * lutColor(tObs) * shown * beamed * uDiscGain;
        transmittance *= 1.0 - alpha;
        if (transmittance < 0.004) { escaped = false; settled = true; break; }
      }
    }
  }

  // A ray still circling when the step budget runs out is one of the
  // near-critical ones that wind many times: those fall in.
  if (!settled || doomed) escaped = false;
  escapeDir = normalize(vel);
  return accum;
}
`;
