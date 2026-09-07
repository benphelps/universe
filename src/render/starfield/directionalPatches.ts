import { Matrix4, PerspectiveCamera, Vector3, type Camera, type Object3D, type Vector4 } from 'three';

let cullingEnabled = true;
/** Explicit audit control for same-scene image/performance comparisons. */
export function setDirectionalPatchCulling(enabled: boolean): void { cullingEnabled = enabled; }

/** Conservative camera selection for tangent-plane sky patches. The
 * fragment shader still performs the exact rectangle test. */
export class DirectionalPatches {
  readonly visible: number[] = [];
  private readonly inverse = new Matrix4();
  private readonly eye = new Vector3();
  private readonly forward = new Vector3();
  private readonly scale = new Vector3();
  private readonly patches: Array<{ direction: Vector3; radius: number }>;

  constructor(directions: readonly Vector4[]) {
    this.patches = directions.map(a => ({
      direction: new Vector3(a.x, a.y, a.z).normalize(),
      // The square's corners are sqrt(2) half-extents from its centre.
      radius: Math.atan(Math.SQRT2 * a.w),
    }));
  }

  select(camera: Camera, dome: Object3D, radius: number): readonly number[] {
    this.visible.length = 0;
    let viewRadius = Math.PI;
    if (cullingEnabled && camera instanceof PerspectiveCamera) {
      this.scale.setFromMatrixScale(dome.matrixWorld);
      const minScale = Math.min(this.scale.x, this.scale.y, this.scale.z);
      const maxScale = Math.max(this.scale.x, this.scale.y, this.scale.z);
      this.inverse.copy(dome.matrixWorld).invert();
      this.eye.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(this.inverse);
      const offset = this.eye.length() / radius;
      if (offset < 1 && minScale > 0 && maxScale / minScale < 1.00001) {
        const p = camera.projectionMatrix.elements;
        // Include asymmetric sub-frusta and the eye's possible offset
        // inside the sphere (e.g. an offscreen sky capture).
        viewRadius = Math.atan(Math.hypot((1 + Math.abs(p[8])) / p[0], (1 + Math.abs(p[9])) / p[5]))
          + Math.asin(offset) + 1e-5;
        camera.getWorldDirection(this.forward).transformDirection(this.inverse);
      }
    }
    for (let i = 0; i < this.patches.length; i++) {
      const patch = this.patches[i], reach = viewRadius + patch.radius;
      if (reach >= Math.PI || this.forward.dot(patch.direction) >= Math.cos(reach)) this.visible.push(i);
    }
    return this.visible;
  }
}
