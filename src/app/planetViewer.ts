import {
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { elementsToState, orbitPath } from '../core/math/kepler';
import { DAY, EARTH_MASS, EARTH_RADIUS, G, SOLAR_RADIUS } from '../core/physics/constants';
import { PlanetObject } from '../render/planet/planetObject';
import type { ShadowCaster } from '../render/planet/shadows';
import { RenderPipeline } from '../render/fx/pipeline';
import { StarfieldBackdrop } from '../render/starfield/starfieldBackdrop';
import type { Moon } from '../universe/moon/types';
import { planetMu } from '../universe/system/generate';
import type { Planet, StarSystem } from '../universe/system/types';
import { getSkyField } from './skyService';

const STAR_DISTANCE_UNITS = 3000;

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
 * True-scale viewer for one planet (1 unit = 1 R⊕). The star is drawn at
 * its correct angular size in the planet's actual sky direction, so
 * phases, terminators, and lighting color are all physical.
 */
export class PlanetViewer {
  timeScaleDaysPerSecond = 0.05;
  private simTimeDays = 0;
  private disposed = false;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly pipeline: RenderPipeline;
  private readonly starMesh: Mesh;
  private planetObject: PlanetObject | null = null;
  private backdrop: StarfieldBackdrop | null = null;
  private moonGroup: Group | null = null;
  private moons: MoonEntry[] = [];
  private system: StarSystem | null = null;
  private planet: Planet | null = null;
  private lastFrameMs = performance.now();
  private readonly onResize = () => this.resize();

  constructor(private readonly container: HTMLElement) {
    this.camera = new PerspectiveCamera(45, 1, 0.01, 1e6);
    this.pipeline = new RenderPipeline(container, this.scene, this.camera);
    this.controls = new OrbitControls(this.camera, this.pipeline.renderer.domElement);
    this.controls.enableDamping = true;

    this.starMesh = new Mesh(new SphereGeometry(1, 32, 16), new MeshBasicMaterial());
    this.scene.add(this.starMesh);

    window.addEventListener('resize', this.onResize);
    this.resize();
    requestAnimationFrame(() => this.frame());
  }

  setPlanet(system: StarSystem, planet: Planet): void {
    this.system = system;
    this.planet = planet;
    if (this.planetObject) {
      this.scene.remove(this.planetObject.group);
      this.planetObject.dispose();
    }
    if (this.moonGroup) {
      this.scene.remove(this.moonGroup);
      for (const entry of this.moons) entry.object.dispose();
    }
    this.planetObject = new PlanetObject(planet.physical, planet.rings);
    this.scene.add(this.planetObject.group);

    if (this.backdrop) {
      this.scene.remove(this.backdrop.group);
      this.backdrop.dispose();
      this.backdrop = null;
    }
    getSkyField(system.seedHex).then((sky) => {
      if (this.disposed || this.system !== system) return;
      this.backdrop = new StarfieldBackdrop(sky, 4e5);
      this.scene.add(this.backdrop.group);
    });

    // Regular moons orbit the equatorial plane, tilted with the planet.
    this.moonGroup = new Group();
    this.moonGroup.rotation.z = planet.physical.rotation.obliquityRad;
    const [lr, lg, lb] = system.star.linearRgb;
    this.moons = planet.moons
      .filter((moon) => moon.semiMajorAxisPlanetRadii < 100)
      .map((moon) => {
        const object = new PlanetObject(moon.physical, null);
        this.moonGroup!.add(object.group);

        // Orbit guide so moons are findable at planetary distances.
        const points = orbitPath(moon.elements, 128).map((p) =>
          toWorld(p).divideScalar(EARTH_RADIUS),
        );
        this.moonGroup!.add(
          new Line(
            new BufferGeometry().setFromPoints(points),
            new LineBasicMaterial({ color: 0x6a7a94, transparent: true, opacity: 0.22 }),
          ),
        );

        // Adaptive marker: keeps distant moons visible as a lit dot.
        // Star-tinted hue at fixed brightness so it reads on any host.
        const { landColorA, landColorB } = moon.physical.appearance;
        const raw = [
          ((landColorA[0] + landColorB[0]) / 2 + 0.3) * lr,
          ((landColorA[1] + landColorB[1]) / 2 + 0.3) * lg,
          ((landColorA[2] + landColorB[2]) / 2 + 0.3) * lb,
        ];
        const peak = Math.max(...raw, 1e-3);
        const marker = new Mesh(
          new SphereGeometry(1, 12, 6),
          new MeshBasicMaterial({
            color: new Color(
              (raw[0] / peak) * 0.85,
              (raw[1] / peak) * 0.85,
              (raw[2] / peak) * 0.85,
            ),
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

    const [r, g, b] = system.star.linearRgb;
    (this.starMesh.material as MeshBasicMaterial).color = new Color(r * 2.5, g * 2.5, b * 2.5);

    const radius = planet.physical.bulk.radiusEarth;
    this.camera.near = radius * 0.01;
    this.camera.far = 1e6;
    // Start on the day side, offset from the star line for relief.
    const toStar = this.starDirection() ?? new Vector3(0, 0, 1);
    this.camera.position
      .copy(toStar)
      .applyAxisAngle(new Vector3(0, 1, 0), 0.6)
      .addScaledVector(new Vector3(0, 1, 0), 0.25)
      .normalize()
      .multiplyScalar(radius * 3.4);
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = radius * 1.4;
    this.controls.maxDistance = radius * 600;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  set exposure(value: number) {
    this.pipeline.exposure = value;
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.planetObject?.dispose();
    this.backdrop?.dispose();
    for (const entry of this.moons) entry.object.dispose();
    this.starMesh.geometry.dispose();
    (this.starMesh.material as MeshBasicMaterial).dispose();
    this.pipeline.dispose();
  }

  /** Unit vector from the planet (at the origin) toward its star, world space. */
  private starDirection(): Vector3 | null {
    if (!this.system || !this.planet) return null;
    const { position } = elementsToState(
      this.planet.elements,
      planetMu(this.system, this.planet),
      this.simTimeDays * DAY,
    );
    return new Vector3(-position.x, -position.z, position.y).normalize();
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

    if (this.system && this.planet && this.planetObject) {
      const toStar = this.starDirection()!;
      const { position } = elementsToState(
        this.planet.elements,
        planetMu(this.system, this.planet),
        this.simTimeDays * DAY,
      );
      const distanceM = Math.hypot(position.x, position.y, position.z);
      const starAngularRadius = (this.system.star.radius * SOLAR_RADIUS) / distanceM;
      this.starMesh.position.copy(toStar).multiplyScalar(STAR_DISTANCE_UNITS);
      this.starMesh.scale.setScalar(Math.max(STAR_DISTANCE_UNITS * starAngularRadius, 0.5));

      const lightColor = this.system.star.linearRgb;
      this.planetObject.update(this.simTimeDays, toStar, lightColor);

      // Moons move on their orbits; everyone shadows everyone.
      const tSeconds = this.simTimeDays * DAY;
      for (const { moon, object, marker, mu } of this.moons) {
        const state = elementsToState(moon.elements, mu, tSeconds);
        object.group.position.copy(toWorld(state.position)).divideScalar(EARTH_RADIUS);
        object.update(this.simTimeDays, toStar, lightColor);

        // Swap in the marker dot when the true disc falls below ~4 px.
        const cameraDistance = this.camera.position.distanceTo(
          object.group.getWorldPosition(new Vector3()),
        );
        const angular = object.radiusUnits / cameraDistance;
        marker.visible = angular < 0.004;
        marker.scale.setScalar(cameraDistance * 0.0045);
      }
      const moonCasters: ShadowCaster[] = this.moons
        .map(({ object }) => ({
          position: object.group.getWorldPosition(new Vector3()),
          radius: object.radiusUnits,
        }))
        .sort((a, b) => a.position.length() - b.position.length());
      this.planetObject.setOccluders(moonCasters, starAngularRadius);
      const planetCaster: ShadowCaster = {
        position: new Vector3(0, 0, 0),
        radius: this.planetObject.radiusUnits,
      };
      for (const { object } of this.moons) {
        object.setOccluders([planetCaster], starAngularRadius);
      }
    }

    this.controls.update();
    this.pipeline.render();
    requestAnimationFrame(() => this.frame());
  }
}
