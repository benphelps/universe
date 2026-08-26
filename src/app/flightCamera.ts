import { Vector3 } from 'three';

/** The body below, as the flyer sees it: a datum sphere, a height
 *  field, and its water. */
export interface FlightSurface {
  radiusKm: number;
  /** Full-detail terrain height above the datum, meters. */
  heightM(up: Vector3): number;
  /** Local water surface (sea, lake, or river stage), meters; −Infinity dry. */
  waterLevelM(up: Vector3): number;
}

export type FlightPhase = 'off' | 'flying';

/** The camera never dips closer to the ground (or water) than this. */
export const CLEARANCE_M = 2;
const MIN_SPEED_MS = 4;
/** Cruise speed grows with height above ground: skim slow, soar fast. */
const SPEED_PER_AGL = 0.9;
const BOOST = 6;
/** Velocity eases toward the stick with this time constant, seconds. */
const INERTIA_S = 0.18;

const HANDLED_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'ShiftLeft']);

/**
 * Free flight over a streamed surface: the ground regime is a camera,
 * not a body. W flies where the camera looks (pitch included), A/D
 * strafe along the horizon, Space rises and C dives, Shift boosts.
 * Speed scales with height above the terrain so skimming a valley
 * floor is walking pace and clearing a range is a keystroke, and the
 * camera never clips into ground or water. Positions are planet-local
 * km in the ground frame (terrain static), so the clamp runs directly
 * on the analytic height field the meshes are built from.
 */
export class FlightCamera {
  phase: FlightPhase = 'off';
  private surface: FlightSurface | null = null;
  private readonly keys = new Set<string>();
  private readonly velocityMs = new Vector3();
  private listening = false;

  get active(): boolean {
    return this.phase === 'flying';
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

  begin(surface: FlightSurface): void {
    this.surface = surface;
    this.phase = 'flying';
    this.velocityMs.set(0, 0, 0);
    this.listen(true);
  }

  stop(): void {
    this.phase = 'off';
    this.surface = null;
    this.velocityMs.set(0, 0, 0);
    this.listen(false);
  }

  /** Advance one frame; mutates positionKm (planet-local, ground frame). */
  update(dtSeconds: number, positionKm: Vector3, headingRad: number, pitchRad: number): void {
    const surface = this.surface;
    if (!surface || this.phase !== 'flying') return;
    const up = positionKm.clone().normalize();

    // Tangent basis shared with the viewer's horizon gaze, so W flies
    // where the camera looks.
    const north =
      Math.abs(up.y) > 0.99
        ? new Vector3(1, 0, 0)
        : new Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
    const east = new Vector3().crossVectors(north, up);
    const heading = north
      .multiplyScalar(Math.cos(headingRad))
      .addScaledVector(east, Math.sin(headingRad));
    const gaze = heading
      .clone()
      .multiplyScalar(Math.cos(pitchRad))
      .addScaledVector(up, Math.sin(pitchRad));
    const right = new Vector3().crossVectors(heading, up);

    const ahead = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const rise = (this.keys.has('Space') ? 1 : 0) - (this.keys.has('KeyC') ? 1 : 0);

    const groundM = Math.max(surface.heightM(up), surface.waterLevelM(up));
    const aglM = Math.max(0, positionKm.length() * 1000 - (surface.radiusKm * 1000 + groundM));
    const speedMs =
      Math.max(MIN_SPEED_MS, aglM * SPEED_PER_AGL) * (this.keys.has('ShiftLeft') ? BOOST : 1);

    const target = new Vector3();
    if (ahead !== 0 || strafe !== 0 || rise !== 0) {
      target
        .addScaledVector(gaze, ahead)
        .addScaledVector(right, strafe)
        .addScaledVector(up, rise)
        .normalize()
        .multiplyScalar(speedMs);
    }
    this.velocityMs.lerp(target, 1 - Math.exp(-dtSeconds / INERTIA_S));
    positionKm.addScaledVector(this.velocityMs, dtSeconds / 1000);

    // Hard floor above whatever is below — terrain or open water.
    const upNew = positionKm.clone().normalize();
    const floorKm =
      surface.radiusKm +
      (Math.max(surface.heightM(upNew), surface.waterLevelM(upNew)) + CLEARANCE_M) / 1000;
    if (positionKm.length() < floorKm) {
      positionKm.copy(upNew).multiplyScalar(floorKm);
      // Kill the downward component so the floor doesn't fight the stick.
      const radialMs = this.velocityMs.dot(upNew);
      if (radialMs < 0) this.velocityMs.addScaledVector(upNew, -radialMs);
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
