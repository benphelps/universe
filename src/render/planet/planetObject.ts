import {
  Group,
  Mesh,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
  type WebGLCubeRenderTarget,
  type WebGLRenderer,
} from 'three';
import { deriveCirculation, type Circulation } from '../../universe/planet/circulation';
import type { Characterization } from '../../universe/planet/types';
import type { RingSystem } from '../../universe/rings/types';
import { applySecondSun } from '../lighting/secondSun';
import { createAtmosphereShell } from './atmosphereShell';
import { DeckBaker } from './deckBaker';
import { createGiantMaterial } from './giantMaterial';
import { createRingMesh } from './ringMaterial';
import { applyOccluders, type ShadowCaster } from './shadows';
import { createSolidPlanetMaterial } from './solidPlanetMaterial';

const UP = new Vector3(0, 1, 0);

/**
 * Renderable body at true shape (1 unit = 1 R⊕): banded envelope or solid
 * surface, oblateness, axial tilt, spin, atmosphere limb, and rings.
 * Works for planets and moons alike — both carry a Characterization.
 * Lighting comes from the star direction supplied each frame, so phases,
 * terminators, and eclipse shadows are exact.
 */
export class PlanetObject {
  readonly group = new Group();
  readonly radiusUnits: number;
  private readonly materials: ShaderMaterial[] = [];
  private readonly body: Mesh;
  private readonly spinRadPerDay: number;
  /** The derived atmosphere driving a giant's deck; null for solids. */
  private readonly circulation: Circulation | null;
  private readonly baker: DeckBaker | null;
  private deckA: WebGLCubeRenderTarget | null = null;
  private deckB: WebGLCubeRenderTarget | null = null;
  private bakedTA = 0;
  private bakedTB = 0;
  private baked = false;
  private readonly bakeIntervalDays: number;
  private readonly deckSize: number;

  constructor(
    readonly physical: Characterization,
    rings: RingSystem | null = null,
    orbitalPeriodDays?: number,
    deckSize = 256,
  ) {
    this.circulation = physical.appearance.banding
      ? deriveCirculation(physical, orbitalPeriodDays)
      : null;
    this.baker = this.circulation ? new DeckBaker(physical, this.circulation) : null;
    this.deckSize = deckSize;
    // Rebake cadence: often enough that band drift between bakes stays
    // a fraction of a texel, and churn stays a gentle crossfade.
    if (this.circulation) {
      let maxDrift = 0.01;
      for (const band of this.circulation.bands) {
        maxDrift = Math.max(maxDrift, Math.abs(band.driftRadPerDay));
      }
      this.bakeIntervalDays = Math.min(
        Math.max(0.006 / maxDrift, 0.02),
        Math.max(0.3 / this.circulation.churnPerDay, 0.02),
        10,
      );
    } else {
      this.bakeIntervalDays = 1;
    }
    const material = this.circulation
      ? createGiantMaterial(physical, this.circulation)
      : createSolidPlanetMaterial(physical);
    this.materials.push(material);

    this.radiusUnits = physical.bulk.radiusEarth;
    this.body = new Mesh(new SphereGeometry(1, 96, 64), material);
    this.body.scale.set(
      this.radiusUnits,
      this.radiusUnits * (1 - physical.bulk.oblateness),
      this.radiusUnits,
    );
    this.group.add(this.body);

    const shell = createAtmosphereShell(physical, this.radiusUnits);
    if (shell) {
      this.materials.push(shell.material as ShaderMaterial);
      this.group.add(shell);
    }

    if (rings) {
      const ringMesh = createRingMesh(rings, this.radiusUnits);
      ringMesh.rotation.x = -Math.PI / 2;
      this.materials.push(ringMesh.material as ShaderMaterial);
      this.group.add(ringMesh);

      // The rings' shadow band on the body, in the equatorial plane.
      const opacity = Math.min(0.85, rings.opticalDepth * 1.2);
      material.uniforms.uRingShadow.value = new Vector4(
        rings.innerPlanetRadii * this.radiusUnits,
        rings.outerPlanetRadii * this.radiusUnits,
        opacity,
        1,
      );
    }

    this.group.rotation.z = physical.rotation.obliquityRad;
    this.spinRadPerDay = (2 * Math.PI * 24) / physical.rotation.periodHours;
  }

