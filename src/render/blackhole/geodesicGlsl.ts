/**
 * Null geodesics in the Kerr metric, traced backwards from the eye, one
 * ray per pixel.
 *
 * Lengths are gravitational radii (r_g = GM/c², so M = 1): the geometry
 * has no other scale, and a hole of any mass is the same picture blown
 * up. The propagation is in kerrGlsl — Carter's separated equations in
 * Mino time, exact, with the constants of each ray read off the tetrad
 * of an actual observer at the camera. This file is what the rays are
 * for: where they start, what they cross, and what that looks like.
 *
 * What comes out of the integration, with nothing else added: the
 * shadow — a circle of 3√3 for a static hole, dragged into a D and
 * offset from the ring's centre as the spin rises — the photon ring
 * stacked at its edge from rays that wind before escaping, the Einstein
 * ring of whatever lies behind, and the accretion flow's far side
 * lifted into view over the top of the hole and under the bottom,
 * because the rays that reach the eye from there went over and under.
 *
 * Spin is now carried by the metric rather than by the disc alone, so
 * the flow's inner edge is the true Kerr innermost stable orbit — 1.24
 * r_g at the Thorne limit against 6 for a static hole — and the light
 * leaving it is bent by the same geometry that put it there.
 */

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
uniform float uAspect;
uniform float uFlowPhase;
uniform float uDiscGain;
uniform sampler2D uLut;

const float LENSING_REACH = ${LENSING_REACH_RG}.0;
const int MAX_STEPS = 384;
const float TAU = 6.28318531;
/**
 * How long a clump lasts, in orbits at the flow's inner edge. The
 * magnetorotational instability turns its eddies over in about one, so
 * this is not a rate of change chosen for the look of it — it is the
 * only timescale the flow has.
 */
const float EDDY_LIFETIME = 1.0;
/** Mino-time step, as a fraction of the fastest coordinate's rate. */
const float STEP_EPS = 0.045;
/** Half-thickness above which the flow is passed through rather than
 *  crossed. Cold discs sit near 0.02, ion tori at 0.55. */
const float THICK_FLOW = 0.15;
/**
 * Ceiling on how much the azimuth's rate may shrink the step.
 *
 * Near the spin axis dφ/dσ = ξ/sin²θ runs away, and it is a coordinate
 * that is running away, not the photon — the trajectory through there
 * is perfectly ordinary. But the azimuth is what decides where a ray
 * finally points, so it cannot simply be left coarse either: at a
 * ceiling of 24 the sky came out visibly wrong in a band a dozen pixels
 * wide up the axis. Six hundred costs five percent of the trace and
 * closes the band to the width of the caustic that genuinely lives
 * there.
 */
const float AXIS_RATE_CAP = 600.0;

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
float turbulentField(float r, float phi, float mu, float age, float generation) {
  float keplerian = pow(r / uInnerRenderRg, -1.5);
  // Three things move the pattern round. The static winding it is born
  // with; the flow's bulk rotation, which turns everything together and
  // so never shears; and the differential part, which is the only one
  // that combs the field into ever-finer filaments and is therefore the
  // only one allowed to accumulate without limit — it does not, because
  // the age it multiplies is reset each time this realisation is
  // reseeded.
  float a = phi + 9.0 * keplerian + TAU * uFlowPhase + TAU * age * (keplerian - 1.0);
  // Sheared hard along the radius and stretched around it: turbulence
  // in a flow that orbits differentially is drawn out into filaments
  // far longer than they are wide, which is what banding is. Height
  // enters in units of the flow's own thickness, so a thin disc is
  // sampled on a surface and a thick torus through its whole depth.
  vec3 q = vec3(6.5 * log(r), 4.0 * cos(a), 4.0 * sin(a));
  q += vec3(0.0, 0.0, 2.2 * mu / max(uAspect, 0.02));
  q += generation * vec3(17.3, -41.7, 29.1);
  return (snoise(q) + 0.5 * snoise(q * 2.7) + 0.25 * snoise(q * 6.1)) / 1.32;
}

