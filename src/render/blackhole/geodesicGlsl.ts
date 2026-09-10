import { FLOW_SPECTRUM_GLSL } from './flowSpectrum';
import { HOT_FLOW_SPECTRUM_GLSL } from './hotFlowSpectrum';
import { HOT_OUTFLOW_GLSL } from './hotOutflowSpectrum';
import { HOT_ATLAS_GLSL } from './hotFlowAtlas';
import { CELL_TRANSFER_GLSL } from '../../core/physics/radiativeTransfer';

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
 *
 * The one place the coordinates fight back is the spin axis, where
 * dφ/dσ runs away and no step rule can follow it. That is settled in
 * kerrGlsl by splitting the azimuth rather than by dodging it, so a
 * camera looking straight down the axis is traced the same way as any
 * other — which is the only way the picture comes out axisymmetric,
 * as by symmetry it has to be.
 */

/** The camera frames the bright inner flow; the emitting disk may extend
 * much farther, to the model's self-gravity radius. */
export const FLOW_DRAW_SPAN = 12;

export function drawnFlowRadiusRg(flow: {
  regime: string;
  innerRadiusRg: number;
  outerRadiusRg: number;
}): number {
  return flow.outerRadiusRg;
}

/**
 * How far out the flow decides where the camera stands, r_g.
 *
 * A different question from how far to draw it, and answering both
 * with one number is what made drawing the whole torus cost the
 * shadow: standing clear of everything drawn pushed the camera out
 * with it, and the hole that the picture is of came back a third the
 * size. What the eye wants framed is the bright part — a dozen inner
 * radii in either regime — and the rest is welcome to run off the
 * edge, which is what pulling back is for.
 */
