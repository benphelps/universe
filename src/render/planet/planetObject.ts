import { Group, Mesh, ShaderMaterial, SphereGeometry, Vector3, Vector4 } from 'three';
import type { Characterization } from '../../universe/planet/types';
import type { RingSystem } from '../../universe/rings/types';
import { createAtmosphereShell } from './atmosphereShell';
import { createGiantMaterial } from './giantMaterial';
import { createRingMesh } from './ringMaterial';
import { applyOccluders, type ShadowCaster } from './shadows';
import { createSolidPlanetMaterial } from './solidPlanetMaterial';

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

  constructor(
    readonly physical: Characterization,
    rings: RingSystem | null = null,
  ) {
    const material = physical.appearance.banding
      ? createGiantMaterial(physical)
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

  /** Advance spin and update the star-light direction (world space, toward the star). */
  update(simTimeDays: number, lightDirWorld: Vector3, lightColor: [number, number, number]): void {
    this.body.rotation.y = simTimeDays * this.spinRadPerDay;
    for (const material of this.materials) {
      const uniforms = material.uniforms;
      uniforms.uLightDir.value = [lightDirWorld.x, lightDirWorld.y, lightDirWorld.z];
      if (uniforms.uLightColor) uniforms.uLightColor.value.setRGB(...lightColor);
      if (uniforms.uTimeDays) uniforms.uTimeDays.value = simTimeDays;
    }
    // Ring shadows follow the tilted equatorial plane.
    const ringNormal = new Vector3(0, 1, 0).applyQuaternion(this.group.quaternion);
    for (const material of this.materials) {
      if (material.uniforms.uRingNormal) material.uniforms.uRingNormal.value.copy(ringNormal);
    }
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