/**
 * The flow's density where the ray meets it, relative to the smooth
 * profile — and how that changes while you watch.
 *
 * Accreting gas is not smooth. The magnetorotational instability, which
 * is what lets it accrete at all, leaves it clumped on a log-normal
 * distribution of the width simulations measure, and the shear draws
 * every clump into a trailing filament. Neither is it still: an eddy
 * turns over in about an orbit and is gone, replaced by another the
 * instability has just made, and at the innermost orbit of the hole at
 * this galaxy's centre that is a little over a minute.
 *
 * Advecting one frozen field would show the first half of that and not
 * the second — the pattern would shear without bound, stretching into
 * finer and finer threads that never renew, until the radial structure
 * fell below what can be resolved. So two realisations run half a
 * lifetime out of phase, each reseeded while it carries no weight, and
 * are blended so the variance is preserved rather than the mean, which
 * is what keeps the contrast steady across the handover. The bulk
 * rotation is applied to both alike and never resets, so the flow's own
 * turning stays continuous through it.
 */
float flowDensity(float r, float phi, float mu) {
  float t = uFlowPhase / EDDY_LIFETIME;
  float phase = fract(t);
  // The two generations are half a lifetime apart, and each carries no
  // weight at the moment it is reseeded — sine for the one born at the
  // whole turn, cosine for the one born at the half. Their squares sum
  // to one, so what is held constant across the handover is the
  // variance and not the mean: the clumping never dulls mid-crossfade.
  float wA = sin(3.14159265 * phase);
  float wB = cos(3.14159265 * phase);
  float xi =
    wA * turbulentField(r, phi, mu, phase * EDDY_LIFETIME, floor(t)) +
    wB * turbulentField(r, phi, mu, fract(phase + 0.5) * EDDY_LIFETIME, floor(t + 0.5));
  // Log-normal, with the −σ²/2 that keeps the mean density unchanged.
  return clamp(exp(uTurbSigma * xi - 0.5 * uTurbSigma * uTurbSigma), 0.2, 4.0);
}

/**
 * How much of the flow sits at height μ, per unit length, normalised so
 * that a column straight through it comes to exactly one.
 *
 * Vertical hydrostatic support gives a Gaussian of scale height h = εr,
 * and since z = rμ the profile in μ is the same at every radius — the
 * torus is a wedge, not a slab. Normalising the column is what lets a
 * volume and a sheet be compared: a ray crossing the midplane square on
 * collects exactly what the sheet would have given it, and every other
 * ray collects more, in proportion to how far it travelled through the
 * gas. That excess is not a liberty. It is why a hot flow shows a ring:
 * lines of sight that graze tangentially run through far more plasma
 * than those that punch through, and the limb lights up.
 */