export function framedFlowRadiusRg(flow: {
  innerRadiusRg: number;
  outerRadiusRg: number;
}): number {
  return Math.min(flow.outerRadiusRg, flow.innerRadiusRg * FLOW_DRAW_SPAN);
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

/**
 * Impact parameter inside which the traced image is the whole picture.
 *
 * The trace does not stop at LENSING_REACH_RG, it fades out over the
 * last stretch — so between this radius and that one the drawn pixel
 * is part traced sky and part whatever is behind it, which is the
 * galaxy's own dome and its nuclear cluster, and the two have to be
 * there to be blended with.
 *
 * That makes this the radius the dome may be switched off at, and no
 * larger. Since a ray's impact parameter can never exceed the camera's
 * own distance from the hole, a camera inside this radius has every
 * pixel on screen at full coverage, the dome is completely hidden
 * behind the trace, and turning it off changes nothing. Switched off
 * at LENSING_REACH_RG instead — as it was — the outer part of the
 * frame lost the dome while the trace was still fading in over it, and
 * everything but the brightest lensed arcs went black.
 */
export const LENSING_SOLID_RG = 88;

export const GEODESIC_GLSL = /* glsl */ `
${CELL_TRANSFER_GLSL}
uniform vec3 uCamRg;
uniform mat3 uViewToBh;
uniform vec2 uTanHalfFov;

uniform float uInnerRg;
uniform float uIscoRg;
uniform float uInnerRenderRg;
uniform float uOuterRg;
uniform float uInnerTempK;
uniform float uProfileExp;
uniform float uEdgeTaper;
uniform float uOpticalDepth;
uniform float uOpacityExp;
uniform float uRefLogVisible;
uniform float uAspect;
uniform float uFlowPhase;
uniform float uDiscGain;
uniform sampler2D uLut;
uniform sampler2D uHotEmission;
uniform sampler2D uHotAbsorption;
uniform highp sampler3D uHotLocal;
uniform sampler2D uHotState;
uniform sampler2D uHotAtlas;
uniform float uHotPower;
uniform float uHotScatter;
uniform highp sampler3D uWindSpectrum;
uniform highp sampler3D uJetSpectrum;
uniform sampler2D uOutflowKinematics;
uniform float uWindLaunch;
uniform float uJetLaunch;
uniform float uWindEnabled;
uniform float uJetEnabled;
uniform sampler2D uThinState;

const float LENSING_REACH = ${LENSING_REACH_RG}.0;
const float LENSING_SOLID = ${LENSING_SOLID_RG}.0;
const int MAX_STEPS = 512;
const float TAU = 6.28318531;
/**
 * Mino-time step, as a fraction of the fastest coordinate's rate.
 *
 * Set by what the drawn picture needs, not by what the integrator can
 * do. Refining it by more than twice moves the image half a percent,
 * which is this trace's own convergence noise; coarsening it to 0.075
 * costs the second-order 15π/4b² term in the deflection, which is a
 * test and not available to spend. This sits between them.
 */
const float STEP_EPS = 0.06;
/** Half-thickness above which the flow is passed through rather than
 *  crossed. Cold discs sit near 0.02, ion tori at 0.55. */
const float THICK_FLOW = 0.15;
/**
 * The least distance from the spin axis a camera is placed at, in r_g.
 *
 * Boyer–Lindquist has no azimuth on the axis, and a camera sitting
 * exactly there hands every ray the same one — the trace then runs
 * every pixel in one meridian and the image collapses onto a line of
 * sky. This is the same standoff the disc plane already gets, for the
 * same reason and at the same size: at the radii this draws from it
 * moves the viewpoint by a small fraction of a pixel.
 */
const float AXIS_STANDOFF = 1.0e-4;

/** Material samples follow the same Kerr azimuth as the gas velocity.
 * Cell centers lie at (p+.5)/N and (r+.5)/N. Phi wraps; radius clamps.
 * Density controls opacity; the independently evolved thermal reservoir
 * sets bolometric flux, hence T_eff = T_background * reservoir^(1/4). */
vec2 thinDiskState(float r, float phi) {
  vec2 uv=vec2(phi/TAU,log(max(r,uInnerRg)/uInnerRg)/log(uOuterRg/uInnerRg));
  return max(texture2D(uThinState,uv).rg,vec2(1.0e-6));
}

/**
 * How much of the flow sits at height μ, per unit length, normalised so
 * that a column straight through it comes to exactly one.
 *
 * The exponent is cot θ over the aspect ratio, not μ over it, and for a
 * flow this thick that is the whole difference between a torus and a
 * ball of gas. Hydrostatic support against the vertical pull of a
 * body rotating at the local Keplerian rate gives ρ ∝ exp(−cot²θ/2ε²):
 * near the midplane cot θ → μ and it is the familiar Gaussian of scale
 * height εR, but toward the axis cot θ runs away and the density falls
 * faster than any exponential. That is the funnel — the evacuated
 * channel along the spin axis that every simulation of a hot flow
 * shows, and that a jet would occupy.
 *
 * Written in μ instead, the same expression leaves nineteen percent of
 * the midplane density sitting on the axis of a torus half as deep as
 * it is wide. Looking down at one, the eye then travels the whole way
 * through that, and the shadow — the thing being looked at — is behind
 * a veil of gas that has no business being there. It cost the shadow
 * five sixths of its contrast.
 *
 * Normalising the column is what lets a volume and a sheet be compared:
 * a ray crossing the midplane square on collects exactly what the sheet
 * would have given it, and every other ray collects more, in proportion
 * to how far it travelled through the gas. That excess is not a
 * liberty. It is why a hot flow shows a ring: lines of sight that graze
 * tangentially run through far more plasma than those that punch
 * through, and the limb lights up.
 */
float flowColumn(float r, float mu) {
  float e = max(uAspect, 0.02);
  // cot θ = μ/sin θ, which is z/R exactly — so the scale height is εR
  // in the cylindrical radius, as hydrostatic equilibrium asks, rather
  // than ε times the spherical one.
  float z = mu / (e * sqrt(max(1.0 - mu * mu, 1.0e-8)));
  return exp(-0.5 * z * z) / (2.5066282 * e * r);
}

${FLOW_SPECTRUM_GLSL}
${HOT_FLOW_SPECTRUM_GLSL}
${HOT_ATLAS_GLSL}
${HOT_OUTFLOW_GLSL}

/** Soften the physical outer boundary without losing half the disk. */
float flowPresence(float r) {
  if (r < uInnerRenderRg || r > uOuterRg) return 0.0;
  float fadeStart = uAspect > THICK_FLOW ? 0.5 : 0.9;
  return 1.0 - smoothstep(fadeStart * uOuterRg, uOuterRg, r);
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
 * The direction the ray is travelling, in the space it is drawn in.
 *
 * Differencing two reconstructed positions is the obvious way to get
 * this, and it fails exactly where it matters most. A ray leaving along
 * the spin axis has both of those points sitting on that axis, and the
 * azimuth separating them is then the difference of two quantities that
 * have both gone to nothing — so every such ray is handed almost the
 * same direction, and a whole column of the image is sent to one place
 * on the sky. That is a dark stripe up the axis, and no amount of
 * stepping more finely removes it, because the loss is in the
 * reconstruction rather than in the trajectory.
 *
 * Differentiating instead costs no more and is regular there, provided
 * two things are written the right way round: the polar motion as
 * dθ/dσ, which is finite on the axis, rather than dμ/dσ over a sine
 * that is not; and the azimuthal term as ρ·ξ/sinθ, which is bounded,
 * rather than ρ sinθ · ξ/sin²θ, which is a cancellation.
 */
vec3 kerrHeading(vec4 y, float sinSq, float phi, float a, float xi, float eta) {
  float r = y.x;
  float mu = clamp(y.y, -1.0, 1.0);
  float s = sqrt(max(sinSq, 1.0e-14));
  float rho = sqrt(r * r + a * a);
  // ξ/sinθ. A ray can only approach the axis as closely as its own
  // angular momentum allows, so this is bounded by the impact
  // parameter however small the sine gets.
  float overSin = xi / s;
  // (dθ/dσ)² = Θ/sin²θ, which the axis leaves finite.
  float polar = (y.w > 0.0 ? -1.0 : 1.0) *
    sqrt(max((eta + a * a * mu * mu) - overSin * overSin * mu * mu, 0.0));
  float p = r * r + a * a - a * xi;
  float azimuth = rho * (s * (a * p / kerrDelta(r, a) - a) + overSin);
  float cp = cos(phi);
  float sp = sin(phi);
  float radial = r * y.z / rho;
  return vec3(
    radial * s * cp + rho * mu * polar * cp - azimuth * sp,
    radial * s * sp + rho * mu * polar * sp + azimuth * cp,
    y.z * mu - r * s * polar
  );
}

/**
 * The size of one Mino-time step: small enough that no coordinate moves
 * far, in units of its own scale. Radius is measured against itself, so
 * steps grow with distance and a ray a thousand r_g out crosses in a
 * handful; angles are measured absolutely, so a ray winding the photon
 * ring is stepped finely however slowly its radius changes.
 *
 * Every rate here is bounded by the ray's own constants, the azimuth's
 * included — the part of it that was not is integrated in closed form
 * and never reaches this. So there is nothing left to cap, and no ray
 * whose step this rule drives to nothing.
 *
 * Speed alone is not enough to set it by, because at a turning point
 * the speed is zero and the motion is not. A ray reaching for the pole
 * arrives with dμ/dσ going through nothing, and one at periapsis with
 * dr/dσ doing the same; where those nearly coincide — which is the
 * whole near-axis strip — the rate collapses and the step this rule
 * would return jumps by a factor of twenty in a single iteration. What
 * follows is not a small error: the step carries the state clean out
 * of the domain, μ past one and sin²θ below nothing, and the ray ends
 * a thousand gravitational radii away pointing at unrelated sky. It
 * drew as a chevron above and below the hole, because the locus where
 * both turnings meet is a cone about the spin axis.
 *
 * So the curvature bounds it too. Where a coordinate turns around it
 * moves by ½|x''|dσ² and by nothing else, and holding that to the same
 * fraction of its own scale asks for dσ ≤ √(2ε/|x''|). The two limits
 * are taken as a minimum rather than summed, which leaves every step
 * away from a turning point exactly as it was: over a frame this costs
 * a tenth of a percent more steps and takes the worst neighbouring-ray
 * disagreement near the axis from a hundred and seventy-five degrees
 * to one. The accelerations are the first Runge–Kutta stage, which the
 * caller has already computed.
 */
float kerrStep(vec4 y, vec4 k1, float a, float xi) {
  float speed = abs(y.z) / max(y.x, 1.0)
    + abs(y.w)
    + abs(kerrPhiRate(y.x, y.y, a, xi));
  float bend = abs(k1.z) / max(y.x, 1.0) + abs(k1.w);
  return min(STEP_EPS / max(speed, 1.0e-4), sqrt(2.0 * STEP_EPS / max(bend, 1.0e-4)));
}

/** Shared radiative transfer for both geometric integrators. */
bool flowSegment(vec4 prev, vec4 y, float prevPhi, float phi, vec4 midpoint, float phiMid, float ds,
  float a, float xi, float eta, inout vec3 accum, inout vec3 transmittance,
  inout float heldDensity, inout int held) {
  if (uOuterRg <= 0.0) return false;
    // A thick flow is passed through rather than crossed. A starved
    // hole puffs its gas into an ion torus half as deep as it is wide
    // and thin enough to see through, so there is no surface anywhere
    // to intersect: what reaches the eye is the whole column the ray
    // travelled, gathered step by step. This is the difference between
    // a picture of a disc and a picture of what the Event Horizon
    // Telescope resolved — the ring is not a ring of material, it is
    // where the line of sight runs longest through the same plasma.
    if (uAspect > THICK_FLOW) {
      float rMid = midpoint.x;
      float muMid = midpoint.y;
      float presence = flowPresence(rMid);
      if (presence > 0.002 && abs(muMid) < 3.5 * uAspect) {
        // Radial kinematics are steady; torus spectra can be skipped in
        // its evacuated funnel without skipping wind or jet transfer.
        vec2 stateUv=vec2(phiMid/TAU+.18*muMid,
          log(rMid/uInnerRenderRg)/log(uOuterRg/uInnerRenderRg));
        vec3 kinematics=outflowKinematicsAt(stateUv.y);
        float vertical = flowColumn(rMid, muMid) * 2.5066282 * uAspect * rMid;
        vec3 tau=vec3(0.0);
        vec3 cellLight=vec3(0.0);
        if(vertical>1.0e-6) {
          vec3 u = kerrFlowVelocity(rMid, a, uIscoRg);
          float g = shiftFactor(u, xi, midpoint.z, rMid, a);
          vec4 state=texture2D(uHotState,stateUv);
#ifdef DIRECT_HOT_PLASMA
          vec4 source = localHotFlowLight(rMid, g, state);
          vec3 absorption=localHotAbsorption(rMid,g,state);
#else
          vec4 source = hotAtlasLight(stateUv.y,stateUv.x,g);
          vec3 absorption=hotAtlasAbsorption(stateUv.y,stateUv.x,g);
#endif
          float density = vertical * (state.x<1.0?pow(.7,1.0-state.x):pow(1.4,state.x-1.0));
          float emissive = vertical*vertical;
          float distance = kerrProperLength(rMid, muMid, ds, g, a) * presence;
          float scatter = uHotScatter * pow(rMid/uInnerRenderRg, -1.5) * kinematics.z * density;
          tau = (absorption * emissive + vec3(scatter)) * distance;
          cellLight = distance * emissive * source.rgb * uHotPower;
        }
        // Overlapping media share one transfer cell, each with its own
        // comoving path length and frequency shift. Summing before transfer
        // avoids imposing an artificial front/back order within a cell.
        vec2 contraction=vec2(1.0,0.0);
        if(uWindEnabled>0.5 || uJetEnabled>0.5)contraction=outflowContraction(rMid,muMid,a,xi,midpoint.z);
        if(uWindEnabled>0.5 && rMid>uWindLaunch+0.0001) {
          float wg=outflowShift(contraction,kinematics.x);
          vec4 wind=outflowLight(uWindSpectrum,uWindLaunch,rMid,abs(muMid),wg);
          float length=kerrProperLength(rMid,muMid,ds,wg,a)*presence;
          cellLight+=wind.rgb*length;tau+=outflowExtinction(uWindSpectrum,uWindLaunch,rMid,abs(muMid),wg)*length;
        }
        float jetAngle=(1.0-abs(muMid))/${9*.18**2/2};
        if(uJetEnabled>0.5 && rMid>uJetLaunch && jetAngle<1.0) {
          float jg=outflowShift(contraction,kinematics.y);
          vec4 jet=outflowLight(uJetSpectrum,uJetLaunch,rMid,jetAngle,jg);
          float length=kerrProperLength(rMid,muMid,ds,jg,a)*presence;
          cellLight+=jet.rgb*length;tau+=outflowExtinction(uJetSpectrum,uJetLaunch,rMid,jetAngle,jg)*length;
        }
        vec3 cellThrough = exp(-tau);
        accum += transmittance * cellEmissionWeight(tau, cellThrough) * cellLight;
        transmittance *= cellThrough;
        if (max(transmittance.r,max(transmittance.g,transmittance.b)) < 0.004) return true;
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
        // Density changes the column; the evolved thermal reservoir sets
        // the surface flux independently through sigma T_eff^4.
        vec2 disk = thinDiskState(rHit, phiHit);
        float density = disk.x;
        tEmit *= pow(disk.y, 0.25);
        // Doppler and gravity in one factor: g = 1/(−p·u), the ratio of
        // received to emitted frequency, contracted against the four-
        // velocity the matter actually has — orbiting outside the last
        // stable circle, plunging inside it. ξ is the photon's own
        // conserved angular momentum, so which limb is approaching is
        // decided by the ray rather than by any assumption about the
        // geometry, and the infall term carries the extra redshift of
        // matter falling away from the eye. A blackbody stays a
        // blackbody under this, at temperature gT. Integrating its visible
        // spectrum gives both received colour and band-limited brightness.
        vec3 u = kerrFlowVelocity(rHit, a, uIscoRg);
        vec4 at = mix(prev, y, f);
        float g = shiftFactor(u, xi, at.z, rHit, a);
        vec3 through = kerrHeading(vec4(rHit, 0.0, at.z, at.w), 1.0, phiHit, a, xi, eta);
        float slant = max(abs(normalize(through).z), 0.04);
        // Column through the flow: its vertical depth thinned by the
        // radial fall-off, stretched by how obliquely the ray cuts it.
        float column =
          uOpticalDepth * pow(rHit / uInnerRenderRg, -uOpacityExp) * presence * density;
        float alpha = 1.0 - exp(-column / slant);
        accum += transmittance * alpha * flowLight(tEmit, g);
        transmittance *= 1.0 - alpha;
        if (max(transmittance.r,max(transmittance.g,transmittance.b)) < 0.004) return true;
      }
    }
  return false;
}

/**
 * What the eye sees along one ray: the flow it crosses, and the sky
 * behind wherever it escapes to. escaped tells the caller whether a
 * background sample is owed and in which direction — a captured ray
 * carries only the light it picked up before falling in.
 */
vec3 traceGeodesic(vec3 dir, out vec3 escapeDir, out bool escaped, out vec3 transmittance) {
  float a = uSpin;
  vec3 cam = uCamRg;
  // A camera lying exactly in the disc plane would have every ray stay
  // in it and never register a crossing.
  if (abs(cam.z) < 1.0e-4) cam.z = 1.0e-4;
  // And one lying exactly on the spin axis has no azimuth at all, so
  // every ray would be handed the same one and the whole image would
  // collapse onto a single meridian. Any direction off the axis will
  // do — the geometry is symmetric about it — so it is held the least
  // distance that gives atan something to work with, which at the
  // framings this draws is a ten-thousandth of a pixel.
  if (dot(cam.xy, cam.xy) < AXIS_STANDOFF * AXIS_STANDOFF) cam.xy = vec2(AXIS_STANDOFF, 0.0);

  escapeDir = dir;
  escaped = true;
  transmittance = vec3(1.0);

  // The photon travels toward the camera, against the trace. Its
  // constants come from the frame of an observer there — exactly, at
  // the camera's own position, however far out that is.
  vec2 camBl = blFromCartesian(cam, a);
  float camR = camBl.x;
  float camMu = camBl.y;
  float camPhi = atan(cam.y, cam.x);
  float rho = sqrt(camR * camR + a * a);
  // sinθ from where the camera is, never from 1 − μ². In the
  // reconstruction this draws in, x² + y² = (r²+a²)sin²θ exactly, so
  // the camera's own distance from the axis gives sinθ without
  // subtracting anything — and looking down the axis that is the
  // difference between a picture and a set of concentric circles.
  float sinT = length(cam.xy) / rho;
  float cp = cos(camPhi);
  float sp = sin(camPhi);
  // The coordinate directions, which are orthogonal in this
  // reconstruction, normalised into the observer's own axes.
  vec3 rHat = normalize(vec3(camR / rho * sinT * cp, camR / rho * sinT * sp, camMu));
  vec3 tHat = normalize(vec3(rho * camMu * cp, rho * camMu * sp, -camR * sinT));
  vec3 pHat = vec3(-sp, cp, 0.0);
  vec3 arrive = -dir;
  vec3 n = normalize(vec3(dot(arrive, rHat), dot(arrive, tHat), dot(arrive, pHat)));

  vec4 photon = kerrPhoton(camR, camMu, sinT, a, n);
  float xi = photon.x;
  float eta = photon.y;
  // What the antiderivative jumps by each time this ray crosses the
  // equator: a constant of the ray, so it is worked out once.
  float equatorJump = kerrEquatorJump(xi, eta, a);

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
  float sinSq;
  if (camR <= reach) {
    y = vec4(camR, camMu, photon.z, photon.w);
    phi = camPhi;
    sinSq = sinT * sinT;
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
    // Again from the geometry rather than from 1 − μ²: a camera on the
    // axis enters the trace near the axis too.
    sinSq = dot(start.xy, start.xy) / (bl.x * bl.x + a * a);
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

    vec4 k1 = kerrRates(y, a, xi, eta);
    float ds = -kerrStep(y, k1, a, xi);
    vec4 k2 = kerrRates(y + k1 * (ds * 0.5), a, xi, eta);
    vec4 k3 = kerrRates(y + k2 * (ds * 0.5), a, xi, eta);
    vec4 k4 = kerrRates(y + k3 * ds, a, xi, eta);
    // d(sin²θ)/dσ = −2μ dμ/dσ, on the same stages.
    float s1 = -2.0 * y.y * k1.y;
    float s2 = -2.0 * (y.y + k1.y * ds * 0.5) * k2.y;
    float s3 = -2.0 * (y.y + k2.y * ds * 0.5) * k3.y;
    float s4 = -2.0 * (y.y + k3.y * ds) * k4.y;
    // Only the bounded half of dφ/dσ is quadratured. μ enters it as
    // |μ| alone, so no stage can be asked about a sin²θ the photon
    // could not have reached, and none of them divides by it.
    float w1 = kerrPhiRate(y.x, y.y, a, xi);
    float w2 = kerrPhiRate(y.x + k1.x * ds * 0.5, y.y + k1.y * ds * 0.5, a, xi);
    float w3 = kerrPhiRate(y.x + k2.x * ds * 0.5, y.y + k2.y * ds * 0.5, a, xi);
    float w4 = kerrPhiRate(y.x + k3.x * ds, y.y + k3.y * ds, a, xi);

    vec4 prev = y;
    float prevPhi = phi;
    float prevArc = kerrAxisAzimuth(sinSq, y.y, y.w, xi, eta, a);
    float prevBranch = y.y * y.w < 0.0 ? -1.0 : 1.0;
    y += (ds / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
    // sin²θ is advanced by its own rate, −2μ dμ/dσ, and never by
    // subtracting μ² from one. That is the whole of the difference
    // near the axis: an accumulated quantity keeps its relative
    // precision at a millionth, a differenced one has none left.
    sinSq += (ds / 6.0) * (s1 + 2.0 * s2 + 2.0 * s3 + s4);
    phi += (ds / 6.0) * (w1 + 2.0 * w2 + 2.0 * w3 + w4);
    y = kerrProjectRadial(y, a, xi, eta);
    // The polar turning point, in the carried variable: Θ goes negative
    // exactly where sin²θ falls below the value that makes it vanish.
    // Reflect back across it and reverse the polar motion — clamping to
    // it instead would leave dμ at nothing and the ray stuck there.
    float turn = kerrPolarTurn(y.y, xi, eta, a);
    if (sinSq < turn) {
      sinSq = 2.0 * turn - sinSq;
      y.w = -y.w;
    }
    sinSq = clamp(sinSq, 0.0, 1.0);
    // Below a quarter, sin²θ is the trustworthy one and μ follows it;
    // above it, the reverse. Each is then formed where it loses nothing.
    if (sinSq < 0.25) y.y = (y.y < 0.0 ? -1.0 : 1.0) * sqrt(1.0 - sinSq);
    else sinSq = 1.0 - y.y * y.y;
    y.w = (y.w < 0.0 ? -1.0 : 1.0)
      * sqrt(max(kerrPolarFrom(sinSq, y.y, xi, eta, a), 0.0));
    // The half of the azimuth that the pole owns, taken as a
    // difference of its antiderivative rather than integrated. Exact
    // at any step size, and regular however near the axis the ray
    // passes — which is the whole reason it is written this way.
    phi += kerrAxisAzimuth(sinSq, y.y, y.w, xi, eta, a) - prevArc;
    // Crossing the equator turns sin²θ around at its far end and
    // moves the antiderivative onto its other branch, which the
    // difference above would otherwise read as a real sweep.
    if (prev.y * y.y < 0.0) phi -= prevBranch * equatorJump;

    if (flowSegment(prev, y, prevPhi, phi, .5*(prev+y), .5*(prevPhi+phi), ds, a, xi, eta,
      accum, transmittance, heldDensity, held)) {
      escaped = false; settled = true; break;
    }
  }

  // Whether the hole took the ray was already settled in closed form,
  // so running out of steps is never read as capture. It is a statement
  // about the coordinates rather than about the photon, and reading it
  // the other way drew black where sky plainly is.
  if (doomed) escaped = false;
  // The light came from where the trace ended up, which is against the
  // photon's own direction of travel.
  escapeDir = normalize(-kerrHeading(y, sinSq, phi, a, xi, eta));
  return accum;
}
`;
