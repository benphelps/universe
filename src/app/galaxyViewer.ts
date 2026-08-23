import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildTemperatureLut, temperatureToLutCoord } from '../core/color/blackbody';
import { seedFromHex, seedToHex } from '../core/rng/hash';
import { RenderPipeline } from '../render/fx/pipeline';
import { StarfieldBackdrop } from '../render/starfield/starfieldBackdrop';
import { starPhotometry } from '../universe/galaxy/photometry';
import { starsNear, viewpointForSeed } from '../universe/galaxy/sectors';
import { getSkyField } from './skyService';

const NEIGHBOR_RADIUS_PC = 20;

export interface Neighbor {
  seedHex: string;
  distancePc: number;
  luminosity: number;
  tEff: number;
}

const VERTEX = /* glsl */ `
attribute vec3 starColor;
attribute float luminosity;

varying vec3 vColor;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float distance = max(length(mvPosition.xyz), 0.05);
  // Apparent brightness falls with the camera's own distance to the star.
  float energy = clamp(2.2 * sqrt(luminosity) / distance, 0.03, 2.2);
  vColor = starColor * energy;
  gl_PointSize = clamp(28.0 * pow(luminosity, 0.2) / distance, 1.5, 10.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vColor;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float falloff = 1.0 - smoothstep(0.2, 1.0, length(c));
  gl_FragColor = vec4(vColor * falloff, 1.0);
}
`;

/**
 * The stellar neighborhood in 3D (1 unit = 1 pc): every real sector star
 * within 20 pc of the current system, flyable with orbit controls, over
 * the full sky backdrop. Neighbors are exposed for the travel list.
 */
export class GalaxyViewer {
  timeScaleDaysPerSecond = 0;
  neighbors: Neighbor[] = [];
  private disposed = false;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly pipeline: RenderPipeline;
  private points: Points | null = null;
  private backdrop: StarfieldBackdrop | null = null;
  private currentSeedHex = '';
  private readonly onResize = () => this.resize();

  constructor(private readonly container: HTMLElement) {
    this.camera = new PerspectiveCamera(55, 1, 0.01, 5000);
    this.pipeline = new RenderPipeline(container, this.scene, this.camera);
    this.controls = new OrbitControls(this.camera, this.pipeline.renderer.domElement);
    this.controls.enableDamping = true;
    this.camera.position.set(3, 5, 14);

    window.addEventListener('resize', this.onResize);
    this.resize();
    requestAnimationFrame(() => this.frame());
  }

  setSeed(seedHex: string): void {
    this.currentSeedHex = seedHex;
    const seed = seedFromHex(seedHex);
    const viewpoint = viewpointForSeed(seed);
    const lut = buildTemperatureLut(96);

    const slots = starsNear(viewpoint, NEIGHBOR_RADIUS_PC);
    const positions: number[] = [0, 0, 0];
    const colors: number[] = [1, 0.95, 0.9];
    const luminosities: number[] = [starPhotometry(seed).luminosity];
    this.neighbors = [];

    for (const slot of slots) {
      const physical = starPhotometry(slot.seed);
      if (physical.luminosity <= 0) continue;
      const dx = slot.positionPc.xPc - viewpoint.xPc;
      const dy = slot.positionPc.yPc - viewpoint.yPc;
      const dz = slot.positionPc.zPc - viewpoint.zPc;
      // Galactic frame → scene frame (disk normal up).
      positions.push(dx, dz, dy);
      const lutIndex = Math.min(95, Math.floor(temperatureToLutCoord(physical.tEff) * 95)) * 4;
      colors.push(lut[lutIndex], lut[lutIndex + 1], lut[lutIndex + 2]);
      luminosities.push(physical.luminosity);
      this.neighbors.push({
        seedHex: seedToHex(slot.seed),
        distancePc: Math.hypot(dx, dy, dz),
        luminosity: physical.luminosity,
        tEff: physical.tEff,
      });
    }
    this.neighbors.sort((a, b) => a.distancePc - b.distancePc);

    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      (this.points.material as ShaderMaterial).dispose();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('starColor', new BufferAttribute(new Float32Array(colors), 3));
    geometry.setAttribute('luminosity', new BufferAttribute(new Float32Array(luminosities), 1));
    this.points = new Points(
      geometry,
      new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    if (this.backdrop) {
      this.scene.remove(this.backdrop.group);
      this.backdrop.dispose();
      this.backdrop = null;
    }
    getSkyField(seedHex).then((sky) => {
      if (this.disposed || this.currentSeedHex !== seedHex) return;
      this.backdrop = new StarfieldBackdrop(sky, 2000);
      this.scene.add(this.backdrop.group);
    });
  }

  set exposure(value: number) {
    this.pipeline.exposure = value;
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    if (this.points) {
      this.points.geometry.dispose();
      (this.points.material as ShaderMaterial).dispose();
    }
    this.backdrop?.dispose();
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
    this.controls.update();
    this.backdrop?.group.position.copy(this.camera.position);
    this.pipeline.render();
    requestAnimationFrame(() => this.frame());
  }
}
