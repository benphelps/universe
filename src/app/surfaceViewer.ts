import { Color, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { elementsToState } from '../core/math/kepler';
import { DAY, EARTH_MASS, EARTH_RADIUS, G, SOLAR_RADIUS } from '../core/physics/constants';
import { RenderPipeline } from '../render/fx/pipeline';
import { TerrainChunkManager } from '../render/terrain/chunkManager';
import { createOceanSphere } from '../render/terrain/oceanSphere';
import { createSkyDome } from '../render/terrain/skyDome';
import { createTerrainMaterial } from '../render/terrain/terrainMaterial';
import type { Moon } from '../universe/moon/types';
import { createSurfaceField, type SurfaceField } from '../universe/surface/field';
import { planetMu } from '../universe/system/generate';
import type { Planet, StarSystem } from '../universe/system/types';

const SKY_OBJECT_DISTANCE_KM = 40000;

interface SkyMoon {
  moon: Moon;
  mesh: Mesh;
  mu: number;
}

/**
 * Surface view: descend from orbit to the ground in one unbroken zoom.
 * OrbitControls drives rotation around the planet (drag speed scaled to
 * altitude); the wheel changes altitude on a log scale; near the ground
 * the gaze tilts from nadir to the horizon. Chunk vertices are
 * anchor-relative, so precision holds without any origin rebasing —
 * model-view matrices multiply in doubles on the CPU.
 */
export class SurfaceViewer {
  // Near-frozen by default: fast rotators would otherwise sweep the sun
  // across the sky (and into night) within a minute of arriving.
  timeScaleDaysPerSecond = 0.001;
  private simTimeDays = 0;
  private disposed = false;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly pipeline: RenderPipeline;
  private readonly controls: OrbitControls;
  private readonly sunMesh: Mesh;
  private readonly terrainMaterial = createTerrainMaterial();
  private chunkManager: TerrainChunkManager | null = null;
  private ocean: Mesh | null = null;
  private sky: Mesh | null = null;
  private skyMoons: SkyMoon[] = [];
  private readonly skyMoonGroup = new Group();
  private field: SurfaceField | null = null;
  private system: StarSystem | null = null;
  private planet: Planet | null = null;
  private radiusKm = 6371;
  private altitudeKm = 20000;
  private lastFrameMs = performance.now();
  private readonly onResize = () => this.resize();

  constructor(private readonly container: HTMLElement) {
    this.camera = new PerspectiveCamera(55, 1, 0.01, 1e6);
    this.pipeline = new RenderPipeline(container, this.scene, this.camera);

    this.controls = new OrbitControls(this.camera, this.pipeline.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.target.set(0, 0, 0);

    this.sunMesh = new Mesh(new SphereGeometry(1, 32, 16), new MeshBasicMaterial());
    this.scene.add(this.sunMesh);
    this.scene.add(this.skyMoonGroup);

    this.pipeline.renderer.domElement.addEventListener(
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

    // Start over the lit face.
    const { position } = elementsToState(planet.elements, planetMu(system, planet), 0);
    const toStar = new Vector3(-position.x, -position.z, position.y).normalize();
    this.camera.position.copy(toStar).multiplyScalar(this.radiusKm * 3.2);
    this.camera.up.set(0, 1, 0);
    this.controls.update();

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

    // Major moons appear in the sky at their true directions.
    this.skyMoonGroup.clear();
    for (const entry of this.skyMoons) {
      entry.mesh.geometry.dispose();
      (entry.mesh.material as MeshBasicMaterial).dispose();
    }
    this.skyMoons = planet.moons
      .filter((moon) => moon.semiMajorAxisPlanetRadii < 100)
      .map((moon) => {
        const { landColorA, landColorB } = moon.physical.appearance;
        const raw = [
          ((landColorA[0] + landColorB[0]) / 2 + 0.3) * r,
          ((landColorA[1] + landColorB[1]) / 2 + 0.3) * g,
          ((landColorA[2] + landColorB[2]) / 2 + 0.3) * b,
        ];
        const peak = Math.max(...raw, 1e-3);
        const mesh = new Mesh(
          new SphereGeometry(1, 16, 8),
          new MeshBasicMaterial({
            color: new Color((raw[0] / peak) * 0.8, (raw[1] / peak) * 0.8, (raw[2] / peak) * 0.8),
          }),
        );
        this.skyMoonGroup.add(mesh);
        return {
          moon,
          mesh,
          mu: G * (planet.physical.bulk.massEarth + moon.physical.bulk.massEarth) * EARTH_MASS,
        };
      });
  }

  set exposure(value: number) {
    this.pipeline.exposure = value;
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
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
      // Drag sensitivity follows altitude so orbit and ground both feel right.
      this.controls.rotateSpeed = Math.min(1.2, Math.max(0.004, (1.4 * this.altitudeKm) / this.radiusKm));
      this.controls.update();

      const up = this.camera.position.clone().normalize();
      const groundKm = Math.max(this.field.heightAt(up), this.field.seaLevelM) / 1000;
      const surfaceKm = this.radiusKm + Math.max(groundKm, -this.radiusKm * 0.01);
      this.camera.position.copy(up).multiplyScalar(surfaceKm + this.altitudeKm);

      // Nadir gaze from orbit blending to a horizon gaze near the ground.
      const horizonBlend = 1 - Math.min(1, this.altitudeKm / (0.12 * this.radiusKm));
      if (horizonBlend > 0.01) {
        const north =
          Math.abs(up.y) > 0.99
            ? new Vector3(1, 0, 0)
            : new Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
        const forward = north
          .clone()
          .multiplyScalar(horizonBlend)
          .addScaledVector(up, -(1 - horizonBlend) - 0.12 * horizonBlend)
          .normalize();
        this.camera.up.copy(up);
        this.camera.lookAt(this.camera.position.clone().add(forward));
      }

      this.camera.near = Math.min(5, Math.max(0.002, this.altitudeKm * 0.2));
      this.camera.far = Math.max(this.radiusKm * 10, this.camera.position.length() * 5);
      this.camera.updateProjectionMatrix();

      this.updateSkyObjects(up);
      this.chunkManager.update(this.camera.position);
    }

    this.pipeline.render();
    requestAnimationFrame(() => this.frame());
  }

  private updateSkyObjects(up: Vector3): void {
    if (!this.system || !this.planet) return;
    const { position } = elementsToState(
      this.planet.elements,
      planetMu(this.system, this.planet),
      this.simTimeDays * DAY,
    );
    // The ground stays fixed; the sun sweeps with the planet's spin.
    const spin = (2 * Math.PI * 24 * this.simTimeDays) / this.planet.physical.rotation.periodHours;
    const toStarModel = new Vector3(-position.x, -position.z, position.y).normalize();
    const sunDir = new Vector3(
      toStarModel.x * Math.cos(spin) + toStarModel.z * Math.sin(spin),
      toStarModel.y,
      -toStarModel.x * Math.sin(spin) + toStarModel.z * Math.cos(spin),
    );

    const distanceM = Math.hypot(position.x, position.y, position.z);
    const angularRadius = (this.system.star.radius * SOLAR_RADIUS) / distanceM;
    this.sunMesh.position
      .copy(this.camera.position)
      .addScaledVector(sunDir, SKY_OBJECT_DISTANCE_KM);
    this.sunMesh.scale.setScalar(Math.max(SKY_OBJECT_DISTANCE_KM * angularRadius, 15));
    // Below the horizon the far side isn't loaded to occlude it: hide.
    this.sunMesh.visible = sunDir.dot(up) > -0.05;

    const tSeconds = this.simTimeDays * DAY;
    for (const { moon, mesh, mu } of this.skyMoons) {
      const state = elementsToState(moon.elements, mu, tSeconds);
      const moonKm = new Vector3(state.position.x, state.position.z, -state.position.y).divideScalar(1000);
      const toMoon = moonKm.clone().sub(this.camera.position);
      const distKm = toMoon.length();
      toMoon.divideScalar(distKm);
      const moonAngular = Math.max(moon.physical.bulk.radiusEarth * (EARTH_RADIUS / 1000) / distKm, 0.0012);
      mesh.position.copy(this.camera.position).addScaledVector(toMoon, SKY_OBJECT_DISTANCE_KM * 0.9);
      mesh.scale.setScalar(SKY_OBJECT_DISTANCE_KM * 0.9 * moonAngular);
      mesh.visible = toMoon.dot(up) > -0.05;
    }

    const lightColor = this.system.star.linearRgb;
    const sunView = sunDir.clone().transformDirection(this.camera.matrixWorldInverse);
    const { atmosphere } = this.planet.physical;
    const sunElevation = Math.max(0, sunDir.dot(up));
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
      this.sky.position.copy(this.camera.position);
      const material = this.sky.material as ShaderMaterial;
      material.uniforms.uSunDir.value = [sunDir.x, sunDir.y, sunDir.z];
      material.uniforms.uUp.value = [up.x, up.y, up.z];
      material.uniforms.uLightColor.value.setRGB(...lightColor);
      material.uniforms.uStrength.value = Math.exp(-this.altitudeKm / (10 * scaleHeightKm));
    }
  }
}
