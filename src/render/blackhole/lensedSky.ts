import {
  CubeCamera,
  HalfFloatType,
  LinearMipmapLinearFilter,
  NoColorSpace,
  Vector3,
  WebGLCubeRenderTarget,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';

/**
 * The sky as it arrives at the hole.
 *
 * A bent ray's background is not what lies behind it on screen — it is
 * whatever the galaxy sends toward the hole from the direction the ray
 * finally escapes to. That is one fixed set of directions, so it is
 * captured once, from the hole itself, into a cube map: the galaxy's
 * own glow, its particle body, and every star of the nuclear cluster,
 * all of it then free to be lensed per-pixel instead of pasted flat
 * behind the shadow.
 *
 * The camera's own offset from the hole is nothing next to the parsecs
 * out to the nearest cluster star, so one capture serves every
 * viewpoint that gets close enough for the lensing to matter.
 *
 * Resolution is a compromise: the capture pays for the galaxy's whole
 * line-of-sight march six times over and holds six faces in memory, so
 * it cannot match the screen's angular resolution. Point sprites drawn
 * into it are scaled to compensate — see the size scale on the star
 * material — and what is left is a background softer than the screen,
 * which is why the hole only takes the sky over where lensing has
 * stretched it past the point of noticing.
 */
export class LensedSky {
  readonly target: WebGLCubeRenderTarget;
  private readonly camera: CubeCamera;

  constructor(size = 1024) {
    this.target = new WebGLCubeRenderTarget(size, {
      type: HalfFloatType,
      colorSpace: NoColorSpace,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
    });
    // Near and far span the whole scene: sky layers pin their own depth
    // anyway, and nothing here is meant to be clipped.
    this.camera = new CubeCamera(1, 1e18, this.target);
  }

  /**
   * Render the sky from `atWorldKm`, with `hidden` left out — the hole
   * itself above all, which would otherwise photograph its own shadow.
   */
  capture(renderer: WebGLRenderer, scene: Scene, atWorldKm: Vector3, hidden: Object3D[]): void {
    const was = hidden.map((object) => object.visible);
    for (const object of hidden) object.visible = false;
    const previousTarget = renderer.getRenderTarget();
    this.camera.position.copy(atWorldKm);
    this.camera.updateMatrixWorld(true);
    this.camera.update(renderer, scene);
    renderer.setRenderTarget(previousTarget);
    for (let i = 0; i < hidden.length; i++) hidden[i].visible = was[i];
  }

  /** Pixels per radian of one face: the faces span a right angle. */
  get pixelsPerRadian(): number {
    return this.target.width / (Math.PI / 2);
  }

  dispose(): void {
    this.target.dispose();
  }
}
