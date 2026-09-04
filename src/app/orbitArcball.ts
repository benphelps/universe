import { type Object3D, Quaternion, Vector3 } from 'three';

/** A drag across the whole viewport height turns this far at speed 1. */
const TURN_PER_SCREEN = 2 * Math.PI;

/**
 * The orbit drag for space, where nothing is up. A left-drag or one
 * finger swings the camera around its target in the screen's own
 * axes: a hand moving sideways turns the camera about what is up the
 * screen, a hand moving up or down about what is across it, and the
 * camera turns with its position, so whatever sat under the cursor
 * follows the hand and the target stays where it was in the frame.
 * There is no pole and no stop — over the top is just more of the
 * same — and the glide after release is measured in seconds rather
 * than frames, so it lasts the same fraction of a second at any frame
 * rate. Where the camera stands and which way it faces are one
 * rigid thing here; the ground, which has a true up, aims the camera
 * itself.
 */
export class OrbitArcball {
  /** What the camera swings around. */
  readonly target = new Vector3();
  enabled = true;
  /** Multiplies the turn a drag of a given length makes. */
  rotateSpeed = 1;
  /** Time constant of the glide after the hand comes off. */
  easeSeconds = 0.05;
  /** Queued turn about the screen's up and across axes, radians. */
  private pendingYaw = 0;
  private pendingPitch = 0;
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private readonly camera: Object3D,
    private readonly element: HTMLElement,
  ) {
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerEnd);
    element.addEventListener('pointercancel', this.onPointerEnd);
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerEnd);
    this.element.removeEventListener('pointercancel', this.onPointerEnd);
  }

  /** Queue the turn a drag of this many pixels makes. */
  turnBy(dxPixels: number, dyPixels: number): void {
    if (!this.enabled) return;
    const height = Math.max(this.element.clientHeight, 1);
    const scale = (TURN_PER_SCREEN * this.rotateSpeed) / height;
    this.pendingYaw += scale * dxPixels;
    this.pendingPitch += scale * dyPixels;
  }

  /** Apply this frame's share of the queued turn. */
  update(dtSeconds: number): void {
    const ease =
      this.easeSeconds > 0 ? Math.min(1, 1 - Math.exp(-dtSeconds / this.easeSeconds)) : 1;
    const yaw = this.pendingYaw * ease;
    const pitch = this.pendingPitch * ease;
    this.pendingYaw -= yaw;
    this.pendingPitch -= pitch;
    if (yaw !== 0 || pitch !== 0) this.orbit(yaw, pitch);
  }

  /**
   * One rigid turn of the camera about the target. The hand's motion
   * is the scene's: the camera goes the other way, so the sign is
   * negative on both axes.
   */
  private orbit(yaw: number, pitch: number): void {
    const offset = this.camera.position.clone().sub(this.target);
    if (offset.lengthSq() === 0) return;
    const screenUp = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const screenRight = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const turn = new Quaternion()
      .setFromAxisAngle(screenUp, -yaw)
      .multiply(new Quaternion().setFromAxisAngle(screenRight, -pitch));
    offset.applyQuaternion(turn);
    this.camera.position.copy(this.target).add(offset);
    this.camera.quaternion.premultiply(turn).normalize();
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.pointerId !== null) {
      // A second pointer ends the drag: two fingers are a pinch.
      this.pointerId = null;
      return;
    }
    if (e.pointerType !== 'touch' && e.button !== 0) return;
    this.pointerId = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (e.pointerType !== 'touch') {
      try {
        this.element.setPointerCapture(e.pointerId);
      } catch {
        // Without capture the drag simply ends at the viewport edge.
      }
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    // Disabled, the drag is still followed so that being handed the
    // controls mid-gesture continues from the hand, not from a jump.
    this.turnBy(dx, dy);
  };

  private readonly onPointerEnd = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    try {
      this.element.releasePointerCapture(e.pointerId);
    } catch {
      // Never captured, or already released.
    }
  };
}
