import { PerspectiveCamera, Scene, type DataTexture } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTemperatureLutTexture } from '../render/color/temperatureLut';
import { RenderPipeline } from '../render/fx/pipeline';
import { StarObject } from '../render/star/starObject';
import type { Star } from '../universe/star/types';

/**
 * Orbit-camera viewer around a single star at the origin.
 * Scene scale: 1 unit = 1 R☉. Simulation time advances in days.
 */
export class StarViewer {
  timeScaleDaysPerSecond = 0.05;
  private simTimeDays = 0;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly pipeline: RenderPipeline;
  private readonly lut: DataTexture;
  private starObject: StarObject | null = null;
  private lastFrameMs = performance.now();

  constructor(private readonly container: HTMLElement) {
    this.camera = new PerspectiveCamera(45, 1, 0.01, 1e7);
    this.pipeline = new RenderPipeline(container, this.scene, this.camera);
    this.controls = new OrbitControls(this.camera, this.pipeline.renderer.domElement);
    this.controls.enableDamping = true;
    this.lut = createTemperatureLutTexture();

    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame(() => this.frame());
  }

  setStar(star: Star): void {
    if (this.starObject) {
      this.scene.remove(this.starObject.group);
      this.starObject.dispose();
    }
    this.starObject = new StarObject(star, this.lut);
    this.scene.add(this.starObject.group);
    this.frameCamera(Math.max(star.radius, 1e-4));
  }

  set exposure(value: number) {
    this.pipeline.exposure = value;
  }

  private frameCamera(radius: number): void {
    this.camera.near = radius * 0.005;
    this.camera.far = radius * 1e5;
    this.camera.position.set(0, radius * 0.7, radius * 4.2);
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = radius * 1.3;
    this.controls.maxDistance = radius * 5000;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.pipeline.setSize(width, height);
  }

  private frame(): void {
    const now = performance.now();
    const dtSeconds = Math.min((now - this.lastFrameMs) / 1000, 0.1);
    this.lastFrameMs = now;
    this.simTimeDays += dtSeconds * this.timeScaleDaysPerSecond;

    this.controls.update();
    this.starObject?.update(this.simTimeDays, this.camera);
    this.pipeline.render();
    requestAnimationFrame(() => this.frame());
  }
}
