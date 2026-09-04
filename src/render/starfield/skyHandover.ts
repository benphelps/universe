import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import type { StarfieldBackdrop } from './starfieldBackdrop';

/** How long the next bake takes to replace the held one, seconds. */
const HANDOVER_SECONDS = 1;

/**
 * A sky's bake, kept standing through a short jump.
 *
 * The glow, the rifts and the nebula sprites take a second or two to
 * bake for a new viewpoint, and from a neighbouring star they are very
 * nearly the same sky. Rather than go dark for the wait, the last bake
 * is held — turned into the new system's frame, since every system's
 * frame sits at its own orientation in the galaxy — and crossfaded
 * out once the next bake stands. It is a stand-in, not the sky: a
 * nearby cloud sits a few degrees from where it will land.
 */
export class SkyHandover {
  private readonly relative = new Quaternion();
  private fade = 0;

  constructor(
    readonly backdrop: StarfieldBackdrop,
    private readonly sceneFromGalaxy: Float32Array,
  ) {}

  get group(): Group {
    return this.backdrop.group;
  }

  /** The held bake's share of the sky: whole until the next stands. */
  get heldShare(): number {
    return 1 - this.fade;
  }

  /** The next bake's share as it takes over. */
  get nextShare(): number {
    return this.fade;
  }

  /** Turn the held bake into another system's frame: held-scene
   *  vectors back to galactic, then into the next scene. */
  aim(sceneFromGalaxy: Float32Array): void {
    const held = this.sceneFromGalaxy;
    const next = sceneFromGalaxy;
    const r = (i: number, j: number): number =>
      next[i * 3] * held[j * 3] + next[i * 3 + 1] * held[j * 3 + 1] + next[i * 3 + 2] * held[j * 3 + 2];
    const m = new Matrix4().set(
      r(0, 0), r(0, 1), r(0, 2), 0,
      r(1, 0), r(1, 1), r(1, 2), 0,
      r(2, 0), r(2, 1), r(2, 2), 0,
      0, 0, 0, 1,
    );
    this.relative.setFromRotationMatrix(m);
  }

  /** Stand where the sky stands this frame. */
  follow(frameQuat: Quaternion, positionKm: Vector3, scale: number): void {
    this.group.quaternion.copy(frameQuat).multiply(this.relative);
    this.group.position.copy(positionKm);
    this.group.scale.setScalar(scale);
  }

  /** Let the next bake take over; true once the held one is done. */
  advance(dtSeconds: number, nextStanding: boolean): boolean {
    if (!nextStanding) return false;
    this.fade = Math.min(1, this.fade + dtSeconds / HANDOVER_SECONDS);
    return this.fade >= 1;
  }
}
