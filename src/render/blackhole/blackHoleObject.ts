import {
  Matrix3,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  type CubeTexture,
  type DataTexture,
  type PerspectiveCamera,
  type WebGLCubeRenderTarget,
} from 'three';
import { discPeakRadiusRg } from '../../core/physics/blackHole';
import { flowTemperature } from '../../universe/galaxy/accretionFlow';
import type { GalacticNucleus } from '../../universe/galaxy/nucleus';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import {
  FLOW_DRAW_SPAN,
  GEODESIC_GLSL,
  profileStretch,
  RENDER_INNER_FLOOR_RG,
} from './geodesicGlsl';

/** Where the flow's own inner edge lands in HDR: the shutter. Set so
 *  the hottest ring blooms without the disc behind it clipping to a
 *  white wall. Everything relative to it — the beaming asymmetry, the
 *  radial fall-off, the redshift — is physical. */
const DISC_EXPOSURE = 2.0;
/** Past this separation the shadow is a millionth of a pixel and the
 *  ray's start point stops fitting in a float: the nuclear cluster is
 *  all there is to see of the centre from out here, and it is enough. */
const RENDER_REACH_RG = 3e5;

const VERTEX = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  // Screen-filling and pinned just inside the reversed-Z far plane, so
  // anything real in the scene still occludes the hole.
  gl_Position = vec4(position.xy, 1e-24, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vNdc;
uniform mat3 uBhToScene;
uniform samplerCube uSkyCube;
uniform float uSkyOpacity;
uniform float uOpacity;

${SIMPLEX_NOISE_GLSL}
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
 * A black hole drawn by tracing light instead of shading a surface.
 * Every pixel of the screen launches one ray backwards through the
 * Schwarzschild geometry (see geodesicGlsl), so the shadow, the photon
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
  private readonly bhFromScene = new Matrix3();
  private readonly cameraRotation = new Matrix3();
  private readonly worldToBh = new Matrix3();

  /** Kilometres per gravitational radius: the one number that turns
   *  the dimensionless geometry into this hole. */
  readonly kmPerRg: number;
  /** Spin axis in scene coordinates — the accretion flow lies square
   *  across it, so this is what a camera frames itself against. */
  readonly spinAxisScene: Vector3;

  constructor(
    nucleus: GalacticNucleus,
    lut: DataTexture,
    /** Row-major galactic→scene rotation, as the sky uses. */
    sceneFromGalaxy: Float32Array,
  ) {
    this.kmPerRg = nucleus.gravitationalRadiusM / 1000;
    const flow = nucleus.flow;
    const innerRender = Math.max(flow.innerRadiusRg, RENDER_INNER_FLOOR_RG);
    const outerDrawn = Math.min(flow.outerRadiusRg, innerRender * FLOW_DRAW_SPAN);
    // Reference brightness: the hottest patch the trace can actually
    // reach, so the exposure means the same thing in either regime.
    const peakRadius = Math.max(discPeakRadiusRg(flow.innerRadiusRg), innerRender);
    const refTempK = Math.max(flowTemperature(flow, peakRadius), 1);
    const stretch = profileStretch(flow.profileExponent);

    const { sceneFromBh } = spinFrames(nucleus.spinAxisGalactic, sceneFromGalaxy);
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
        uDiscGain: { value: DISC_EXPOSURE },
        uLut: { value: lut },
      },
      blending: NormalBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.material);
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

    this.cameraRotation.setFromMatrix4(camera.matrixWorld);
    (uniforms.uViewToBh.value as Matrix3).multiplyMatrices(this.worldToBh, this.cameraRotation);

    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    (uniforms.uTanHalfFov.value as Vector2).set(tanHalf * camera.aspect, tanHalf);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * The hole's own frame: z along the spin axis, so the accretion flow
 * is the z = 0 plane and the trace never has to carry an orientation.
 */
function spinFrames(
  axisGalactic: [number, number, number],
  sceneFromGalaxy: Float32Array,
): { sceneFromBh: Matrix3 } {
  const n = new Vector3(...axisGalactic).normalize();
  const seed = Math.abs(n.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  const e1 = new Vector3().crossVectors(seed, n).normalize();
  const e2 = new Vector3().crossVectors(n, e1);
  // Columns are the BH basis expressed in galactic coordinates.
  const bhToGalaxy = new Matrix3().set(
    e1.x, e2.x, n.x,
    e1.y, e2.y, n.y,
    e1.z, e2.z, n.z,
  );
  const m = sceneFromGalaxy;
  const galaxyToScene = new Matrix3().set(
    m[0], m[1], m[2],
    m[3], m[4], m[5],
    m[6], m[7], m[8],
  );
  return { sceneFromBh: new Matrix3().multiplyMatrices(galaxyToScene, bhToGalaxy) };
}
