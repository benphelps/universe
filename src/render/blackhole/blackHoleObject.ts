import {
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Mesh,
  NoColorSpace,
  NormalBlending,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type CubeTexture,
  type DataTexture,
  type PerspectiveCamera,
  type WebGLCubeRenderTarget,
  type WebGLRenderer,
} from 'three';
import { discPeakRadiusRg, horizonRadiusRg } from '../../core/physics/blackHole';
import { flowTemperature } from '../../universe/galaxy/accretionFlow';
import type { AccretionFlow } from '../../universe/galaxy/accretionFlow';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { FLOW_DRAW_SPAN, GEODESIC_GLSL, profileStretch } from './geodesicGlsl';
import { KERR_GLSL } from './kerrGlsl';

/** Where the flow's own inner edge lands in HDR: the shutter. Set so
 *  the hottest ring blooms without the disc behind it clipping to a
 *  white wall. Everything relative to it — the beaming asymmetry, the
 *  radial fall-off, the redshift — is physical. */
const DISC_EXPOSURE = 2.0;
/** Above this half-thickness the flow is drawn as a volume rather than
 *  a surface — the same threshold the shader branches on. A cold disc
 *  sits near 0.02 and a starved ion torus at 0.55, so nothing lands
 *  anywhere near the line. */
const THICK_FLOW = (aspectRatio: number): boolean => aspectRatio > 0.15;
/** Past this separation the shadow is a millionth of a pixel and the
 *  ray's start point stops fitting in a float: the nuclear cluster is
 *  all there is to see of the centre from out here, and it is enough. */
const RENDER_REACH_RG = 3e5;
/** Below this Eddington ratio a flow is not drawn at all. */
const FLOW_VISIBILITY_FLOOR = 1e-10;
/**
 * Resolution the geodesics are traced at, against the screen's.
 *
 * One ray per pixel per frame is the whole cost of the hole, and it is
 * not close: the rest of the scene at the galactic centre renders in
 * eight milliseconds, and the trace alone in a hundred and twenty. But
 * what it produces is nearly all smooth — a lensed sky and a flow that
 * vary slowly across the frame — and the two features that are not, the
 * shadow's edge and the photon ring, sit at a boundary decided in
 * closed form rather than by sampling. So the trace runs on its own
 * grid and is scaled up, while the stars, which have to stay points,
 * keep every pixel the display has.
 */
const TRACE_SCALE = 0.55;

