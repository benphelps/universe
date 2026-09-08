import {
  CubeCamera,
  Color,
  type Camera,
  HalfFloatType,
  LinearMipmapLinearFilter,
  NoColorSpace,
  Vector3,
  WebGLCubeRenderTarget,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { skyVolumeVisible } from '../fx/skyVolumeVisibility';

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

  get captured(): boolean { return (this.target.texture.userData.lensedSkyVersion ?? 0) > 0; }

  /**
   * Render the sky from `atWorldKm`, with `hidden` left out — the hole
   * itself above all, which would otherwise photograph its own shadow.
   */
  capture(renderer: WebGLRenderer, scene: Scene, atWorldKm: Vector3, hidden: Object3D[], background?: Scene): void {
    const was = hidden.map((object) => object.visible);
    const previousTarget = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear, xr = renderer.xr.enabled;
    const color = renderer.getClearColor(new Color()), alpha = renderer.getClearAlpha();
    const mipmaps = this.target.texture.generateMipmaps;
    this.camera.position.copy(atWorldKm);
    this.camera.updateMatrixWorld(true);
    if (this.camera.coordinateSystem !== renderer.coordinateSystem) {
      this.camera.coordinateSystem = renderer.coordinateSystem;
      this.camera.updateCoordinateSystem();
    }
    try {
      for (const object of hidden) object.visible = false;
      renderer.xr.enabled = false;
      renderer.setClearColor(0, 0);
      this.target.texture.generateMipmaps = false;
      // Keep Three's cube orientations, but draw the volume layer and
      // foreground separately on each face. No screen-size intermediate:
      // the galaxy and clouds render directly at the cube's resolution.
      for (let i = 0; i < 6; i++) {
        const camera = this.camera.children[i] as Camera;
        renderer.setRenderTarget(this.target, i);
        renderer.autoClear = true;
        if (background) {
          const culled = background.children.filter(object => object.visible && !skyVolumeVisible(object, camera));
          culled.forEach(object => { object.visible = false; });
          try { renderer.render(background, camera); }
          finally { culled.forEach(object => { object.visible = true; }); }
          renderer.autoClear = false;
        }
        // Generate the complete mip chain only after the last foreground.
        this.target.texture.generateMipmaps = i === 5 && mipmaps;
        renderer.render(scene, camera);
      }
      this.target.texture.needsPMREMUpdate = true;
      this.target.texture.userData.lensedSkyVersion = (this.target.texture.userData.lensedSkyVersion ?? 0) + 1;
    } finally {
      this.target.texture.generateMipmaps = mipmaps;
      renderer.setRenderTarget(previousTarget, face, level);
      renderer.setClearColor(color, alpha);
      renderer.autoClear = autoClear;
      renderer.xr.enabled = xr;
      hidden.forEach((object, i) => { object.visible = was[i]; });
    }
  }

  /** Pixels per radian of one face: the faces span a right angle. */
  get pixelsPerRadian(): number {
    return this.target.width / (Math.PI / 2);
  }

  dispose(): void {
    this.target.dispose();
  }
}
