import { type Object3D, Vector3 } from 'three';

/** A drag across the whole viewport height turns this far at speed 1. */
const TURN_PER_SCREEN = 2 * Math.PI;
/** How close to the polar axis the camera may climb, radians. */
const POLE_MARGIN = 1e-4;

/**
 * A turntable that moves the camera and nothing else. A left-drag or
 * one finger swings the camera around its target about a polar axis
 * the owner sets — a body's spin axis over a planet, the galactic pole
 * out in the galaxy — never over the poles, and with a glide after
 * release measured in seconds rather than frames, so it lasts the same
 * fraction of a second at any frame rate. Where the camera looks is
 * the owner's to decide; this only decides where it stands.
 */
export class OrbitTurntable {
  /** What the camera swings around. */
  readonly target = new Vector3();
  /** The axis it swings about, unit length. */
  readonly axis = new Vector3(0, 1, 0);
  enabled = true;
  /** Multiplies the turn a drag of a given length makes. */
  rotateSpeed = 1;
  /** Time constant of the glide after the hand comes off. */
  easeSeconds = 0.05;
  private pendingAzimuth = 0;
  private pendingPolar = 0;
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
    this.pendingAzimuth += (TURN_PER_SCREEN * dxPixels * this.rotateSpeed) / height;
    this.pendingPolar += (TURN_PER_SCREEN * dyPixels * this.rotateSpeed) / height;
  }

  /** Apply this frame's share of the queued turn. */
  update(dtSeconds: number): void {
    const ease =
      this.easeSeconds > 0 ? Math.min(1, 1 - Math.exp(-dtSeconds / this.easeSeconds)) : 1;
    const azimuth = this.pendingAzimuth * ease;
    const polar = this.pendingPolar * ease;
    this.pendingAzimuth -= azimuth;
    this.pendingPolar -= polar;
    if (azimuth !== 0 || polar !== 0) this.orbit(azimuth, polar);
  }

  /**
   * Dragging right turns the scene to the right, so the camera goes
   * the other way about the axis; dragging down brings the scene's
   * top toward the eye, so the camera climbs toward the axis's pole,
   * stopping a hair short of it.
   */
  private orbit(azimuth: number, polar: number): void {
    const offset = this.camera.position.clone().sub(this.target);
    const radius = offset.length();
    if (radius === 0) return;
    offset.applyAxisAngle(this.axis, -azimuth);
    const phi = Math.acos(Math.max(-1, Math.min(1, offset.dot(this.axis) / radius)));
    const phiNext = Math.max(POLE_MARGIN, Math.min(Math.PI - POLE_MARGIN, phi - polar));
    const side = new Vector3().crossVectors(this.axis, offset);
    if (side.lengthSq() > 1e-30) offset.applyAxisAngle(side.normalize(), phiNext - phi);
    this.camera.position.copy(this.target).add(offset);
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
