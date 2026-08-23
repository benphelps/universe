import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { elementsToState, orbitPath } from '../core/math/kepler';
import { DAY, EARTH_MASS, EARTH_RADIUS, G, SOLAR_RADIUS } from '../core/physics/constants';
import { createAtmosphereShell } from '../render/planet/atmosphereShell';
import { PlanetObject } from '../render/planet/planetObject';
import { createRingMesh } from '../render/planet/ringMaterial';
import { applyOccluders } from '../render/planet/shadows';
import { RenderPipeline } from '../render/fx/pipeline';
import { StarfieldBackdrop } from '../render/starfield/starfieldBackdrop';
import { TerrainChunkManager } from '../render/terrain/chunkManager';
import { createOceanMaterial } from '../render/terrain/oceanSphere';
import { createSkyDome } from '../render/terrain/skyDome';
import { createTerrainMaterial } from '../render/terrain/terrainMaterial';
import type { Moon } from '../universe/moon/types';
import { createSurfaceField, type SurfaceField } from '../universe/surface/field';
import { planetMu } from '../universe/system/generate';
import { getSkyField } from './skyService';
import type { Planet, StarSystem } from '../universe/system/types';

const SKY_OBJECT_DISTANCE_KM = 40000;
const EARTH_RADIUS_KM = EARTH_RADIUS / 1000;

interface MoonEntry {
  moon: Moon;
  object: PlanetObject;
  marker: Mesh;
  mu: number;
}

/** Model frame (z out of plane) → viewer world frame. */
function toWorld(p: { x: number; y: number; z: number }): Vector3 {
  return new Vector3(p.x, p.z, -p.y);
}

/**
 * The one body viewer (units: km): a continuous zoom from orbital
 * distances to the ground. Solid worlds render as streamed terrain at
 * every altitude — the same geography from space and from the surface —
 * while gas envelopes render as banded shader spheres. Everything else
 * (sun at true angular size, real moons with orbit guides and eclipse
 * shadows, rings, atmosphere limb, ground sky, star backdrop) is shared,
 * so there is no seam between "planet" and "surface" rendering.
 */
export class BodyViewer {
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
  private oceanMaterial: ShaderMaterial | null = null;
  private chunkManager: TerrainChunkManager | null = null;
  private backdrop: StarfieldBackdrop | null = null;
  private atmosphereShell: Mesh | null = null;
  private occlusionGlobe: Mesh | null = null;
  private ringMesh: Mesh | null = null;
  private bodyObject: PlanetObject | null = null;
  private sky: Mesh | null = null;
  private moonGroup: Group | null = null;
  private moons: MoonEntry[] = [];
  private field: SurfaceField | null = null;
  private system: StarSystem | null = null;
  private planet: Planet | null = null;
  private radiusKm = 6371;
  private altitudeKm = 20000;
  private minAltitudeKm = 0.05;
  private headingRad = 0;
  private pitchRad = 0;
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

