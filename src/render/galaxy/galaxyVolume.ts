import {
  AdditiveBlending,
  BackSide,
  Matrix3,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { waveParams, type GalacticPosition } from '../../universe/galaxy/density';
import { buildGalaxyRadianceGlsl } from '../glsl/galaxyRadiance';

const VERTEX = /* glsl */ `
// The dome is a unit sphere centered on the camera and never rotated,
// so the local vertex position IS the view ray — no planet-scale
// world coordinates ever enter the varying.
varying vec3 vRay;
void main() {
  vRay = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Directional background only: the ray-marched galaxy is infinitely
  // behind local geometry, even though its carrier dome follows the camera.
  gl_Position.z = 1e-24 * gl_Position.w;
}
`;

/**
 * The galaxy as a volume: the shared line-of-sight integral marched
 * per pixel from wherever the camera actually is. From inside it
 * reproduces the band; from outside the spiral, bulge, and dust
 * patchiness emerge from the same model the sky field and the black
 * hole's bent rays read.
 *
 * Built on first use, never at import: the wave belongs to a galaxy,
 * and reading it is what locks the session into one. A module-scope
 * shader would settle that question before the app had read the seed
 * off the URL.
 */
let fragmentMemo: string | null = null;

function fragment(): string {
  return (fragmentMemo ??= /* glsl */ `
varying vec3 vRay;
uniform vec3 uCamGalKpc;
uniform mat3 uWorldToGalaxy;
uniform float uMeanLum;
uniform float uOpacity;

${buildGalaxyRadianceGlsl(waveParams())}

void main() {
  vec3 dir = normalize(uWorldToGalaxy * vRay);
  gl_FragColor = vec4(galaxyRadiance(uCamGalKpc, dir, uMeanLum) * uOpacity, 1.0);
}
`);
}

/** Dome around the camera carrying the volumetric galaxy raymarch. */
export class GalaxyVolume {
  readonly mesh: Mesh;
  /** Where the camera stands in the galaxy, kpc — computed for the
   *  march and reused by anything else that needs a sightline. */
  readonly cameraGalacticKpc = new Vector3();
  private readonly material: ShaderMaterial;
  /** Row-major scene→galactic rotation (transpose of sceneFromGalaxy). */
  private readonly sceneToGalaxy: Matrix3;

  constructor(
    private readonly viewpointPc: GalacticPosition,
    sceneFromGalaxy: Float32Array,
  ) {
    const m = sceneFromGalaxy;
    // sceneFromGalaxy is row-major galactic→scene; its transpose goes back.
    this.sceneToGalaxy = new Matrix3().set(
      m[0], m[3], m[6],
      m[1], m[4], m[7],
      m[2], m[5], m[8],
    );
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: fragment(),
      uniforms: {
        uCamGalKpc: { value: new Vector3() },
        uWorldToGalaxy: { value: new Matrix3() },
        uMeanLum: { value: 1.76 },
        uOpacity: { value: 0 },
      },
      side: BackSide,
      blending: AdditiveBlending,
      // Keep background light in the early queue and let real scene depth
      // occlude it. A transparent, depth-disabled dome renders after opaque
      // planets and visibly lays the galactic band over their discs.
      transparent: false,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 24, 12), this.material);
    this.mesh.renderOrder = -8;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  set meanLuminosity(value: number) {
    this.material.uniforms.uMeanLum.value = value;
  }

  /**
   * Per-frame state: camera world position (km), the world→scene
   * rotation (inverse of the ground frame), fade opacity, and a dome
   * radius safely inside the far plane.
   */
  update(
    cameraWorldKm: Vector3,
    worldToScene: Matrix3,
    pcKm: number,
    opacity: number,
    domeRadiusKm: number,
  ): void {
    // Where the camera stands in the galaxy is not a drawing concern:
    // sightlines through the dust are wanted whether the dome is on or
    // not, so this is settled before anything asks about visibility.
    const worldToGalaxy = this.material.uniforms.uWorldToGalaxy.value as Matrix3;
    worldToGalaxy.multiplyMatrices(this.sceneToGalaxy, worldToScene);

    const camGal = this.material.uniforms.uCamGalKpc.value as Vector3;
    camGal
      .copy(cameraWorldKm)
      .applyMatrix3(worldToGalaxy)
      .divideScalar(pcKm);
    camGal.set(
      (camGal.x + this.viewpointPc.xPc) / 1000,
      (camGal.y + this.viewpointPc.yPc) / 1000,
      (camGal.z + this.viewpointPc.zPc) / 1000,
    );
    this.cameraGalacticKpc.copy(camGal);

    this.mesh.visible = opacity > 0.002;
    if (!this.mesh.visible) return;
    this.material.uniforms.uOpacity.value = opacity;
    this.mesh.position.copy(cameraWorldKm);
    this.mesh.scale.setScalar(domeRadiusKm);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
