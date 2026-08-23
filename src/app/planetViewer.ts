import { Color, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, SphereGeometry, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { elementsToState } from '../core/math/kepler';
import { DAY, SOLAR_RADIUS } from '../core/physics/constants';
import { PlanetObject } from '../render/planet/planetObject';
import { RenderPipeline } from '../render/fx/pipeline';
import { planetMu } from '../universe/system/generate';
import type { Planet, StarSystem } from '../universe/system/types';

const STAR_DISTANCE_UNITS = 3000;

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
    this.planetObject = new PlanetObject(planet);
    this.scene.add(this.planetObject.group);

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
      const angularRadius = (this.system.star.radius * SOLAR_RADIUS) / distanceM;
      this.starMesh.position.copy(toStar).multiplyScalar(STAR_DISTANCE_UNITS);
      this.starMesh.scale.setScalar(Math.max(STAR_DISTANCE_UNITS * angularRadius, 0.5));

      this.planetObject.update(this.simTimeDays, toStar, this.system.star.linearRgb);
    }

    this.controls.update();
    this.pipeline.render();
    requestAnimationFrame(() => this.frame());
  }
}
