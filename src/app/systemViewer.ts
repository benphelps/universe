import { PerspectiveCamera, Scene } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RenderPipeline } from '../render/fx/pipeline';
import { SystemMapObject } from '../render/system/systemMapObject';
import type { StarSystem } from '../universe/system/types';

/**
 * System-map viewer: tilted overhead camera over the orbital plane with
 * pan/zoom, live Keplerian motion at the shared time scale.
 */
export class SystemViewer {
  timeScaleDaysPerSecond = 5;
  private simTimeDays = 0;
  private disposed = false;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly pipeline: RenderPipeline;
  private mapObject: SystemMapObject | null = null;
  private lastFrameMs = performance.now();
  private readonly onResize = () => this.resize();

  constructor(private readonly container: HTMLElement) {
    this.camera = new PerspectiveCamera(50, 1, 0.001, 1e6);
    this.pipeline = new RenderPipeline(container, this.scene, this.camera);
    this.controls = new OrbitControls(this.camera, this.pipeline.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.screenSpacePanning = false;

    window.addEventListener('resize', this.onResize);
    this.resize();
    requestAnimationFrame(() => this.frame());
  }

  setSystem(system: StarSystem): void {
    if (this.mapObject) {
      this.scene.remove(this.mapObject.group);
      this.mapObject.dispose();
    }
    this.mapObject = new SystemMapObject(system);
    this.scene.add(this.mapObject.group);
    this.frameCamera(this.mapObject.extentAu);
  }

  set exposure(value: number) {
    this.pipeline.exposure = value;
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.mapObject?.dispose();
    this.pipeline.dispose();
  }

  private frameCamera(extentAu: number): void {
    this.camera.near = extentAu * 1e-4;
    this.camera.far = extentAu * 1e3;
    this.camera.position.set(0, extentAu * 1.15, extentAu * 0.85);
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = extentAu * 0.02;
    this.controls.maxDistance = extentAu * 20;
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
    if (this.disposed) return;
    const now = performance.now();
    const dtSeconds = Math.min((now - this.lastFrameMs) / 1000, 0.1);
    this.lastFrameMs = now;
    this.simTimeDays += dtSeconds * this.timeScaleDaysPerSecond;

    this.controls.update();
    this.mapObject?.update(this.simTimeDays);
    this.pipeline.render();
    requestAnimationFrame(() => this.frame());
  }
}
