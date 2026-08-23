import {
  Camera,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
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
    sphere.rotation.z = star.activity.axialTiltRad;
    this.group.add(sphere);

    this.corona = createCoronaMaterial(star);
    const corona = new Mesh(new PlaneGeometry(1, 1), this.corona);
    corona.scale.setScalar(star.radius * CORONA_SIZE_FACTOR);
    this.group.add(corona);
    this.coronaMesh = corona;
  }

  /** Advance shader time and photometric variability; billboard the corona. */
  update(simTimeDays: number, camera: Camera): void {
    if (this.photosphere) {
      this.photosphere.uniforms.uTimeDays.value = simTimeDays;
      this.photosphere.uniforms.uLuminosityMultiplier.value = luminosityMultiplierAt(
        this.star,
        simTimeDays,
      );
    }
    if (this.corona) this.corona.uniforms.uTimeDays.value = simTimeDays;
    this.coronaMesh?.quaternion.copy(camera.quaternion);
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
