import { Vector3 } from 'three';

/** The body underfoot, as the walker sees it: a datum sphere, a height
 *  field, its gravity, and its water. */
export interface WalkSurface {
  radiusKm: number;
  gravityMs2: number;
  /** Full-detail terrain height above the datum, meters. */
  heightM(up: Vector3): number;
  /** Local water surface (sea, lake, or river stage), meters; −Infinity dry. */
  waterLevelM(up: Vector3): number;
}

export type WalkPhase = 'off' | 'landing' | 'walking' | 'liftoff';

export const EYE_HEIGHT_M = 1.7;
/** Chest-deep water stops a walker; shallower is wadable surf. */
export const MAX_WADE_M = 1.2;
const WALK_MS = 1.7;
const RUN_MS = 5.5;
/** Fixed human takeoff speed: jump height v²/2g emerges from the body. */
const JUMP_TAKEOFF_MS = 3.1;
/** Steepest climbable grade (rise over run) — loose rock stands near 40°. */
const CLIMB_LIMIT_GRADE = Math.tan((42 * Math.PI) / 180);
/** Ground slope is probed a stride ahead of the feet. */
const PROBE_M = 0.7;
/** A drop taller than a step means the ground left you: fall. */
const STEP_DOWN_M = 0.5;
const LANDING_S = 2.4;
const LIFTOFF_S = 1.4;

const HANDLED_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft']);

/**
 * First-person locomotion on a streamed surface: the final glide from
 * the wheel's floor down to standing eye height, WASD walking with
 * slope-limited climbing and wadable surf, jumps and falls under the
 * body's own gravity, and the reverse glide back up to the orbit
 * regime. Positions are planet-local km in the ground frame (terrain
 * static), so physics runs directly on the analytic height field the
 * meshes are built from.
 */
export class GroundWalker {
  phase: WalkPhase = 'off';
  private surface: WalkSurface | null = null;
  private readonly keys = new Set<string>();
  private glideFromM: number | null = null;
  private glideToM = 0;
  private glideT = 0;
  private airborne = false;
  private verticalMs = 0;
  /** World-frame tangent velocity carried through the air, m/s. */
  private readonly airVelocityMs = new Vector3();
  private listening = false;

  get active(): boolean {
    return this.phase !== 'off';
  }

  /** True while gaining altitude — a jump that beat the body's gravity. */
  get rising(): boolean {
    return this.airborne && this.verticalMs > 0;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (!HANDLED_CODES.has(e.code) || e.repeat) return;
    e.preventDefault();
    if (e.type === 'keydown') this.keys.add(e.code);
    else this.keys.delete(e.code);
  };

  /** Test hooks and the listeners share one input path. */
  press(code: string): void {
    this.keys.add(code);
  }

  release(code: string): void {
    this.keys.delete(code);
  }

  beginLanding(surface: WalkSurface): void {
    this.surface = surface;
    this.phase = 'landing';
    this.glideFromM = null;
    this.glideToM = EYE_HEIGHT_M;
    this.glideT = 0;
  }

  beginLiftoff(targetAltitudeM: number): void {
    if (this.phase !== 'walking') return;
    this.phase = 'liftoff';
    this.glideFromM = null;
    this.glideToM = targetAltitudeM;
    this.glideT = 0;
    this.airborne = false;
    this.verticalMs = 0;
    this.listen(false);
  }

  abort(): void {
    this.phase = 'off';
    this.surface = null;
    this.airborne = false;
    this.verticalMs = 0;
    this.glideFromM = null;
    this.listen(false);
  }

