/**
 * The Kerr metric, in GLSL, for one photon at a time.
 *
 * This mirrors core/physics/kerr.ts line for line — the same separated
 * equations, the same tetrad, the same critical curve — so what the
 * tests verify on the CPU is what the shader runs. Lengths are
 * gravitational radii (M = 1) and the affine parameter is Mino time,
 * the substitution that decouples the radial and polar motions and
 * leaves both as polynomials.
 *
 * Two things are worth saying about what is *not* here. There is no
 * perturbative bend factor, no shadow-squeeze parameter, no strength
 * dial: the geodesics are the exact ones, and the D-shaped shadow, the
 * offset photon ring and the dragging of the flow's inner edge all come
 * out of them rather than being applied on top. And the constants that
 * start each ray are read off a real observer's frame rather than a
 * flat-space approximation to it — near a spinning hole those differ by
 * tens of percent, and a ray that starts with constants inconsistent
 * with its own position is not on any geodesic at all.
 */
export const KERR_GLSL = /* glsl */ `
uniform float uSpin;
uniform float uHorizonRg;

/** Boyer–Lindquist Σ = r² + a²cos²θ. */
float kerrSigma(float r, float mu, float a) {
  return r * r + a * a * mu * mu;
}

/** Δ = r² − 2r + a². Vanishes at the horizons. */
float kerrDelta(float r, float a) {
  return r * r - 2.0 * r + a * a;
}

/** A = (r² + a²)² − a²Δsin²θ, the frame-dragging denominator. */
float kerrBigA(float r, float mu, float a) {
  float rr = r * r + a * a;
  return rr * rr - a * a * kerrDelta(r, a) * (1.0 - mu * mu);
}

/**
 * Constants of the photon arriving from local direction n, carried
 * through the tetrad of the locally non-rotating observer at (r, mu).
 * n is (outward, southward, prograde) and must be unit length.
 * Returns (ξ, η, dr/dσ, dμ/dσ).
 */
vec4 kerrPhoton(float r, float mu, float a, vec3 n) {
  float sig = kerrSigma(r, mu, a);
  float del = kerrDelta(r, a);
  float bigA = kerrBigA(r, mu, a);
  float sinT = sqrt(max(1.0 - mu * mu, 0.0));
  float lapse = sqrt(max(sig * del / bigA, 1.0e-12));

  // Energy and angular momentum, with the pole's cancellation already
  // done. Written the direct way, the azimuthal momentum carries a
  // n_φ/sinθ that runs away on the axis and is then multiplied by a
  // g_φφ ∝ sin²θ that goes to nothing — finite in exact arithmetic and
  // ruinous in single precision, which is what a camera looking
  // straight down the spin axis was seeing. Cancelling by hand leaves
  // L_z = √(A/Σ) sinθ n_φ, which simply vanishes on the axis, as it
  // must: every photon reaching a point on the axis arrives with no
  // angular momentum about it. The frame-dragging term drops out of the
  // energy for the same reason it always does — the observer rotates at
  // exactly the rate that makes it.
  float energy = lapse + (2.0 * a * r * sinT * n.z) / sqrt(sig * bigA);
  float xi = (sqrt(bigA / sig) * sinT * n.z) / energy;
  // ξ/sinθ, needed by Carter's constant and singular only if written
  // as the quotient of the two things that vanish together.
  float overSin = (sqrt(bigA / sig) * n.z) / energy;
  float pThetaLower = (sqrt(sig) * n.y) / energy;
  float eta = pThetaLower * pThetaLower + mu * mu * (overSin * overSin - a * a);

  // dr/dλ = p^r and dμ/dλ = −sinθ p^θ; Mino time divides out Σ.
  return vec4(
    xi,
    eta,
    (sqrt(sig * del) * n.x) / energy,
    (-sinT * sqrt(sig) * n.y) / energy
  );
}

/** R(r) = r⁴ + (a²−ξ²−η)r² + 2Kr − a²η, the radial potential. */
float kerrRadial(float r, float xi, float eta, float a) {
  float kk = (xi - a) * (xi - a) + eta;
  return r * r * r * r + (a * a - xi * xi - eta) * r * r + 2.0 * kk * r - a * a * eta;
}

/** Θ(μ) = η + μ²(a² − ξ² − η) − a²μ⁴, the polar potential. */
float kerrPolar(float mu, float xi, float eta, float a) {
  float m2 = mu * mu;
  return eta + m2 * (a * a - xi * xi - eta) - a * a * m2 * m2;
}

/**
 * The same potential, factored so that sin²θ enters as a carried
 * quantity rather than as 1 − μ².
 *
 * That difference decides whether the renderer works near the spin
 * axis. A ray that passes close to it has sin²θ down at a millionth,
 * and in the single precision a shader has, 1 − μ² there is the
 * subtraction of two numbers that agree to seven digits: the answer
 * comes back with a fifth of its value in error, sometimes as zero.
 * Carried instead — accumulated from its own smooth rate, never
 * differenced — sin²θ keeps its relative precision all the way down,
 * and everything that divides by it stays honest.
 */
float kerrPolarFrom(float sinSq, float mu, float xi, float eta, float a) {
  return sinSq * (eta + a * a * mu * mu) - xi * xi * mu * mu;
}

/** Where the polar motion turns: Θ = 0, solved for sin²θ. */
float kerrPolarTurn(float mu, float xi, float eta, float a) {
  return (xi * xi * mu * mu) / max(eta + a * a * mu * mu, 1.0e-12);
}

/**
 * The azimuth a ray sweeps about the spin axis, in closed form.
 *
 * dφ/dσ carries ξ/sin²θ, and a ray reaching for the pole drives that
 * to whatever it likes: sin²θ bottoms out at ξ²/(η+a²), so the rate
 * peaks at (η+a²)/ξ and a ray with a thousandth of a unit of angular
 * momentum sweeps most of a half turn in almost no affine parameter.
 * No step rule can follow that, and every attempt to dodge it — capping
 * the rate, holding rays off the axis — answers a different question
 * for a whole band of the image rather than for the few rays that are
 * really singular.
 *
 * It does not have to be integrated. The term splits exactly,
 *
 *   ξ/sin²θ = ξ|cosθ|/sin²θ + ξ/(1 + |cosθ|),
 *
 * and the whole difficulty is in the first piece, which has an
 * elementary antiderivative: written in s = sin²θ the polar potential
 * is exactly the quadratic Θ = −a²s² + Bs − ξ², and ∫ds/(s√Θ) is an
 * arcsine. This is that arcsine, arranged to vanish at the polar
 * turning point — which is what lets a step that crosses the turning
 * point be differenced without knowing that it did. What is left over,
 * ξ/(1+|cosθ|), is bounded by ξ, divides by nothing small and
 * subtracts nothing; it goes through the integrator with the rest.
 *
 * Over a full passage this comes to π as ξ goes to nothing: the half
 * turn a ray makes going over the pole, exactly, whether it passes a
 * radian from the axis or a millionth of one.
 */
float kerrAxisAzimuth(float sinSq, float mu, float dmu, float xi, float eta, float a) {
  float x2 = xi * xi;
  float b = eta + a * a + x2;
  float disc = sqrt(max(b * b - 4.0 * a * a * x2, 0.0));
  float arg = clamp((b * sinSq - 2.0 * x2) / max(sinSq * disc, 1.0e-30), -1.0, 1.0);
  // Which branch the ray is on: climbing toward its pole, or falling
  // back from it. The bracket is zero where the two meet, so a step
  // that turns around inside itself is still only a difference.
  float branch = mu * dmu < 0.0 ? -1.0 : 1.0;
  float sgn = xi < 0.0 ? -1.0 : 1.0;
  return -0.5 * sgn * branch * (asin(arg) + 1.5707963);
}

/**
 * The step that antiderivative takes when a ray crosses the equator.
 *
 * sin²θ turns around there too — at its largest rather than its
 * smallest — so the branch flips a second time, and unlike the polar
 * turn the bracket is not zero where it happens. The size of the jump
 * depends on the ray's constants alone, so it is worked out once and
 * taken back off whenever μ changes sign.
 */
float kerrEquatorJump(float xi, float eta, float a) {
  float x2 = xi * xi;
  float b = eta + a * a + x2;
  float disc = sqrt(max(b * b - 4.0 * a * a * x2, 0.0));
  float arg = clamp((b - 2.0 * x2) / max(disc, 1.0e-30), -1.0, 1.0);
  float sgn = xi < 0.0 ? -1.0 : 1.0;
  return sgn * (asin(arg) + 1.5707963);
}

/**
 * Rates of the state (r, μ, dr/dσ, dμ/dσ). Both accelerations are
 * polynomial and neither needs the square root of a potential, so a
 * turning point is just a place where a derivative passes through zero
 * and the integrator walks across it without noticing.
 */
vec4 kerrRates(vec4 y, float a, float xi, float eta) {
  float r = y.x;
  float mu = y.y;
  float p = r * r + a * a - a * xi;
  float kk = (xi - a) * (xi - a) + eta;
  float dr = 2.0 * r * p - (r - 1.0) * kk;
  float dmu = -mu * (eta + xi * xi - a * a) - 2.0 * a * a * mu * mu * mu;
  return vec4(y.z, y.w, dr, dmu);
}

/**
 * Put the state back on its own constraint surface.
 *
 * dr² = R(r) and dμ² = Θ(μ) hold exactly along a geodesic, and the
 * second-order form conserves them exactly too — analytically. What it
 * does not do is conserve them in floating point, and the drift is
 * vicious in a way that is easy to miss: R falls as r⁴, so an absolute
 * error picked up far out, where R is eleven orders of magnitude, is
 * still there when R has come down to five, and by then it is the whole
 * answer. Left alone, a ray that should have been swallowed turns
 * around at twenty gravitational radii and escapes, and the shadow
 * comes out the wrong size with nothing visibly wrong.
 *
 * So the magnitudes are taken from the potentials, which are exact, and
 * only the signs are left to the integrator — which is what the
 * second-order form is actually for, since a sign is precisely what a
 * turning point changes and what a square root cannot tell you.
 *
 * A negative potential is a different matter, and not a rounding error:
 * it says the step landed somewhere the photon cannot be. That happens
 * at a turning point, where the derivative the step rule watches goes
 * to zero and lets the step grow just as the trajectory needs it small.
 * The polar one bites hardest, on rays that reach for the spin axis and
 * are stepped clean over their own reflection — past it μ exceeds one,
 * the reconstruction has no such point, and the ray leaves for a
 * direction it was never going to. Reflecting back across the turning
 * point, which one Newton step locates since the overshoot is always
 * small, is what a turning point physically is.
 */
float kerrReflect(float value, float potential, float slope) {
  float turn = value - potential / (abs(slope) < 1.0e-12 ? 1.0e-12 : slope);
  return 2.0 * turn - value;
}

/** The radial half of the projection; the polar half is done in the
 *  marching loop, where sin²θ is carried. */
vec4 kerrProjectRadial(vec4 y, float a, float xi, float eta) {
  float radial = kerrRadial(y.x, xi, eta, a);
  if (radial < 0.0) {
    float kk = (xi - a) * (xi - a) + eta;
    y.x = kerrReflect(y.x, radial, 4.0 * y.x * y.x * y.x
      + 2.0 * (a * a - xi * xi - eta) * y.x + 2.0 * kk);
    y.z = -y.z;
    radial = max(kerrRadial(y.x, xi, eta, a), 0.0);
  }
  y.z = (y.z < 0.0 ? -1.0 : 1.0) * sqrt(radial);
  return y;
}

vec4 kerrProject(vec4 y, float a, float xi, float eta) {
  float radial = kerrRadial(y.x, xi, eta, a);
  if (radial < 0.0) {
    float kk = (xi - a) * (xi - a) + eta;
    y.x = kerrReflect(y.x, radial, 4.0 * y.x * y.x * y.x
      + 2.0 * (a * a - xi * xi - eta) * y.x + 2.0 * kk);
    y.z = -y.z;
    radial = max(kerrRadial(y.x, xi, eta, a), 0.0);
  }
  y.z = (y.z < 0.0 ? -1.0 : 1.0) * sqrt(radial);

  float polar = kerrPolar(y.y, xi, eta, a);
  if (polar < 0.0) {
    float m = y.y;
    y.y = kerrReflect(m, polar,
      2.0 * m * (a * a - xi * xi - eta) - 4.0 * a * a * m * m * m);
    y.w = -y.w;
    polar = max(kerrPolar(y.y, xi, eta, a), 0.0);
  }
  y.w = (y.w < 0.0 ? -1.0 : 1.0) * sqrt(polar);
  return y;
}

/**
 * What is left of dφ/dσ once the axis has been taken out of it: the
 * frame dragging aP/Δ − a, which the horizon owns and the pole never
 * touches, and the ξ/(1+|cosθ|) that kerrAxisAzimuth leaves behind.
 * Both are bounded by the ray's own constants, so this is the whole of
 * what the integrator has to follow and the step rule has to resolve.
 */
float kerrPhiRate(float r, float mu, float a, float xi) {
  float p = r * r + a * a - a * xi;
  return a * p / kerrDelta(r, a) - a + xi / (1.0 + abs(mu));
}

/**
 * Bardeen's constants for the spherical photon orbit of radius r — the
 * orbits that neither escape nor fall, and whose constants are exactly
 * the shadow's edge.
 */
vec2 kerrCritical(float r, float a) {
  float denom = a * (r - 1.0);
  float xi = (r * r * (3.0 - r) - a * a * (1.0 + r)) / denom;
  float eta = r * r * r * (4.0 * a * a - r * (r - 3.0) * (r - 3.0)) / (denom * denom);
  return vec2(xi, eta);
}

/**
 * Whether the hole swallows this photon, exactly.
 *
 * A photon falls if its radial potential has no root outside the
 * horizon, and the boundary case is a spherical orbit — so comparing
 * against the critical curve settles it in closed form, no integration
 * involved. ξ runs monotonically across the photon orbits, so one
 * bisection finds the orbit that shares this photon's angular momentum
 * and the comparison is on η alone. Static holes take the limit
 * ξ² + η < 27, which is the familiar 3√3.
 *
 * Deciding this analytically is what keeps the shadow's edge clean:
 * left to the integrator, near-critical rays hover at the photon orbit
 * and resolve into whatever the arithmetic happens to do there.
 */
bool kerrCaptured(float xiIn, float eta, float aIn) {
  if (abs(aIn) < 0.01) return xiIn * xiIn + eta < 27.0;
  // A retrograde hole is the mirror of a prograde one, so one branch
  // serves both: reflect the photon's angular momentum with the spin.
  float a = abs(aIn);
  float xi = aIn < 0.0 ? -xiIn : xiIn;
  float lo = 2.0 * (1.0 + cos(0.6666667 * acos(-a)));
  float hi = 2.0 * (1.0 + cos(0.6666667 * acos(a)));
  vec2 atLo = kerrCritical(lo, a);
  vec2 atHi = kerrCritical(hi, a);
  // Outside the range of angular momenta the photon orbits carry,
  // nothing is marginal: the photon simply passes.
  if (xi > max(atLo.x, atHi.x) || xi < min(atLo.x, atHi.x)) return false;
  bool descending = atLo.x > atHi.x;
  for (int i = 0; i < 24; i++) {
    float mid = 0.5 * (lo + hi);
    bool above = kerrCritical(mid, a).x > xi;
    if (above == descending) lo = mid; else hi = mid;
  }
  return eta < kerrCritical(0.5 * (lo + hi), a).y;
}

/** Energy and angular momentum of the prograde circular orbit at r. */
vec2 kerrOrbitEL(float r, float a) {
  float s = sqrt(r);
  float root = sqrt(max(r * r - 3.0 * r + 2.0 * a * s, 1.0e-9));
  return vec2(
    (r * r - 2.0 * r + a * s) / (r * root),
    (r * r - 2.0 * a * s + a * a) / (s * root)
  );
}

/**
 * Four-velocity (u^t, u^φ, u^r) of the accreting matter at radius r in
 * the equatorial plane.
 *
 * Outside the innermost stable orbit the flow is on a circular geodesic
 * and there is nothing to choose. Inside it there are no circular
 * orbits at all, so matter falls — and it falls carrying the energy and
 * angular momentum it had when it left the last stable circle, because
 * nothing in the plunging region has time to change them. Freezing E
 * and L at the innermost orbit and letting the normalisation supply the
 * infall is the whole prescription; it has no free parameters, and the
 * radial term switches itself off above the boundary because a circular
 * orbit's own constants make it vanish identically.
 *
 * This is what lets a starved flow be drawn all the way in from its
 * horizon. Treated as orbiting down there instead, it would be assigned
 * speeds no orbit can hold and its Doppler factor would pass through
 * infinity — which is why a Schwarzschild tracer has to stop the flow
 * short of the region a real one occupies.
 */
vec3 kerrFlowVelocity(float r, float a, float iscoRg) {
  vec2 el = kerrOrbitEL(max(r, iscoRg), a);
  float e = el.x;
  float l = el.y;
  float d = kerrDelta(r, a);
  float p = e * (r * r + a * a) - a * l;
  float lae = l - a * e;
  float r2 = r * r;
  return vec3(
    ((r * r + a * a) * p / d + a * lae) / r2,
    (a * p / d + lae) / r2,
    -sqrt(max(p * p - d * (r2 + lae * lae), 0.0)) / r2
  );
}

/**
 * How far a photon travelled, as the gas it passed through measures it.
 *
 * Radiative transfer is written against the affine parameter, and Mino
 * time is related to it by dλ = Σ dσ — so the whole of the geometry
 * that matters here is one factor already in hand. Converting to the
 * proper length in the fluid's own frame is then a division by the
 * shift, since the photon's frequency in that frame is exactly what
 * relates the two.
 *
 * Measuring the step in ordinary Euclidean length instead looks
 * equivalent and is not. The polar term carries dθ = −dμ/sinθ, which
 * on the spin axis is a division by nothing at all, and a ray that
 * passes near the pole is credited with an enormous distance through
 * gas it barely touched. The affine form has no such place: Σ is
 * r² + a²cos²θ, finite and well behaved everywhere outside the horizon.
 */
float kerrProperLength(float r, float mu, float ds, float shift, float a) {
  return kerrSigma(r, mu, a) * abs(ds) / max(shift, 1.0e-3);
}

/**
 * Pseudo-Cartesian position from Boyer–Lindquist, the reconstruction
 * the renderer draws in: x = √(r²+a²)sinθcosφ, z = r cosθ. The
 * equatorial plane is z = 0 at any spin, so a flow crossing is still
 * just a sign change in μ.
 */
vec3 kerrPosition(float r, float mu, float phi, float a) {
  float rho = sqrt(r * r + a * a);
  float sinT = sqrt(max(1.0 - mu * mu, 0.0));
  return vec3(rho * sinT * cos(phi), rho * sinT * sin(phi), r * mu);
}
`;
