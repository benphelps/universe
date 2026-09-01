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
import {
  stellarSurfaceModel,
  stellarSurfaceStateAt,
  type StellarSurfaceModel,
} from './surfaceModel';

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
  private readonly surfaceModel: StellarSurfaceModel | null;
  private readonly coronaIntensity: number;

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
      this.surfaceModel = null;
      this.coronaIntensity = 0;
      return;
    }

    this.surfaceModel = stellarSurfaceModel(star);
    const magneticActivity = Math.min(1, star.activity.spotCoverage * 10);
    this.coronaIntensity =
      star.stage === 'white-dwarf' || star.stage === 'neutron-star'
        ? 0.025
        : star.stage === 'brown-dwarf'
          ? 0.015
          : 0.08 + 0.12 * magneticActivity;
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
    // The glow writes no depth, so only draw order keeps it in front
    // of the sky: after the volume composite (reversed-Z, lowest order
    // last) or a dark cloud parsecs behind the sun multiplies its
    // flares away — and before the weather deck, which may honestly
    // stand in front of the sun and dim it. Bodies still occlude it by
    // depth as ever.
    corona.renderOrder = -2;
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
    const surfaceState = this.surfaceModel
      ? stellarSurfaceStateAt(this.star, this.surfaceModel, simTimeDays)
      : null;

    if (this.photosphere && surfaceState) {
      this.photosphere.uniforms.uRotationPhase.value = surfaceState.rotationPhase;
      this.photosphere.uniforms.uSpotRotationPhase.value = surfaceState.spotRotationPhase;
      this.photosphere.uniforms.uSpotCurrentEpoch.value = surfaceState.spotCurrentEpoch;
      this.photosphere.uniforms.uSpotPreviousEpoch.value = surfaceState.spotPreviousEpoch;
      this.photosphere.uniforms.uSpotPhase.value = surfaceState.spotPhase;
      this.photosphere.uniforms.uGranuleEpoch.value = surfaceState.granuleEpoch;
      this.photosphere.uniforms.uGranulePhase.value = surfaceState.granulePhase;
      this.photosphere.uniforms.uDetailFade.value = detail;
      this.photosphere.uniforms.uLuminosityMultiplier.value = luminosityMultiplierAt(
        this.star,
        simTimeDays,
      );
    }
    if (this.corona && surfaceState) {
      this.corona.uniforms.uRotationPhase.value = surfaceState.spotRotationPhase;
      this.corona.uniforms.uEvolutionEpoch.value = surfaceState.spotPreviousEpoch;
      this.corona.uniforms.uEvolutionPhase.value = surfaceState.spotPhase;
      this.corona.uniforms.uIntensity.value = this.coronaIntensity * detail;
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
