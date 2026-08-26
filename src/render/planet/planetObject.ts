import { Group, Mesh, Quaternion, ShaderMaterial, SphereGeometry, Vector3, Vector4 } from 'three';
import {
  activeStorms,
  bandFade01,
  deriveCirculation,
  MAX_ACTIVE_STORMS,
  type Circulation,
} from '../../universe/planet/circulation';
import type { Characterization } from '../../universe/planet/types';
import type { RingSystem } from '../../universe/rings/types';
import { applySecondSun } from '../lighting/secondSun';
import { createAtmosphereShell } from './atmosphereShell';
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

  constructor(
    readonly physical: Characterization,
    rings: RingSystem | null = null,
    orbitalPeriodDays?: number,
  ) {
    this.circulation = physical.appearance.banding
      ? deriveCirculation(physical, orbitalPeriodDays)
      : null;
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

  /** Advance spin and update the star-light directions (world space, toward each star). */
  update(
    simTimeDays: number,
    lightDirWorld: Vector3,
    lightColor: [number, number, number],
    light2Dir: Vector3 | null = null,
    light2Color: readonly [number, number, number] | null = null,
  ): void {
    this.body.rotation.y = simTimeDays * this.spinRadPerDay;
    for (const material of this.materials) {
      const uniforms = material.uniforms;
      uniforms.uLightDir.value = [lightDirWorld.x, lightDirWorld.y, lightDirWorld.z];
      if (uniforms.uLightColor) uniforms.uLightColor.value.setRGB(...lightColor);
      if (uniforms.uTimeDays) uniforms.uTimeDays.value = simTimeDays;
      applySecondSun(material, light2Dir, light2Color);
    }
    if (this.circulation) this.updateAtmosphere(simTimeDays, lightDirWorld);
    // Ring shadows follow the tilted equatorial plane.
    const ringNormal = new Vector3(0, 1, 0).applyQuaternion(this.group.quaternion);
    for (const material of this.materials) {
      if (material.uniforms.uRingNormal) material.uniforms.uRingNormal.value.copy(ringNormal);
    }
  }

  /** The live weather: the storm catalog's population at this sim time,
   *  and the star direction in the deck's own (spinning) frame for the
   *  locked regime's hotspot and crescent. */
  private updateAtmosphere(simTimeDays: number, lightDirWorld: Vector3): void {
    const circulation = this.circulation!;
    const uniforms = this.materials[0].uniforms;

    const storms = activeStorms(circulation, simTimeDays);
    const slots = uniforms.uStorms.value as Vector4[];
    for (let i = 0; i < MAX_ACTIVE_STORMS; i++) {
      const storm = storms[i];
      if (storm) {
        // Eruptions ride a negative size: the shader reads the flag.
        const size = storm.kind === 'eruption' ? -storm.sizeRad : storm.sizeRad;
        slots[i].set(storm.latRad, storm.lonRad, size, storm.age01);
      }
    }
    uniforms.uStormCount.value = storms.length;

    const fades = uniforms.uBandFade.value as number[];
    for (let i = 0; i < fades.length; i++) {
      const band = circulation.bands[i];
      fades[i] = band ? bandFade01(band, simTimeDays) : 0;
    }

    const toObject = this.body.getWorldQuaternion(new Quaternion()).invert();
    const lightObj = lightDirWorld.clone().applyQuaternion(toObject).normalize();
    (uniforms.uLightDirObj.value as Vector3).copy(lightObj);
    // Superrotation carries the hot point prograde of the substellar.
    const hotspot = lightObj
      .clone()
      .applyQuaternion(
        new Quaternion().setFromAxisAngle(UP, circulation.hotspotOffsetRad),
      )
      .normalize();
    (uniforms.uHotspotDirObj.value as Vector3).copy(hotspot);
  }

  /** Bodies that eclipse this one (world positions and radii in scene units). */
  setOccluders(occluders: ShadowCaster[], starAngularRadius: number): void {
    for (const material of this.materials) {
      applyOccluders(material, occluders, starAngularRadius);
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry.dispose();
        if (!Array.isArray(obj.material)) obj.material.dispose();
      }
    });
  }
}