  /** Advance spin and update the star-light directions (world space, toward each star).
   *  Pass the renderer so a giant can (re)bake its deck cubemaps. */
  update(
    simTimeDays: number,
    lightDirWorld: Vector3,
    lightColor: [number, number, number],
    light2Dir: Vector3 | null = null,
    light2Color: readonly [number, number, number] | null = null,
    renderer?: WebGLRenderer,
  ): void {
    this.body.rotation.y = simTimeDays * this.spinRadPerDay;
    for (const material of this.materials) {
      const uniforms = material.uniforms;
      uniforms.uLightDir.value = [lightDirWorld.x, lightDirWorld.y, lightDirWorld.z];
      if (uniforms.uLightColor) uniforms.uLightColor.value.setRGB(...lightColor);
      if (uniforms.uTimeDays) uniforms.uTimeDays.value = simTimeDays;
      applySecondSun(material, light2Dir, light2Color);
    }
    if (this.circulation) this.updateAtmosphere(simTimeDays, lightDirWorld, renderer);
    // Ring shadows follow the tilted equatorial plane.
    const ringNormal = new Vector3(0, 1, 0).applyQuaternion(this.group.quaternion);
    for (const material of this.materials) {
      if (material.uniforms.uRingNormal) material.uniforms.uRingNormal.value.copy(ringNormal);
    }
  }

  /** The deck: keep two bakes bracketing the sim time and crossfade
   *  between them — weather in motion at any time scale, with the
   *  pattern cost paid only when a bake rolls over. */
  private updateAtmosphere(
    simTimeDays: number,
    lightDirWorld: Vector3,
    renderer?: WebGLRenderer,
  ): void {
    const circulation = this.circulation!;
    const uniforms = this.materials[0].uniforms;

    const toObject = this.body.getWorldQuaternion(new Quaternion()).invert();
    const lightObj = lightDirWorld.clone().applyQuaternion(toObject).normalize();
    // Superrotation carries the hot point prograde of the substellar.
    const hotspot = lightObj
      .clone()
      .applyQuaternion(new Quaternion().setFromAxisAngle(UP, circulation.hotspotOffsetRad))
      .normalize();
    (uniforms.uHotspotDirObj.value as Vector3).copy(hotspot);

    if (!renderer || !this.baker) return;
    if (!this.deckA || !this.deckB) {
      this.deckA = DeckBaker.createTarget(this.deckSize);
      this.deckB = DeckBaker.createTarget(this.deckSize);
    }
    const interval = this.bakeIntervalDays;
    if (!this.baked || simTimeDays < this.bakedTA - interval) {
      // First frame, or time ran backwards past the window: bake both.
      this.bakedTA = simTimeDays;
      this.bakedTB = simTimeDays + interval;
      this.baker.bake(renderer, this.deckA, this.bakedTA, lightObj);
      this.baker.bake(renderer, this.deckB, this.bakedTB, lightObj);
      this.baked = true;
    } else if (simTimeDays >= this.bakedTB) {
      if (simTimeDays >= this.bakedTB + interval) {
        // Time leapt past the window: restart around the present.
        this.bakedTA = simTimeDays;
        this.bakedTB = simTimeDays + interval;
        this.baker.bake(renderer, this.deckA, this.bakedTA, lightObj);
        this.baker.bake(renderer, this.deckB, this.bakedTB, lightObj);
      } else {
        // Roll: the future bake becomes the present, bake a new future.
        const swap = this.deckA;
        this.deckA = this.deckB;
        this.deckB = swap;
        this.bakedTA = this.bakedTB;
        this.bakedTB = this.bakedTA + interval;
        this.baker.bake(renderer, this.deckB, this.bakedTB, lightObj);
      }
    }
    uniforms.uDeckA.value = this.deckA.texture;
    uniforms.uDeckB.value = this.deckB.texture;
    uniforms.uDeckMix.value = Math.min(
      1,
      Math.max(0, (simTimeDays - this.bakedTA) / (this.bakedTB - this.bakedTA)),
    );
  }

  /** Bodies that eclipse this one (world positions and radii in scene units). */
  setOccluders(occluders: ShadowCaster[], starAngularRadius: number): void {
    for (const material of this.materials) {
      applyOccluders(material, occluders, starAngularRadius);
    }
  }

  dispose(): void {
    this.baker?.dispose();
    this.deckA?.dispose();
    this.deckB?.dispose();
    this.group.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry.dispose();
        if (!Array.isArray(obj.material)) obj.material.dispose();
      }
    });
  }
}
