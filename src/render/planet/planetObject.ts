import { Group, Mesh, ShaderMaterial, SphereGeometry, type Vector3 } from 'three';
import type { Planet } from '../../universe/system/types';
import { createAtmosphereShell } from './atmosphereShell';
import { createGiantMaterial } from './giantMaterial';
import { createSolidPlanetMaterial } from './solidPlanetMaterial';

/**
 * Renderable planet at true shape (1 unit = 1 R⊕): banded giant or solid
 * surface, oblateness flattening, axial tilt, spin, and an atmosphere
 * limb. Lighting comes from the star direction supplied each frame, so
 * phases and terminators are exact.
 */
export class PlanetObject {
  readonly group = new Group();
  private readonly materials: ShaderMaterial[] = [];
  private readonly body: Mesh;
  private readonly spinRadPerDay: number;

  constructor(readonly planet: Planet) {
    const { physical } = planet;
    const material = physical.appearance.banding
      ? createGiantMaterial(planet)
      : createSolidPlanetMaterial(planet);
    this.materials.push(material);

    const radius = physical.bulk.radiusEarth;
    this.body = new Mesh(new SphereGeometry(1, 96, 64), material);
    this.body.scale.set(radius, radius * (1 - physical.bulk.oblateness), radius);
    this.group.add(this.body);

    const shell = createAtmosphereShell(planet, radius);
    if (shell) {
      this.materials.push(shell.material as ShaderMaterial);
      this.group.add(shell);
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
