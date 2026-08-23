import { Color, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { elementsToState } from '../core/math/kepler';
import { DAY, SOLAR_RADIUS } from '../core/physics/constants';
import { RenderPipeline } from '../render/fx/pipeline';
import { TerrainChunkManager } from '../render/terrain/chunkManager';
import { createOceanSphere } from '../render/terrain/oceanSphere';
import { createSkyDome } from '../render/terrain/skyDome';
import { createTerrainMaterial } from '../render/terrain/terrainMaterial';
import { createSurfaceField, type SurfaceField } from '../universe/surface/field';
import { planetMu } from '../universe/system/generate';
import type { Planet, StarSystem } from '../universe/system/types';

const SUN_DISTANCE_KM = 50000;

/**
 * Surface view: descend from orbit to the ground of any solid world in
 * one unbroken zoom. The camera lives in planet-local coordinates
 * (units: km) and everything renders camera-relative, so precision holds
 * from space to a few meters above the terrain. Drag orbits/pans, wheel
 * changes altitude; the sun tracks the planet's real spin and orbit.
 */
export class SurfaceViewer {
  timeScaleDaysPerSecond = 0.02;
  private simTimeDays = 0;
  private disposed = false;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly pipeline: RenderPipeline;
  private readonly sunMesh: Mesh;
  private readonly terrainMaterial = createTerrainMaterial();
  private chunkManager: TerrainChunkManager | null = null;
  private ocean: Mesh | null = null;
  private sky: Mesh | null = null;
  private field: SurfaceField | null = null;
  private system: StarSystem | null = null;
  private planet: Planet | null = null;
  private radiusKm = 6371;
  private latitude = 0.45;
  private longitude = 0.8;
  private altitudeKm = 20000;
  private dragging = false;
  private lastFrameMs = performance.now();
  private readonly onResize = () => this.resize();

  constructor(private readonly container: HTMLElement) {
    this.camera = new PerspectiveCamera(55, 1, 0.01, 1e6);
    this.pipeline = new RenderPipeline(container, this.scene, this.camera);

    this.sunMesh = new Mesh(new SphereGeometry(1, 32, 16), new MeshBasicMaterial());
    this.scene.add(this.sunMesh);

    const canvas = this.pipeline.renderer.domElement;
    canvas.addEventListener('pointerdown', () => (this.dragging = true));
    window.addEventListener('pointerup', () => (this.dragging = false));
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const angularSpeed = (0.9 * Math.max(this.altitudeKm, 0.05)) / this.radiusKm / 500;
      this.longitude -= e.movementX * angularSpeed;
      this.latitude = Math.min(1.45, Math.max(-1.45, this.latitude + e.movementY * angularSpeed));
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.altitudeKm *= 1.0016 ** e.deltaY;
        this.altitudeKm = Math.min(this.radiusKm * 25, Math.max(0.004, this.altitudeKm));
      },
      { passive: false },
    );

    window.addEventListener('resize', this.onResize);
    this.resize();
    requestAnimationFrame(() => this.frame());
  }

  setPlanet(system: StarSystem, planet: Planet): void {
    this.system = system;
    this.planet = planet;
    this.field = createSurfaceField(planet.physical.seedHex, planet.physical);
    this.radiusKm = this.field.params.radiusM / 1000;
    this.altitudeKm = this.radiusKm * 2.2;

    // Start over the lit face: aim the camera at the substellar point.
    const { position } = elementsToState(planet.elements, planetMu(system, planet), 0);
    const toStar = new Vector3(-position.x, -position.z, position.y).normalize();
    this.latitude = Math.asin(Math.max(-1, Math.min(1, toStar.y))) * 0.6;
    this.longitude = Math.atan2(toStar.z, toStar.x);

    this.chunkManager?.dispose();
    this.chunkManager = new TerrainChunkManager(
      this.scene,
      this.terrainMaterial,
      planet.physical.seedHex,
      planet.physical,
    );

    if (this.ocean) {
      this.scene.remove(this.ocean);
      this.ocean.geometry.dispose();
    }
    this.ocean = null;
    if (this.field.seaLevelM > -1e8) {
      this.ocean = createOceanSphere(
        this.radiusKm + this.field.seaLevelM / 1000,
        planet.physical.appearance.oceanColor,
      );
      this.scene.add(this.ocean);
    }

    if (this.sky) this.scene.remove(this.sky);
    this.sky = null;
    if (planet.physical.atmosphere.class !== 'none') {
      this.sky = createSkyDome(planet.physical.atmosphere.scatteringColor);
      this.scene.add(this.sky);
    }

    const [r, g, b] = system.star.linearRgb;
    (this.sunMesh.material as MeshBasicMaterial).color = new Color(r * 2.5, g * 2.5, b * 2.5);
  }

  set exposure(value: number) {
    this.pipeline.exposure = value;
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.chunkManager?.dispose();
    this.terrainMaterial.dispose();
    this.pipeline.dispose();
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.pipeline.setSize(width, height);
  }

  private frame(): void {
    if (this.disposed) return;
    const now = performance.now();
    const dtSeconds = Math.min((now - this.lastFrameMs) / 1000, 0.1);
    this.lastFrameMs = now;
    this.simTimeDays += dtSeconds * this.timeScaleDaysPerSecond;

    if (this.system && this.planet && this.field && this.chunkManager) {
      const up = new Vector3(
        Math.cos(this.latitude) * Math.cos(this.longitude),
        Math.sin(this.latitude),
        Math.cos(this.latitude) * Math.sin(this.longitude),
      );

      // Hold the camera above both terrain and sea.
      const groundKm = Math.max(this.field.heightAt(up), this.field.seaLevelM) / 1000;
      const surfaceKm = this.radiusKm + Math.max(groundKm, -this.radiusKm * 0.01);
      this.altitudeKm = Math.max(this.altitudeKm, 0.004);
      const cameraKm = up.clone().multiplyScalar(surfaceKm + this.altitudeKm);

      // Nadir gaze from orbit blending to a horizon gaze near the ground.
      const north = new Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
      const horizonBlend = Math.min(1, this.altitudeKm / (0.12 * this.radiusKm));
      const forward = north
        .clone()
        .multiplyScalar(1 - horizonBlend)
        .addScaledVector(up, -0.15 - 0.85 * horizonBlend)
        .normalize();
      this.camera.position.set(0, 0, 0);
      this.camera.up.copy(up);
      this.camera.lookAt(forward);
      this.camera.near = Math.min(5, Math.max(0.002, this.altitudeKm * 0.2));
      this.camera.far = Math.max(this.radiusKm * 8, cameraKm.length() * 4);
      this.camera.updateProjectionMatrix();

      this.updateLighting(cameraKm, up);
      this.chunkManager.update(cameraKm);
      if (this.ocean) this.ocean.position.copy(cameraKm).negate();
    }

    this.pipeline.render();
    requestAnimationFrame(() => this.frame());
  }

  private updateLighting(cameraKm: Vector3, up: Vector3): void {
    if (!this.system || !this.planet) return;
    const { position } = elementsToState(
      this.planet.elements,
      planetMu(this.system, this.planet),
      this.simTimeDays * DAY,
    );
    // World frame: model (x, y, z out-of-plane) → (x, z, −y); the ground
    // stays fixed while the sun sweeps with the planet's spin.
    const spin =
      (2 * Math.PI * 24 * this.simTimeDays) / this.planet.physical.rotation.periodHours;
    const toStarModel = new Vector3(-position.x, -position.z, position.y).normalize();
    const sunDir = new Vector3(
      toStarModel.x * Math.cos(spin) + toStarModel.z * Math.sin(spin),
      toStarModel.y,
      -toStarModel.x * Math.sin(spin) + toStarModel.z * Math.cos(spin),
    );

    const distanceM = Math.hypot(position.x, position.y, position.z);
    const angularRadius = (this.system.star.radius * SOLAR_RADIUS) / distanceM;
    this.sunMesh.position.copy(sunDir).multiplyScalar(SUN_DISTANCE_KM);
    this.sunMesh.scale.setScalar(Math.max(SUN_DISTANCE_KM * angularRadius, 20));

    const lightColor = this.system.star.linearRgb;
    const sunView = sunDir.clone().transformDirection(this.camera.matrixWorldInverse);
    const { atmosphere } = this.planet.physical;
    const sunElevation = Math.max(0, sunDir.dot(up));
    // Aerial perspective belongs inside the atmosphere: fade with altitude.
    const scaleHeightKm = Math.max(atmosphere.scaleHeightKm, 3);
    const immersion = Math.exp(-this.altitudeKm / (8 * scaleHeightKm));
    const density =
      atmosphere.class === 'none'
        ? 0
        : 0.005 *
          Math.min(2, atmosphere.surfacePressureBar ** 0.6) *
          (0.3 + 0.7 * sunElevation) *
          immersion;
    const fog = new Color(...atmosphere.scatteringColor).multiply(
      new Color(...lightColor).multiplyScalar(0.35 + 0.65 * sunElevation),
    );

    for (const material of [this.terrainMaterial, this.ocean?.material as ShaderMaterial]) {
      if (!material) continue;
      material.uniforms.uLightDir.value = [sunView.x, sunView.y, sunView.z];
      material.uniforms.uLightColor.value.setRGB(...lightColor);
      material.uniforms.uFogColor.value.copy(fog);
      material.uniforms.uFogDensity.value = density;
    }

    if (this.sky) {
      const material = this.sky.material as ShaderMaterial;
      material.uniforms.uSunDir.value = [sunDir.x, sunDir.y, sunDir.z];
      material.uniforms.uUp.value = [up.x, up.y, up.z];
      material.uniforms.uLightColor.value.setRGB(...lightColor);
      const scaleHeightKm = Math.max(this.planet.physical.atmosphere.scaleHeightKm, 4);
      material.uniforms.uStrength.value = Math.exp(-this.altitudeKm / (10 * scaleHeightKm));
    }
  }
}