  /** Advance one frame; mutates positionKm (planet-local, ground frame). */
  update(dtSeconds: number, positionKm: Vector3, headingRad: number): void {
    const surface = this.surface;
    if (!surface || this.phase === 'off') return;
    const up = positionKm.clone().normalize();
    const groundM = surface.heightM(up);

    if (this.phase === 'landing' || this.phase === 'liftoff') {
      const altitudeM = positionKm.length() * 1000 - (surface.radiusKm * 1000 + groundM);
      if (this.glideFromM === null) this.glideFromM = altitudeM;
      this.glideT = Math.min(
        1,
        this.glideT + dtSeconds / (this.phase === 'landing' ? LANDING_S : LIFTOFF_S),
      );
      const t = this.glideT * this.glideT * (3 - 2 * this.glideT);
      const easedM = this.glideFromM + (this.glideToM - this.glideFromM) * t;
      positionKm.copy(up).multiplyScalar(surface.radiusKm + (groundM + easedM) / 1000);
      if (this.glideT >= 1) {
        if (this.phase === 'landing') {
          this.phase = 'walking';
          this.airborne = false;
          this.verticalMs = 0;
          this.listen(true);
        } else {
          this.abort();
        }
      }
      return;
    }

    if (this.airborne) {
      // Inverse-square falloff matters here: on a kilometer-scale
      // asteroid a hard jump genuinely outruns gravity.
      const radialM = positionKm.length() * 1000;
      const g = surface.gravityMs2 * ((surface.radiusKm * 1000) / radialM) ** 2;
      this.verticalMs -= g * dtSeconds;
      positionKm
        .addScaledVector(this.airVelocityMs, dtSeconds / 1000)
        .addScaledVector(up, (this.verticalMs * dtSeconds) / 1000);
      const upNew = positionKm.clone().normalize();
      const eyeKm = surface.radiusKm + (surface.heightM(upNew) + EYE_HEIGHT_M) / 1000;
      if (this.verticalMs <= 0 && positionKm.length() <= eyeKm) {
        positionKm.copy(upNew).multiplyScalar(eyeKm);
        this.airborne = false;
        this.verticalMs = 0;
      }
      return;
    }

    // Tangent basis shared with the viewer's horizon gaze, so W walks
    // where the camera looks.
    const north =
      Math.abs(up.y) > 0.99
        ? new Vector3(1, 0, 0)
        : new Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
    const east = new Vector3().crossVectors(north, up);
    const forward = north
      .multiplyScalar(Math.cos(headingRad))
      .addScaledVector(east, Math.sin(headingRad));
    const right = new Vector3().crossVectors(forward, up);

    const ahead = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const moving = ahead !== 0 || strafe !== 0;
    const direction = moving
      ? forward.clone().multiplyScalar(ahead).addScaledVector(right, strafe).normalize()
      : forward;
    let speedMs = 0;
    if (moving) {
      speedMs = this.keys.has('ShiftLeft') ? RUN_MS : WALK_MS;
      const aheadUp = positionKm
        .clone()
        .addScaledVector(direction, PROBE_M / 1000)
        .normalize();
      const aheadM = surface.heightM(aheadUp);
      const grade = (aheadM - groundM) / PROBE_M;
      if (grade > 0) speedMs *= Math.max(0, 1 - grade / CLIMB_LIMIT_GRADE);
      if (surface.waterLevelM(aheadUp) - aheadM > MAX_WADE_M) speedMs = 0;
    }

    if (this.keys.has('Space')) {
      this.keys.delete('Space');
      this.airborne = true;
      this.verticalMs = JUMP_TAKEOFF_MS;
      this.airVelocityMs.copy(direction).multiplyScalar(speedMs);
      return;
    }

    if (speedMs > 0) positionKm.addScaledVector(direction, (speedMs * dtSeconds) / 1000);
    const upNew = speedMs > 0 ? positionKm.clone().normalize() : up;
    const eyeKm =
      surface.radiusKm + ((speedMs > 0 ? surface.heightM(upNew) : groundM) + EYE_HEIGHT_M) / 1000;
    if (positionKm.length() * 1000 - eyeKm * 1000 > STEP_DOWN_M) {
      // Walked off an edge: keep the momentum, let gravity take it.
      this.airborne = true;
      this.verticalMs = 0;
      this.airVelocityMs.copy(direction).multiplyScalar(speedMs);
    } else {
      positionKm.copy(upNew).multiplyScalar(eyeKm);
    }
  }

  private listen(on: boolean): void {
    if (on === this.listening || typeof window === 'undefined') return;
    this.listening = on;
    if (on) {
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('keyup', this.onKey);
    } else {
      window.removeEventListener('keydown', this.onKey);
      window.removeEventListener('keyup', this.onKey);
      this.keys.clear();
    }
  }
}