float flowColumn(float r, float mu) {
  float e = max(uAspect, 0.02);
  float z = mu / e;
  return exp(-0.5 * z * z) / (2.5066282 * e * r);
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
 * Ratio of received to emitted frequency, g = 1/(−p·u), contracted
 * against the four-velocity the matter actually has.
 *
 * Very close to the horizon the matter is dragged round at the
 * horizon's own angular velocity, and against that a photon carrying
 * more angular momentum than 1/Ω_H would have to have been emitted with
 * negative energy in the gas's own frame. No such photon was emitted,
 * so none arrives: the honest answer there is no light at all, and
 * returning zero says exactly that. Clamping the denominator to
 * something small instead — the obvious guard — turns the one place
 * light cannot come from into the brightest thing on the screen.
 */
float shiftFactor(vec3 u, float xi, float dr, float r, float a) {
  float received = u.x - xi * u.y - dr * u.z / kerrDelta(r, a);
  return received > 1.0e-3 ? 1.0 / received : 0.0;
}

/** Boyer–Lindquist (r, μ) of a pseudo-Cartesian point. */
vec2 blFromCartesian(vec3 p, float a) {
  float t = dot(p, p) - a * a;
  float r2 = 0.5 * (t + sqrt(max(t * t + 4.0 * a * a * p.z * p.z, 0.0)));
  float r = sqrt(max(r2, 1.0e-12));
  return vec2(r, clamp(p.z / r, -1.0, 1.0));
}

/**
 * The pseudo-Cartesian direction the ray is travelling, from its
 * Boyer–Lindquist state — by stepping the state a little and
 * differencing, which costs less than the chain rule and cannot
 * disagree with the path actually integrated.
 */
vec3 kerrHeading(vec4 y, float phi, float a, float xi) {
  float h = 0.01 * y.x / max(abs(y.z), 1.0e-6);
  vec3 p0 = kerrPosition(y.x, y.y, phi, a);
  vec3 p1 = kerrPosition(
    y.x + h * y.z,
    clamp(y.y + h * y.w, -1.0, 1.0),
    phi + h * kerrPhiRate(y.x, y.y, a, xi),
    a
  );
  return p1 - p0;
}

/**
 * The size of one Mino-time step: small enough that no coordinate moves
 * far, in units of its own scale. Radius is measured against itself, so
 * steps grow with distance and a ray a thousand r_g out crosses in a
 * handful; angles are measured absolutely, so a ray winding the photon
 * ring is stepped finely however slowly its radius changes.
 */
float kerrStep(vec4 y, float a, float xi) {
  // The azimuth is a pure quadrature — nothing else reads it — so its
  // rate is allowed to inform the step but not to dominate it. Near
  // the axis sin²θ goes to nothing and dφ/dσ to a great deal, and
  // chasing that to convergence would spend a whole ray's budget
  // resolving a coordinate rather than a trajectory.
  float rate = abs(y.z) / max(y.x, 1.0)
    + abs(y.w)
    + min(abs(kerrPhiRate(y.x, y.y, a, xi)), AXIS_RATE_CAP);
  return STEP_EPS / max(rate, 1.0e-4);
}

/**
 * What the eye sees along one ray: the flow it crosses, and the sky
 * behind wherever it escapes to. escaped tells the caller whether a
 * background sample is owed and in which direction — a captured ray
 * carries only the light it picked up before falling in.
 */
vec3 traceGeodesic(vec3 dir, out vec3 escapeDir, out bool escaped, out float transmittance) {
  float a = uSpin;
  vec3 cam = uCamRg;
  // A camera lying exactly in the disc plane would have every ray stay
  // in it and never register a crossing.
  if (abs(cam.z) < 1.0e-4) cam.z = 1.0e-4;

  escapeDir = dir;
  escaped = true;
  transmittance = 1.0;

  // The photon travels toward the camera, against the trace. Its
  // constants come from the frame of an observer there — exactly, at
  // the camera's own position, however far out that is.
  vec2 camBl = blFromCartesian(cam, a);
  float camR = camBl.x;
  float camMu = camBl.y;
  float camPhi = atan(cam.y, cam.x);
  float sinT = sqrt(max(1.0 - camMu * camMu, 1.0e-12));
  float rho = sqrt(camR * camR + a * a);
  float cp = cos(camPhi);
  float sp = sin(camPhi);
  // The coordinate directions, which are orthogonal in this
  // reconstruction, normalised into the observer's own axes.
  vec3 rHat = normalize(vec3(camR / rho * sinT * cp, camR / rho * sinT * sp, camMu));
  vec3 tHat = normalize(vec3(rho * camMu * cp, rho * camMu * sp, -camR * sinT));
  vec3 pHat = vec3(-sp, cp, 0.0);
  vec3 arrive = -dir;
  vec3 n = normalize(vec3(dot(arrive, rHat), dot(arrive, tHat), dot(arrive, pHat)));

  vec4 photon = kerrPhoton(camR, camMu, a, n);
  float xi = photon.x;
  float eta = photon.y;
  float impact = sqrt(max(xi * xi + eta, 0.0));
  if (impact > LENSING_REACH) return vec3(0.0);

  // Where the trace begins and ends, set by the accuracy it owes
  // rather than by a round number. The bending still to come beyond
  // radius r is about b/r², so holding that under a fraction of a
  // milliradian — half a pixel of the sky cube — asks for r ≳ 40√b,
  // and that is the whole rule. It also has to start outside the drawn
  // flow, or the ray would begin already past what it should cross.
  //
  // The constants are the camera's exact ones however far out it sits;
  // only the starting point is approximated, and only where the
  // approximation costs less than the sky can show. A ray at the
  // shadow's edge now begins at ninety gravitational radii instead of
  // three hundred and twenty, which is most of the cost of the trace.
  float reach = max(40.0 * sqrt(max(impact, 0.01)), 1.3 * uOuterRg);
  vec4 y;
  float phi;
  if (camR <= reach) {
    y = vec4(camR, camMu, photon.z, photon.w);
    phi = camPhi;
  } else {
    float tClose = -dot(cam, dir);
    float entry = max(tClose - sqrt(max(reach * reach - impact * impact, 0.0)), 0.0);
    vec3 start = cam + dir * entry;
    vec2 bl = blFromCartesian(start, a);
    // Magnitudes from the potentials, which the constants satisfy
    // exactly; signs from the geometry. The photon is on its way out
    // to the camera here, so its radius is growing, and its polar
    // angle moves the way the straight line does.
    float mu2 = blFromCartesian(start - dir * (0.001 * reach), a).y;
    y = vec4(
      bl.x,
      bl.y,
      sqrt(max(kerrRadial(bl.x, xi, eta, a), 0.0)),
      sign(mu2 - bl.y) * sqrt(max(kerrPolar(bl.y, xi, eta, a), 0.0))
    );
    phi = atan(start.y, start.x);
  }

  // The shadow, exactly. A photon whose constants sit inside the
  // critical curve has no radial turning point outside the horizon, so
  // a trace already running inward can only end there — settled in
  // closed form rather than left to whatever the arithmetic does while
  // a ray hovers at the photon orbit.
  bool doomed = y.z > 0.0 && kerrCaptured(xi, eta, a);

  vec3 accum = vec3(0.0);
  bool settled = false;
  // The volume march re-reads the clumping only every few steps. What
  // it is integrating is a path through an optically thin torus, and
  // that path already averages over far more cells than one step
  // resolves — the fluctuations wash out of the answer whether they are
  // sampled finely or not, which is why a hot flow looks smooth and a
  // disc seen at one crossing does not.
  float heldDensity = 1.0;
  int held = 0;
  float horizon = uHorizonRg + 0.002;

  for (int i = 0; i < MAX_STEPS; i++) {
    float r = y.x;
    if (r < horizon) { escaped = false; settled = true; break; }
    // A doomed ray only ever moves inward: once it is under the flow
    // there is nothing left for it to pick up.
    if (doomed && r < uInnerRenderRg) { escaped = false; settled = true; break; }
    // Mino time runs backwards along the trace, so a ray on its way
    // out has a shrinking radius in the photon's own parameter.
    if (!doomed && r > reach && y.z < 0.0) { settled = true; break; }

    float ds = -kerrStep(y, a, xi);
    vec4 k1 = kerrRates(y, a, xi, eta);
    vec4 k2 = kerrRates(y + k1 * (ds * 0.5), a, xi, eta);
    vec4 k3 = kerrRates(y + k2 * (ds * 0.5), a, xi, eta);
    vec4 k4 = kerrRates(y + k3 * ds, a, xi, eta);
    float w1 = kerrPhiRate(y.x, y.y, a, xi);
    float w2 = kerrPhiRate(y.x + k1.x * ds * 0.5, y.y + k1.y * ds * 0.5, a, xi);
    float w3 = kerrPhiRate(y.x + k2.x * ds * 0.5, y.y + k2.y * ds * 0.5, a, xi);
    float w4 = kerrPhiRate(y.x + k3.x * ds, y.y + k3.y * ds, a, xi);

    vec4 prev = y;
    float prevPhi = phi;
    y = kerrProject(y + (ds / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4), a, xi, eta);
    phi += (ds / 6.0) * (w1 + 2.0 * w2 + 2.0 * w3 + w4);

    // A thick flow is passed through rather than crossed. A starved
    // hole puffs its gas into an ion torus half as deep as it is wide
    // and thin enough to see through, so there is no surface anywhere
    // to intersect: what reaches the eye is the whole column the ray
    // travelled, gathered step by step. This is the difference between
    // a picture of a disc and a picture of what the Event Horizon
    // Telescope resolved — the ring is not a ring of material, it is
    // where the line of sight runs longest through the same plasma.
    if (uAspect > THICK_FLOW) {
      float rMid = 0.5 * (prev.x + y.x);
      float muMid = 0.5 * (prev.y + y.y);
      float presence = flowPresence(rMid);
      if (presence > 0.002 && abs(muMid) < 3.5 * uAspect) {
        float tEmit = flowTemperature(rMid);
        if (tEmit > 0.0) {
          if (held <= 0) {
            heldDensity = flowDensity(rMid, 0.5 * (prevPhi + phi), muMid);
            held = 3;
          }
          held--;
          float density = heldDensity;
          tEmit *= pow(density, 0.25);
          vec3 u = kerrFlowVelocity(rMid, a, uInnerRg);
          float dr = 0.5 * (prev.z + y.z);
          float g = shiftFactor(u, xi, dr, rMid, a);
          float tObs = g * tEmit;
          // How much gas this step went through: the distance the
          // photon covered, as the gas measures it, times what is there
          // at that height. Optically thin, so the emission is the path
          // integral and the opacity only dims what lies behind — the
          // two are separate, as they are not for a surface.
          float through =
            flowColumn(rMid, muMid) * kerrProperLength(rMid, muMid, ds, g, a) * presence;
          float emitted = tEmit / uRefTempK;
          float profile = emitted * emitted * emitted * emitted;
          float shown = pow(profile, uProfileStretch);
          float shift = tObs / max(tEmit, 1.0);
          float beamed = shift * shift * shift * shift;
          accum += transmittance * through * lutColor(tObs) * shown * beamed * uDiscGain;
          transmittance *= exp(
            -uOpticalDepth * pow(rMid / uInnerRenderRg, -uOpacityExp) * density * through
          );
          if (transmittance < 0.004) { escaped = false; settled = true; break; }
        }
      }
    }

    // The equatorial flow is θ = π/2 at any spin: the step that changes
    // the sign of μ crossed it.
    if (uAspect <= THICK_FLOW && prev.y * y.y < 0.0) {
      float f = prev.y / (prev.y - y.y);
      float rHit = mix(prev.x, y.x, f);
      float phiHit = mix(prevPhi, phi, f);
      float tEmit = flowTemperature(rHit);
      float presence = flowPresence(rHit);
      if (tEmit > 0.0 && presence > 0.002) {
        // Where the gas piles up it dissipates more and radiates
        // hotter: an optically thick surface emits σT⁴ per unit area
        // whatever its density, so a clump shows as the fourth root of
        // itself in temperature — and, through T⁴, as itself in
        // brightness. The same clump thickens the column.
        float density = flowDensity(rHit, phiHit, 0.0);
        tEmit *= pow(density, 0.25);
        // Doppler and gravity in one factor: g = 1/(−p·u), the ratio of
        // received to emitted frequency, contracted against the four-
        // velocity the matter actually has — orbiting outside the last
        // stable circle, plunging inside it. ξ is the photon's own
        // conserved angular momentum, so which limb is approaching is
        // decided by the ray rather than by any assumption about the
        // geometry, and the infall term carries the extra redshift of
        // matter falling away from the eye. A blackbody stays a
        // blackbody under this, at temperature gT — so the shift is the
        // colour and, through σ(gT)⁴, the beaming as well.
        vec3 u = kerrFlowVelocity(rHit, a, uInnerRg);
        vec4 at = mix(prev, y, f);
        float g = shiftFactor(u, xi, at.z, rHit, a);
        float tObs = g * tEmit;
        vec3 through = kerrHeading(vec4(rHit, 0.0, at.z, at.w), phiHit, a, xi);
        float slant = max(abs(normalize(through).z), 0.04);
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

  // Whether the hole took the ray was already settled in closed form.
  // Running out of steps is a statement about the coordinates, not
  // about the photon: rays that pass near the spin axis have to resolve
  // an azimuth that sweeps a half turn in almost no affine parameter,
  // and spending the budget on that used to be read as capture, which
  // drew a black seam up the axis through sky that is plainly visible.
  if (doomed) escaped = false;
  // The light came from where the trace ended up, which is against the
  // photon's own direction of travel.
  escapeDir = normalize(-kerrHeading(y, phi, a, xi));
  return accum;
}
`;