const VERTEX = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  // Screen-filling and pinned just inside the reversed-Z far plane, so
  // anything real in the scene still occludes the hole.
  gl_Position = vec4(position.xy, 1e-24, 1.0);
}
`;

/** What the scene draws: the traced image, and nothing else. */
const COMPOSITE_FRAGMENT = /* glsl */ `
varying vec2 vNdc;
uniform sampler2D uTrace;
void main() {
  gl_FragColor = texture2D(uTrace, vNdc * 0.5 + 0.5);
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vNdc;
uniform mat3 uBhToScene;
uniform samplerCube uSkyCube;
uniform float uSkyOpacity;
uniform float uOpacity;

${SIMPLEX_NOISE_GLSL}
${KERR_GLSL}
${GEODESIC_GLSL}

void main() {
  vec3 viewRay = normalize(vec3(vNdc.x * uTanHalfFov.x, vNdc.y * uTanHalfFov.y, -1.0));
  vec3 dir = normalize(uViewToBh * viewRay);

  // Outside the reach of measurable bending the undisturbed background
  // is already on screen — hand back to it rather than redrawing it,
  // and spend no rays there.
  vec3 cam = uCamRg;
  float ahead = -dot(cam, dir);
  float impact = length(cam + dir * max(ahead, 0.0));
  float coverage = 1.0 - smoothstep(LENSING_REACH * 0.55, LENSING_REACH, impact);
  if (ahead <= 0.0 && length(cam) > LENSING_REACH) coverage = 0.0;
  if (coverage < 0.004) discard;

  vec3 escapeDir;
  bool escaped;
  float transmittance;
  vec3 light = traceGeodesic(dir, escapeDir, escaped, transmittance);

  // Whatever the ray finally points at, it points at from the hole:
  // the sky it collects is what the galaxy sends toward the hole from
  // there, which is exactly what the cube map holds.
  if (escaped && transmittance > 0.004) {
    vec3 skyDir = normalize(uBhToScene * escapeDir);
    light += transmittance * textureCube(uSkyCube, skyDir).rgb * uSkyOpacity;
  }

  gl_FragColor = vec4(light, coverage * uOpacity);
}
`;

/**
 * Everything the tracer needs to know about a hole. There is only one
 * kind, and only one scale in it: a stellar remnant and a galaxy's
 * nucleus differ by seven orders of magnitude in size and in nothing
 * else, so the same object draws both.
 */
export interface TracedHole {
  /** Dimensionless a★ = Jc/GM². */
  spin: number;
  /** GM/c², metres — the unit every length in the trace is quoted in. */
  gravitationalRadiusM: number;
  /** Unit spin axis; the flow lies square across it. */
  spinAxis: readonly [number, number, number];
  flow: AccretionFlow;
}

/**
 * A black hole drawn by tracing light instead of shading a surface.
 * Every pixel of the screen launches one ray backwards through the
 * Kerr geometry (see kerrGlsl), so the shadow, the photon
 * ring, the lensed galaxy behind, and the accretion flow's wrapped-over
 * image are all consequences of the same integration rather than
 * separate effects layered together. The flow it lights comes wholly
 * from the model: inner edge, temperature profile, thickness and
 * optical depth are the nucleus's, and colour is the same blackbody
 * table the stars use, read at the Doppler- and gravity-shifted
 * temperature each patch is actually seen at.
 */
export class BlackHoleObject {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly composite: ShaderMaterial;
  private readonly traceScene = new Scene();
  private readonly traceCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly traceQuad: Mesh;
  private readonly target: WebGLRenderTarget;
  private readonly bufferSize = new Vector2();
  private readonly bhFromScene = new Matrix3();
  private readonly cameraRotation = new Matrix3();
  private readonly worldToBh = new Matrix3();

  /** Kilometres per gravitational radius: the one number that turns
   *  the dimensionless geometry into this hole. */
  readonly kmPerRg: number;
  /** Orbital period at the flow's inner edge, seconds — the clock the
   *  turbulence keeps, since an eddy lasts about one turn of it. */
  private readonly innerPeriodS: number;
  /** Spin axis in scene coordinates — the accretion flow lies square
   *  across it, so this is what a camera frames itself against. */
  readonly spinAxisScene: Vector3;

  constructor(
    hole: TracedHole,
    lut: DataTexture,
    /** Row-major rotation from the frame the spin axis is quoted in to
     *  the scene's — the sky's galactic→scene matrix for the nucleus,
     *  the identity for a hole already described in scene coordinates. */
    sceneFromFrame: Float32Array,
  ) {
    this.kmPerRg = hole.gravitationalRadiusM / 1000;
    const flow = hole.flow;
    // No floor: Kerr propagation reaches the flow's own inner edge,
    // which for a starved torus is the horizon itself.
    const innerRender = flow.innerRadiusRg;
    // Brightness is shown against the flow's own peak, so that either
    // regime is readable — which would draw a starved hole's flow as
    // brightly as a quasar's if nothing said otherwise. Below a part in
    // ten billion of Eddington there is nothing there to see: the gas
    // is fainter than the sky behind it, and what the eye gets is the
    // lensing alone. That is the honest picture of very nearly every
    // black hole there is.
    const outerDrawn = flow.eddingtonRatio > FLOW_VISIBILITY_FLOOR
      ? Math.min(flow.outerRadiusRg, innerRender * FLOW_DRAW_SPAN)
      : 0;
    // Reference brightness: the hottest patch the trace can actually
    // reach, so the exposure means the same thing in either regime.
    const peakRadius = Math.max(discPeakRadiusRg(flow.innerRadiusRg), innerRender);
    const refTempK = Math.max(flowTemperature(flow, peakRadius), 1);
    const stretch = profileStretch(flow.profileExponent);
    // A thick flow is a path integral, not a surface, so a ray through
    // it collects many times what one crossing would give — that is
    // what a translucent torus is. Setting the shutter by how many
    // columns of its own gas a central ray actually runs through is
    // what puts the two regimes on the same exposure without telling
    // either one what its brightness ought to be.
    const columns = THICK_FLOW(flow.aspectRatio)
      ? (2 * Math.log(outerDrawn / innerRender)) /
        (Math.sqrt(2 * Math.PI) * flow.aspectRatio)
      : 1;

    // 2π(r^{3/2} + a) in units of r_g/c: the orbital period at the
    // flow's inner edge, which is the only timescale the gas has.
    const inner = Math.max(flow.innerRadiusRg, 1e-3);
    this.innerPeriodS =
      (2 * Math.PI * (inner ** 1.5 + hole.spin) * hole.gravitationalRadiusM) / 2.99792458e8;

    const { sceneFromBh } = spinFrames(hole.spinAxis, sceneFromFrame);
    this.bhFromScene.copy(sceneFromBh).transpose();
    const e = sceneFromBh.elements;
    // Column-major in three: the third column is the axis image.
    this.spinAxisScene = new Vector3(e[6], e[7], e[8]).normalize();

    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uCamRg: { value: new Vector3() },
        uViewToBh: { value: new Matrix3() },
        uTanHalfFov: { value: new Vector2(1, 1) },
        uBhToScene: { value: sceneFromBh },
        uSkyCube: { value: null as CubeTexture | null },
        uSkyOpacity: { value: 1 },
        uOpacity: { value: 0 },
        uSpin: { value: hole.spin },
        uHorizonRg: { value: horizonRadiusRg(hole.spin) },
        uInnerRg: { value: flow.innerRadiusRg },
        uInnerRenderRg: { value: innerRender },
        uOuterRg: { value: outerDrawn },
        uInnerTempK: { value: flow.innerTemperatureK },
        uProfileExp: { value: flow.profileExponent },
        uEdgeTaper: { value: flow.edgeTaper },
        uOpticalDepth: { value: -Math.log(Math.max(1e-3, 1 - flow.opacity)) },
        uOpacityExp: { value: flow.opacityExponent },
        uRefTempK: { value: refTempK },
        uProfileStretch: { value: stretch },
        uTurbSigma: { value: flow.turbulenceSigma },
        uAspect: { value: flow.aspectRatio },
        uFlowPhase: { value: 0 },
        uDiscGain: { value: DISC_EXPOSURE / columns },
        uLut: { value: lut },
      },
      blending: NormalBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    // The trace draws into its own target, at its own resolution, with
    // blending off so the target holds exactly what it computed.
    this.material.blending = NoBlending;
    this.material.transparent = false;
    this.material.depthTest = false;
    this.traceQuad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.traceQuad.frustumCulled = false;
    this.traceScene.add(this.traceQuad);
    this.target = new WebGLRenderTarget(2, 2, {
      type: HalfFloatType,
      colorSpace: NoColorSpace,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
    });

    this.composite = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      uniforms: { uTrace: { value: this.target.texture } },
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.composite);
    this.mesh.frustumCulled = false;
    // Reversed-Z flips three's render lists, so the *lowest* render
    // order draws last: the hole composites over every sky layer, all
    // of which it has already accounted for along its own rays.
    this.mesh.renderOrder = -40;
    this.mesh.visible = false;
  }

  /** The sky the bent rays land on, captured from the hole. */
  set sky(target: WebGLCubeRenderTarget) {
    this.material.uniforms.uSkyCube.value = target.texture;
  }

  /**
   * Per-frame state. The camera's offset from the hole and the world
   * rotation are all the trace needs; the sky opacity matches the
   * galaxy dome's so the lensed background and the unlensed one meet
   * seamlessly at the edge of the footprint.
   */
  update(
    camera: PerspectiveCamera,
    holeWorldKm: Vector3,
    worldToScene: Matrix3,
    opacity: number,
    skyOpacity: number,
    /** Sim time, seconds — the flow turns and re-forms on it. */
    timeS = 0,
  ): void {
    const uniforms = this.material.uniforms;
    this.worldToBh.multiplyMatrices(this.bhFromScene, worldToScene);
    const camRg = (uniforms.uCamRg.value as Vector3)
      .subVectors(camera.position, holeWorldKm)
      .applyMatrix3(this.worldToBh)
      .divideScalar(this.kmPerRg);

    const decades = Math.log10(RENDER_REACH_RG / Math.max(camRg.length(), 1));
    const alpha = opacity * Math.min(1, Math.max(0, decades * 2));
    this.mesh.visible = alpha > 0.002;
    if (!this.mesh.visible) return;
    uniforms.uOpacity.value = alpha;
    uniforms.uSkyOpacity.value = skyOpacity;
    uniforms.uFlowPhase.value = timeS / this.innerPeriodS;

    this.cameraRotation.setFromMatrix4(camera.matrixWorld);
    (uniforms.uViewToBh.value as Matrix3).multiplyMatrices(this.worldToBh, this.cameraRotation);

    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    (uniforms.uTanHalfFov.value as Vector2).set(tanHalf * camera.aspect, tanHalf);
  }

  /**
   * Trace the geodesics into the hole's own target. Called once a frame
   * before the scene is drawn, since the composite quad in the scene
   * does nothing but read the result.
   */
  render(renderer: WebGLRenderer): void {
    if (!this.mesh.visible) return;
    renderer.getDrawingBufferSize(this.bufferSize);
    const width = Math.max(2, Math.round(this.bufferSize.x * TRACE_SCALE));
    const height = Math.max(2, Math.round(this.bufferSize.y * TRACE_SCALE));
    if (this.target.width !== width || this.target.height !== height) {
      this.target.setSize(width, height);
    }
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    // Discarded rays must leave nothing behind, or the sky the hole
    // never touched would composite over the sky that is already there.
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(this.traceScene, this.traceCamera);
    renderer.setRenderTarget(previous);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.traceQuad.geometry.dispose();
    this.material.dispose();
    this.composite.dispose();
    this.target.dispose();
  }
}

/**
 * The hole's own frame: z along the spin axis, so the accretion flow
 * is the z = 0 plane and the trace never has to carry an orientation.
 */
function spinFrames(
  axis: readonly [number, number, number],
  sceneFromFrame: Float32Array,
): { sceneFromBh: Matrix3 } {
  const n = new Vector3(axis[0], axis[1], axis[2]).normalize();
  const seed = Math.abs(n.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  const e1 = new Vector3().crossVectors(seed, n).normalize();
  const e2 = new Vector3().crossVectors(n, e1);
  // Columns are the hole's basis expressed in the incoming frame.
  const bhToFrame = new Matrix3().set(
    e1.x, e2.x, n.x,
    e1.y, e2.y, n.y,
    e1.z, e2.z, n.z,
  );
  const m = sceneFromFrame;
  const frameToScene = new Matrix3().set(
    m[0], m[1], m[2],
    m[3], m[4], m[5],
    m[6], m[7], m[8],
  );
  return { sceneFromBh: new Matrix3().multiplyMatrices(frameToScene, bhToFrame) };
}
