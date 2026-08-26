import {
  Camera,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type DataTexture,
} from 'three';
import type { Star } from '../../universe/star/types';
import { luminosityMultiplierAt } from '../../universe/star/variability';
import { CORONA_SIZE_FACTOR, createCoronaMaterial } from './coronaMaterial';
import { createPhotosphereMaterial } from './photosphereMaterial';

/**
 * Renderable star: photosphere shader sphere plus a camera-facing corona
 * billboard. Black holes render as a lightless disc (lensing comes later).
 */
export class StarObject {
  readonly group: Group;
  readonly star: Star;
  private readonly photosphere: ShaderMaterial | null;
  private readonly corona: ShaderMaterial | null;
  private readonly coronaMesh: Mesh | null = null;

  constructor(star: Star, lut: DataTexture) {
    this.star = star;
    this.group = new Group();

    if (star.stage === 'black-hole') {
      const disc = new Mesh(
        new SphereGeometry(1, 64, 32),
        new MeshBasicMaterial({ color: new Color(0, 0, 0) }),
      );
      disc.scale.setScalar(star.radius);
      this.group.add(disc);
      this.photosphere = null;
      this.corona = null;
      return;
    }

    this.photosphere = createPhotosphereMaterial(star, lut);
    const sphere = new Mesh(new SphereGeometry(1, 96, 64), this.photosphere);
    sphere.scale.setScalar(star.radius);
    // The spin axis: lean off the system plane's normal by the tilt,
    // swung toward its azimuth. Tilts past 90° spin retrograde.
    sphere.quaternion
      .setFromAxisAngle(new Vector3(0, 1, 0), star.activity.axialAzimuthRad)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), star.activity.axialTiltRad));
    this.group.add(sphere);

    this.corona = createCoronaMaterial(star);
    const corona = new Mesh(new PlaneGeometry(1, 1), this.corona);
    corona.scale.setScalar(star.radius * CORONA_SIZE_FACTOR);
    this.group.add(corona);
    this.coronaMesh = corona;
  }

  /** Advance shader time and photometric variability; billboard the corona. */
  update(simTimeDays: number, camera: Camera): void {
    // Surface detail and corona fade with apparent size: subpixel
    // granulation and wisps only alias, so the disc steps down to its
    // flat photosphere color long before the sprite takes over.
    const worldRadiusUnits = Math.max(this.star.radius, 1e-6) * this.group.scale.x;
    const distance = Math.max(camera.position.distanceTo(this.group.position), worldRadiusUnits);
    const angular = worldRadiusUnits / distance;
    const t = Math.max(0, Math.min(1, (angular - 0.004) / (0.05 - 0.004)));
    const detail = t * t * (3 - 2 * t);

    if (this.photosphere) {
      this.photosphere.uniforms.uTimeDays.value = simTimeDays;
      this.photosphere.uniforms.uDetailFade.value = detail;
      this.photosphere.uniforms.uLuminosityMultiplier.value = luminosityMultiplierAt(
        this.star,
        simTimeDays,
      );
    }
    if (this.corona) {
      this.corona.uniforms.uTimeDays.value = simTimeDays;
      this.corona.uniforms.uIntensity.value = 0.35 * detail;
    }
    if (this.coronaMesh) {
      this.coronaMesh.visible = detail > 0.01;
      this.coronaMesh.quaternion.copy(camera.quaternion);
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry.dispose();
        if (obj.material instanceof ShaderMaterial || obj.material instanceof MeshBasicMaterial) {
          obj.material.dispose();
        }
      }
    });
  }
}