    // Additive and late-ordered: the sun blazes through the daytime sky
    // dome; the depth buffer (terrain, occlusion globe, body sphere)
    // eclipses it per-fragment when it passes behind the planet.
    this.sunMesh = new Mesh(
      new SphereGeometry(1, 32, 16),
      new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    this.sunMesh.renderOrder = 5;
    this.scene.add(this.sunMesh);

    // Right-drag turns the head at low altitude (left-drag moves over
    // the surface via OrbitControls).
    this.pipeline.renderer.domElement.addEventListener('pointermove', (e) => {
      if ((e.buttons & 2) === 0) return;
      this.headingRad -= e.movementX * 0.004;
      this.pitchRad = Math.min(1.1, Math.max(-0.6, this.pitchRad - e.movementY * 0.003));
    });

    this.pipeline.renderer.domElement.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.altitudeKm *= 1.0016 ** e.deltaY;
        this.altitudeKm = Math.min(this.radiusKm * 60, Math.max(this.minAltitudeKm, this.altitudeKm));
      },
      { passive: false },
    );

    window.addEventListener('resize', this.onResize);
    this.resize();
    requestAnimationFrame(() => this.frame());
  }

  setPlanet(system: StarSystem, planet: Planet): void {
    this.clearBody();
    this.system = system;
    this.planet = planet;
    const solid = !planet.physical.appearance.banding;
    this.radiusKm = planet.physical.bulk.radiusEarth * EARTH_RADIUS_KM;
    this.altitudeKm = this.radiusKm * 2.2;
    // Envelopes have no ground: keep clear of the cloud deck.
    this.minAltitudeKm = solid ? 0.05 : this.radiusKm * 0.05;

    // Start over the lit face, offset so sunlight rakes and casts relief.
    const { position } = elementsToState(planet.elements, planetMu(system, planet), 0);
    const toStar = new Vector3(-position.x, -position.z, position.y).normalize();
    const arrival = toStar.clone().applyAxisAngle(new Vector3(0, 1, 0), 0.7).normalize();
    this.camera.position.copy(arrival).multiplyScalar(this.radiusKm * 3.2);
    this.camera.up.set(0, 1, 0);
    this.controls.update();

    // Face the sun's azimuth on arrival so descending keeps it in view.
    const north =
      Math.abs(arrival.y) > 0.99
        ? new Vector3(1, 0, 0)
        : new Vector3(0, 1, 0).addScaledVector(arrival, -arrival.y).normalize();
    const east = new Vector3().crossVectors(north, arrival);
    const sunTangent = toStar.clone().addScaledVector(arrival, -toStar.dot(arrival));
    this.headingRad = Math.atan2(sunTangent.dot(east), sunTangent.dot(north));
    this.pitchRad = 0;

    getSkyField(system.seedHex).then((sky) => {
      if (this.disposed || this.system !== system) return;
      this.backdrop = new StarfieldBackdrop(sky, 2000);
      this.scene.add(this.backdrop.group);
    });

    if (solid) {
      this.field = createSurfaceField(planet.physical.seedHex, planet.physical);
      this.oceanMaterial = createOceanMaterial(planet.physical.appearance.oceanColor);
      this.chunkManager = new TerrainChunkManager(
        this.scene,
        this.terrainMaterial,
        this.oceanMaterial,
        planet.physical.seedHex,
        planet.physical,
      );

      if (planet.physical.atmosphere.class !== 'none') {
        this.sky = createSkyDome(planet.physical.atmosphere.scatteringColor);
        this.scene.add(this.sky);
      }
      this.atmosphereShell = createAtmosphereShell(planet.physical, this.radiusKm);
      if (this.atmosphereShell) this.scene.add(this.atmosphereShell);
      if (planet.rings) {
        this.ringMesh = createRingMesh(planet.rings, this.radiusKm);
        this.ringMesh.rotation.x = -Math.PI / 2;
        this.scene.add(this.ringMesh);
      }

      // Depth-only globe: writes the planet body's depth even where
      // terrain isn't loaded, so sky objects eclipse per-fragment.
      this.occlusionGlobe = new Mesh(
        new SphereGeometry(this.radiusKm - (this.field.params.reliefM * 1.2) / 1000, 96, 48),
        new MeshBasicMaterial({ colorWrite: false }),
      );
      this.occlusionGlobe.renderOrder = -5;
      this.scene.add(this.occlusionGlobe);
    } else {
      // Gas envelope: the banded shader sphere carries the body, its
      // atmosphere limb, and its rings (all inside PlanetObject).
      this.bodyObject = new PlanetObject(planet.physical, planet.rings);
      this.bodyObject.group.scale.setScalar(EARTH_RADIUS_KM);
      this.scene.add(this.bodyObject.group);
    }

    const [r, g, b] = system.star.linearRgb;
    (this.sunMesh.material as MeshBasicMaterial).color = new Color(r * 2.5, g * 2.5, b * 2.5);

    // Real moons on their orbits with guides, markers, and eclipse shadows.
    this.moonGroup = new Group();
    this.moons = planet.moons
      .filter((moon) => moon.semiMajorAxisPlanetRadii < 100)
      .map((moon) => {
        const object = new PlanetObject(moon.physical, null);
        object.group.scale.setScalar(EARTH_RADIUS_KM);
        this.moonGroup!.add(object.group);

        const points = orbitPath(moon.elements, 128).map((p) => toWorld(p).divideScalar(1000));
        this.moonGroup!.add(
          new Line(
            new BufferGeometry().setFromPoints(points),
            new LineBasicMaterial({ color: 0x6a7a94, transparent: true, opacity: 0.22 }),
          ),
        );

        // Adaptive marker: star-tinted at fixed brightness.
        const { landColorA, landColorB } = moon.physical.appearance;
        const raw = [
          ((landColorA[0] + landColorB[0]) / 2 + 0.3) * r,
          ((landColorA[1] + landColorB[1]) / 2 + 0.3) * g,
          ((landColorA[2] + landColorB[2]) / 2 + 0.3) * b,
        ];
        const peak = Math.max(...raw, 1e-3);
        const marker = new Mesh(
          new SphereGeometry(1, 12, 6),
          new MeshBasicMaterial({
            color: new Color((raw[0] / peak) * 0.85, (raw[1] / peak) * 0.85, (raw[2] / peak) * 0.85),
          }),
        );
        object.group.add(marker);
        return {
          moon,
          object,
          marker,
          mu: G * (planet.physical.bulk.massEarth + moon.physical.bulk.massEarth) * EARTH_MASS,
        };
      });
    this.scene.add(this.moonGroup);
  }

  set exposure(value: number) {
    this.pipeline.exposure = value;
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.clearBody();
    this.terrainMaterial.dispose();
    this.sunMesh.geometry.dispose();
    (this.sunMesh.material as MeshBasicMaterial).dispose();
    this.pipeline.dispose();
  }

  private clearBody(): void {
    this.chunkManager?.dispose();
    this.chunkManager = null;
    this.oceanMaterial?.dispose();
    this.oceanMaterial = null;
    this.field = null;
    for (const mesh of [this.atmosphereShell, this.occlusionGlobe, this.ringMesh, this.sky]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      if (!Array.isArray(mesh.material)) mesh.material.dispose();
    }
    this.atmosphereShell = null;
    this.occlusionGlobe = null;
    this.ringMesh = null;
    this.sky = null;
    if (this.bodyObject) {
      this.scene.remove(this.bodyObject.group);
      this.bodyObject.dispose();
      this.bodyObject = null;
    }
    if (this.moonGroup) {
      this.scene.remove(this.moonGroup);
      for (const entry of this.moons) entry.object.dispose();
      this.moonGroup.traverse((obj) => {
        if (obj instanceof Line) {
          obj.geometry.dispose();
          if (!Array.isArray(obj.material)) obj.material.dispose();
        }
      });
      this.moonGroup = null;
      this.moons = [];
    }
    if (this.backdrop) {
      this.scene.remove(this.backdrop.group);
      this.backdrop.dispose();
      this.backdrop = null;
    }
  }

  private skyObjectDistanceKm(): number {
    return Math.min(SKY_OBJECT_DISTANCE_KM, Math.max(2500, this.altitudeKm * 60));
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

    if (this.system && this.planet) {
      this.controls.rotateSpeed = Math.min(
        1.2,
        Math.max(0.012, (1.4 * this.altitudeKm) / this.radiusKm),
      );
      this.controls.update();

      const up = this.camera.position.clone().normalize();
      const groundKm = this.field
        ? Math.max(this.field.heightAt(up), this.field.seaLevelM) / 1000
        : 0;
      const surfaceKm = this.radiusKm + Math.max(groundKm, -this.radiusKm * 0.01);
      this.altitudeKm = Math.max(this.altitudeKm, this.minAltitudeKm);
      this.camera.position.copy(up).multiplyScalar(surfaceKm + this.altitudeKm);

      // Nadir gaze from orbit blending to a steerable horizon gaze near
      // the ground. Orientation set via quaternion only: camera.up must
      // stay world-Y or OrbitControls rolls over on the way back out.
      const horizonBlend = 1 - Math.min(1, this.altitudeKm / (0.12 * this.radiusKm));
      if (horizonBlend > 0.01) {
        const north =
          Math.abs(up.y) > 0.99
            ? new Vector3(1, 0, 0)
            : new Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
        const east = new Vector3().crossVectors(north, up);
        const heading = north
          .clone()
          .multiplyScalar(Math.cos(this.headingRad))
          .addScaledVector(east, Math.sin(this.headingRad));
        const vertical = -(1 - horizonBlend) + (-0.12 + Math.sin(this.pitchRad)) * horizonBlend;
        const forward = heading.multiplyScalar(horizonBlend).addScaledVector(up, vertical).normalize();
        const gaze = new Matrix4().lookAt(
          this.camera.position,
          this.camera.position.clone().add(forward),
          up,
        );
        this.camera.quaternion.setFromRotationMatrix(gaze);
      }

      // Tight depth range; far reaches the outermost moon when present.
      const skyDistanceKm = this.skyObjectDistanceKm();
      const moonMaxKm = this.moons.reduce(
        (max, { moon }) => Math.max(max, moon.elements.semiMajorAxis / 1000),
        0,
      );
      this.camera.near = Math.min(2000, Math.max(0.006, this.altitudeKm * 0.15));
      this.camera.far = Math.max(
        skyDistanceKm * 1.6,
        this.camera.position.length() * 2.5,
        moonMaxKm * 1.5,
      );
      this.camera.updateProjectionMatrix();

      this.updateSky(up);
      if (this.backdrop) {
        this.backdrop.group.position.copy(this.camera.position);
        const centerDistSq = this.camera.position.lengthSq();
        const tangentKm = Math.sqrt(Math.max(0, centerDistSq - this.radiusKm * this.radiusKm));
        this.backdrop.group.scale.setScalar(Math.max(1, (tangentKm * 1.35) / 2000));
      }
      this.chunkManager?.update(this.camera.position);
    }

    this.pipeline.render();
    requestAnimationFrame(() => this.frame());
  }

  private updateSky(up: Vector3): void {
    if (!this.system || !this.planet) return;
    const solid = this.field !== null;
    const { position } = elementsToState(
      this.planet.elements,
      planetMu(this.system, this.planet),
      this.simTimeDays * DAY,
    );
    // Solid ground stays fixed while the sun sweeps with the planet's
    // spin; envelopes spin their cloud bands instead (mesh rotation).
    const spin = solid
      ? (2 * Math.PI * 24 * this.simTimeDays) / this.planet.physical.rotation.periodHours
      : 0;
    const toStarModel = new Vector3(-position.x, -position.z, position.y).normalize();
    const sunDir = new Vector3(
      toStarModel.x * Math.cos(spin) + toStarModel.z * Math.sin(spin),
      toStarModel.y,
      -toStarModel.x * Math.sin(spin) + toStarModel.z * Math.cos(spin),
    );

    const skyDistanceKm = this.skyObjectDistanceKm();
    const distanceM = Math.hypot(position.x, position.y, position.z);
    const angularRadius = (this.system.star.radius * SOLAR_RADIUS) / distanceM;
    this.sunMesh.position.copy(this.camera.position).addScaledVector(sunDir, skyDistanceKm);
    this.sunMesh.scale.setScalar(Math.max(skyDistanceKm * angularRadius, skyDistanceKm * 4e-4));

    const lightColor = this.system.star.linearRgb;
    this.bodyObject?.update(this.simTimeDays, sunDir, lightColor);

    // Moons on their true orbits; the planet eclipses them.
    const tSeconds = this.simTimeDays * DAY;
    const planetCaster = { position: new Vector3(0, 0, 0), radius: this.radiusKm };
    for (const { moon, object, marker, mu } of this.moons) {
      const state = elementsToState(moon.elements, mu, tSeconds);
      object.group.position.copy(toWorld(state.position)).divideScalar(1000);
      object.update(this.simTimeDays, sunDir, lightColor);
      object.setOccluders([planetCaster], angularRadius);

      const cameraDistance = this.camera.position.distanceTo(object.group.position);
      const moonRadiusKm = moon.physical.bulk.radiusEarth * EARTH_RADIUS_KM;
      marker.visible = moonRadiusKm / cameraDistance < 0.004;
      marker.scale.setScalar((cameraDistance * 0.0045) / EARTH_RADIUS_KM);
    }

    const { atmosphere } = this.planet.physical;
    const sunElevation = Math.max(0, sunDir.dot(up));
    const scaleHeightKm = Math.max(atmosphere.scaleHeightKm, 3);
    const immersion = Math.exp(-this.altitudeKm / (8 * scaleHeightKm));
    const density =
      !solid || atmosphere.class === 'none'
        ? 0
        : 0.005 *
          Math.min(2, atmosphere.surfacePressureBar ** 0.6) *
          (0.3 + 0.7 * sunElevation) *
          immersion;
    const fog = new Color(...atmosphere.scatteringColor).multiply(
      new Color(...lightColor).multiplyScalar(0.35 + 0.65 * sunElevation),
    );

    if (this.backdrop) {
      const dayWash =
        atmosphere.class === 'none' || !solid
          ? 0
          : Math.min(1, sunElevation * Math.min(1, atmosphere.surfacePressureBar) * immersion * 3);
      this.backdrop.intensity = 1 - dayWash * 0.97;
    }

    if (this.atmosphereShell) {
      const material = this.atmosphereShell.material as ShaderMaterial;
      material.uniforms.uLightDir.value = [sunDir.x, sunDir.y, sunDir.z];
      material.uniforms.uLightColor.value.setRGB(...lightColor);
    }
    if (this.ringMesh) {
      const material = this.ringMesh.material as ShaderMaterial;
      material.uniforms.uLightDir.value = [sunDir.x, sunDir.y, sunDir.z];
      material.uniforms.uLightColor.value.setRGB(...lightColor);
      applyOccluders(material, [{ position: new Vector3(0, 0, 0), radius: this.radiusKm }], angularRadius);
    }

    for (const material of [this.terrainMaterial, this.oceanMaterial]) {
      if (!material) continue;
      material.uniforms.uLightDir.value = [sunDir.x, sunDir.y, sunDir.z];
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
