import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { elementsToState, orbitPath } from '../core/math/kepler';
import {
  AU,
  DAY,
  EARTH_MASS,
  EARTH_RADIUS,
  G,
  PARSEC,
  SOLAR_MASS,
  SOLAR_RADIUS,
} from '../core/physics/constants';
import { seedFromHex } from '../core/rng/hash';
import { createTemperatureLutTexture } from '../render/color/temperatureLut';
import { createAtmosphereShell } from '../render/planet/atmosphereShell';
import { PlanetObject } from '../render/planet/planetObject';
import { createRingMesh } from '../render/planet/ringMaterial';
import { applyOccluders } from '../render/planet/shadows';
import { RenderPipeline } from '../render/fx/pipeline';
import { StarObject } from '../render/star/starObject';
import { StarfieldBackdrop } from '../render/starfield/starfieldBackdrop';
import {
  createNeighborStars,
  createStarPointsMaterial,
} from '../render/starfield/neighborStars';
import { createBeltPointsForSystem } from '../render/system/beltPoints';
import { CometObject } from '../render/system/cometObject';
import { createOrbitLine } from '../render/system/orbitLine';
import { createZoneRings } from '../render/system/zoneRings';
import { TerrainChunkManager } from '../render/terrain/chunkManager';
import { createCloudShell } from '../render/terrain/cloudShell';
import { createOceanMaterial } from '../render/terrain/oceanSphere';
import { createSkyDome } from '../render/terrain/skyDome';
import { createTerrainMaterial } from '../render/terrain/terrainMaterial';
import {
  computeNeighborhood,
  NEIGHBOR_RADIUS_PC,
  type Neighbor,
} from '../universe/galaxy/neighborhood';
import type { Moon } from '../universe/moon/types';
import type { Star } from '../universe/star/types';
import { maxCraterDepthM } from '../universe/surface/craters';
import { createSurfaceField, type SurfaceField } from '../universe/surface/field';
import { planetMu } from '../universe/system/generate';
import { getSkyField } from './skyService';
import type { Planet, StarSystem } from '../universe/system/types';

const EARTH_RADIUS_KM = EARTH_RADIUS / 1000;
const SOLAR_RADIUS_KM = SOLAR_RADIUS / 1000;
const AU_KM = AU / 1000;
const PC_KM = PARSEC / 1000;
const GALAXY_ARRIVAL_ALTITUDE_KM = 15 * PC_KM;
const MAX_ALTITUDE_KM = NEIGHBOR_RADIUS_PC * 1.5 * PC_KM;

export type FocusTarget = 'star' | number;
export type ScenePreset = 'star' | 'system' | 'planet' | 'galaxy';

export const PRESET_TIME_SCALE: Record<ScenePreset, number> = {
  star: 0.05,
  system: 5,
  // Near-frozen: fast rotators would otherwise sweep the sun across the
  // sky (and into night) within a minute of arriving.
  planet: 0.001,
  galaxy: 0,
};

interface MoonEntry {
  moon: Moon;
  object: PlanetObject;
  marker: Mesh;
  mu: number;
}

interface PlanetNode {
  planet: Planet;
  object: PlanetObject;
  marker: Mesh;
  mu: number;
}

interface StarNode {
  object: StarObject;
  radiusKm: number;
}

/** Model frame (z out of plane) → viewer world frame. */
function toWorld(p: { x: number; y: number; z: number }): Vector3 {
  return new Vector3(p.x, p.z, -p.y);
}

/** Star-tinted marker color at fixed brightness (peak-normalized). */
function markerColor(
  appearance: { landColorA: [number, number, number]; landColorB: [number, number, number] },
  starRgb: [number, number, number],
): Color {
  const { landColorA, landColorB } = appearance;
  const raw = [0, 1, 2].map((i) => ((landColorA[i] + landColorB[i]) / 2 + 0.3) * starRgb[i]);
  const peak = Math.max(...raw, 1e-3);
  return new Color((raw[0] / peak) * 0.85, (raw[1] / peak) * 0.85, (raw[2] / peak) * 0.85);
}

/**
 * The unified system viewer (units: km): one scene from a star's
 * photosphere to a planet's ground. The focused body sits at the origin
 * and everything else is placed relative to it in doubles — the real
 * star (which is thereby every planet's sun, at true angular size and
 * eclipsed by plain depth testing), the other planets on their orbits,
 * stellar companions, belts, comets, and a diagrammatic orbit-line
 * overlay that appears at map altitudes. The old star, system, and
 * planet views are presets of this one scene: focus plus altitude,
 * nothing else changes.
 */
export class UnifiedViewer {
  timeScaleDaysPerSecond = PRESET_TIME_SCALE.planet;
  /** Travel list for the current system's stellar neighborhood. */
  neighbors: Neighbor[] = [];
  private simTimeDays = 0;
  private disposed = false;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly pipeline: RenderPipeline;
  private readonly controls: OrbitControls;
  private readonly lut = createTemperatureLutTexture();
  private readonly terrainMaterial = createTerrainMaterial();
  /** Heliocentric content riding the focus translation and ground spin. */
  private readonly heliocentric = new Group();
  /** Map-frame subgroups (1 unit = 1 AU, z out of plane) inside it. */
  private readonly auGroup = new Group();
  private readonly overlay = new Group();
  /** Neighborhood stars (1 unit = 1 pc, already scene-frame) inside it. */
  private readonly pcGroup = new Group();
  private neighborPoints: Points | null = null;
  /** Photometric glints for the system's own stars at unresolved range. */
  private starSprites: Points | null = null;
  private starNodes: StarNode[] = [];
  private planetNodes: PlanetNode[] = [];
  private beltMaterials: ShaderMaterial[] = [];
  private cometObjects: CometObject[] = [];
  private backdrop: StarfieldBackdrop | null = null;
  private oceanMaterial: ShaderMaterial | null = null;
  private chunkManager: TerrainChunkManager | null = null;
  private atmosphereShell: Mesh | null = null;
  private cloudShell: Mesh | null = null;
  private occlusionGlobe: Mesh | null = null;
  private ringMesh: Mesh | null = null;
  private bodyObject: PlanetObject | null = null;
  private skyDome: Mesh | null = null;
  private moonGroup: Group | null = null;
  private moons: MoonEntry[] = [];
  private field: SurfaceField | null = null;
  private system: StarSystem | null = null;
  private focus: FocusTarget = 'star';
  private focusPlanet: Planet | null = null;
  private extentAu = 1;
  private extentKm = AU_KM;
  private radiusKm = SOLAR_RADIUS_KM;
  private altitudeKm = SOLAR_RADIUS_KM * 2;
  private minAltitudeKm = SOLAR_RADIUS_KM * 0.3;
  private headingRad = 0;
  private pitchRad = 0;
  private starDistanceKm = AU_KM;
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

    // Model-frame content lies flat in the world's ground plane.
    for (const group of [this.auGroup, this.overlay]) {
      group.rotation.x = -Math.PI / 2;
      group.scale.setScalar(AU_KM);
      this.heliocentric.add(group);
    }
    this.pcGroup.scale.setScalar(PC_KM);
    this.heliocentric.add(this.pcGroup);
    this.scene.add(this.heliocentric);

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
        this.altitudeKm = Math.min(
          this.maxAltitudeKm(),
          Math.max(this.minAltitudeKm, this.altitudeKm),
        );
      },
      { passive: false },
    );

    window.addEventListener('resize', this.onResize);
    this.resize();
    requestAnimationFrame(() => this.frame());
  }

  /** Build the system-wide content: stars, planets, belts, comets, overlay. */
  setSystem(system: StarSystem): void {
    this.clearFocus();
    this.clearSystem();
    this.system = system;

    const orbitExtent = system.planets.length
      ? Math.max(...system.planets.map((p) => p.elements.semiMajorAxis / AU))
      : 1;
    const beltExtent = Math.max(0, ...system.belts.map((b) => b.outerAu));
    this.extentAu = Math.max(orbitExtent * 1.2, beltExtent * 1.1, 0.5);
    this.extentKm = this.extentAu * AU_KM;

    // Real photospheres at scene root: the corona billboard orients by
    // copying the camera quaternion, so star groups must not inherit the
    // heliocentric group's spin rotation. Positions are set every frame.
    const spriteColors: number[] = [];
    const spriteLuminosities: number[] = [];
    const spriteRadii: number[] = [];
    const addStar = (star: Star): void => {
      const object = new StarObject(star, this.lut);
      object.group.scale.setScalar(SOLAR_RADIUS_KM);
      this.scene.add(object.group);
      this.starNodes.push({ object, radiusKm: Math.max(star.radius, 1e-4) * SOLAR_RADIUS_KM });
      spriteColors.push(...star.linearRgb);
      spriteLuminosities.push(star.luminosity);
      spriteRadii.push(Math.max(star.radius, 1e-4) * SOLAR_RADIUS_KM);
    };
    addStar(system.star);
    for (const companion of system.companions) {
      if (companion.elements.semiMajorAxis / AU > this.extentAu * 3) continue;
      addStar(companion.star);
      this.overlay.add(createOrbitLine(companion.elements, 0x8888aa, 0.25));
    }

    // Photometric glints carry the stars once their discs fall subpixel
    // — the same magnitude/color mapping as every other sky star.
    const spriteGeometry = new BufferGeometry();
    spriteGeometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(this.starNodes.length * 3), 3),
    );
    spriteGeometry.setAttribute('starColor', new BufferAttribute(new Float32Array(spriteColors), 3));
    spriteGeometry.setAttribute(
      'luminosity',
      new BufferAttribute(new Float32Array(spriteLuminosities), 1),
    );
    spriteGeometry.setAttribute('aRadiusKm', new BufferAttribute(new Float32Array(spriteRadii), 1));
    this.starSprites = new Points(spriteGeometry, createStarPointsMaterial(PC_KM));
    this.starSprites.frustumCulled = false;
    this.starSprites.renderOrder = -2;
    this.scene.add(this.starSprites);

    const starRgb = system.star.linearRgb;
    this.planetNodes = system.planets.map((planet) => {
      const object = new PlanetObject(planet.physical, planet.rings);
      object.group.scale.setScalar(EARTH_RADIUS_KM);
      this.heliocentric.add(object.group);
      const marker = new Mesh(
        new SphereGeometry(1, 12, 6),
        new MeshBasicMaterial({ color: markerColor(planet.physical.appearance, starRgb) }),
      );
      this.heliocentric.add(marker);
      return { planet, object, marker, mu: planetMu(system, planet) };
    });

    for (const points of createBeltPointsForSystem(system.belts, system.seedHex)) {
      const material = points.material as ShaderMaterial;
      material.uniforms.uSqrtCentralMass.value = Math.sqrt(system.centralMassSolar);
      // Point sizing was tuned for AU-unit view distances.
      material.uniforms.uPointScale.value = 40 * AU_KM;
      this.beltMaterials.push(material);
      this.auGroup.add(points);
    }
    for (const comet of system.comets) {
      const object = new CometObject(comet, system.centralMassSolar, this.extentAu);
      this.cometObjects.push(object);
      this.auGroup.add(object.group);
    }

    this.overlay.add(createZoneRings(system.zones));
    for (const planet of system.planets) {
      this.overlay.add(
        createOrbitLine(planet.elements, planet.inHabitableZone ? 0x4fbf7f : 0x6a7484, 0.45),
      );
    }

    // The neighborhood rides in the scene as true 3D points: the night
    // sky's near field from the ground, the flyable galaxy layer from
    // interstellar altitude — the same objects, parallax-correct.
    const hood = computeNeighborhood(seedFromHex(system.seedHex));
    this.neighbors = hood.neighbors;
    this.neighborPoints = createNeighborStars(hood, PC_KM);
    this.pcGroup.add(this.neighborPoints);

    getSkyField(system.seedHex).then((sky) => {
      if (this.disposed || this.system !== system) return;
      // Skip the near field: those stars are the 3D layer above.
      this.backdrop = new StarfieldBackdrop(sky, 2000, sky.nearStarCount);
      this.scene.add(this.backdrop.group);
    });
  }

  /** Rebuild focus-specific content and jump the camera to an arrival orbit. */
  setFocus(target: FocusTarget, preset: ScenePreset): void {
    if (!this.system) return;
    this.clearFocus();
    this.focus = target;
    this.focusPlanet = typeof target === 'number' ? (this.system.planets[target] ?? null) : null;

    if (this.focusPlanet) {
      const planet = this.focusPlanet;
      const solid = !planet.physical.appearance.banding;
      this.radiusKm = planet.physical.bulk.radiusEarth * EARTH_RADIUS_KM;
      // Envelopes have no ground: keep clear of the cloud deck.
      this.minAltitudeKm = solid ? 0.05 : this.radiusKm * 0.05;
      this.altitudeKm = this.radiusKm * 2.2;

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
          this.skyDome = createSkyDome(planet.physical.atmosphere.scatteringColor);
          this.scene.add(this.skyDome);
        }
        this.atmosphereShell = createAtmosphereShell(planet.physical, this.radiusKm);
        if (this.atmosphereShell) this.scene.add(this.atmosphereShell);
        this.cloudShell = createCloudShell(
          planet.physical,
          this.radiusKm,
          this.field.seaLevelM / 1000,
          this.field.params.reliefM / 1000,
        );
        if (this.cloudShell) this.scene.add(this.cloudShell);
        if (planet.rings) {
          this.ringMesh = createRingMesh(planet.rings, this.radiusKm);
          this.ringMesh.rotation.x = -Math.PI / 2;
          this.scene.add(this.ringMesh);
        }
        // Depth-only globe: writes the planet body's depth even where
        // terrain isn't loaded, so sky objects eclipse per-fragment.
        // Sized below the deepest terrain — crater excavation included,
        // or bowls dip under it and render as black holes.
        const depthBudgetKm =
          (this.field.params.reliefM * 1.3 +
            maxCraterDepthM(this.field.params.radiusM, this.field.params.craterAmplitude)) /
          1000;
        this.occlusionGlobe = new Mesh(
          new SphereGeometry(this.radiusKm - depthBudgetKm, 96, 48),
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
      this.buildMoons(planet);
    } else {
      this.radiusKm = Math.max(this.system.star.radius, 1e-4) * SOLAR_RADIUS_KM;
      this.minAltitudeKm = this.radiusKm * 0.3;
      this.altitudeKm =
        preset === 'system'
          ? this.extentKm
          : preset === 'galaxy'
            ? GALAXY_ARRIVAL_ALTITUDE_KM
            : this.radiusKm * 3.2;
    }

    // Arrive over a planet's lit face, offset so sunlight rakes and
    // casts relief; at the star, near-horizontal for the limb close-up,
    // overhead for the system map, or oblique for the neighborhood.
    const focusPos = this.focusPositionKm();
    const toStar = this.focusPlanet
      ? focusPos.normalize().negate()
      : preset === 'galaxy'
        ? new Vector3(3, 5, 14).normalize()
        : preset === 'system'
          ? new Vector3(0.35, 1.15, 0.85).normalize()
          : new Vector3(0.3, 0.17, 1).normalize();
    const arrival = toStar.clone().applyAxisAngle(new Vector3(0, 1, 0), 0.7).normalize();
    this.camera.position.copy(arrival).multiplyScalar(this.radiusKm + this.altitudeKm);
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
  }

  set exposure(value: number) {
    this.pipeline.exposure = value;
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.clearFocus();
    this.clearSystem();
    this.terrainMaterial.dispose();
    this.lut.dispose();
    this.pipeline.dispose();
  }

  private maxAltitudeKm(): number {
    return MAX_ALTITUDE_KM;
  }

  private buildMoons(planet: Planet): void {
    if (!this.system) return;
    const starRgb = this.system.star.linearRgb;
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

        const marker = new Mesh(
          new SphereGeometry(1, 12, 6),
          new MeshBasicMaterial({ color: markerColor(moon.physical.appearance, starRgb) }),
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

  private clearFocus(): void {
    this.chunkManager?.dispose();
    this.chunkManager = null;
    this.oceanMaterial?.dispose();
    this.oceanMaterial = null;
    this.field = null;
    for (const mesh of [
      this.atmosphereShell,
      this.cloudShell,
      this.occlusionGlobe,
      this.ringMesh,
      this.skyDome,
    ]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      if (!Array.isArray(mesh.material)) mesh.material.dispose();
    }
    this.atmosphereShell = null;
    this.cloudShell = null;
    this.occlusionGlobe = null;
    this.ringMesh = null;
    this.skyDome = null;
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
    this.focusPlanet = null;
  }

  private clearSystem(): void {
    for (const { object } of this.starNodes) {
      this.scene.remove(object.group);
      object.dispose();
    }
    this.starNodes = [];
    if (this.starSprites) {
      this.scene.remove(this.starSprites);
      this.starSprites.geometry.dispose();
      (this.starSprites.material as ShaderMaterial).dispose();
      this.starSprites = null;
    }
    for (const node of this.planetNodes) {
      this.heliocentric.remove(node.object.group);
      this.heliocentric.remove(node.marker);
      node.object.dispose();
      node.marker.geometry.dispose();
      (node.marker.material as MeshBasicMaterial).dispose();
    }
    this.planetNodes = [];
    for (const comet of this.cometObjects) comet.dispose();
    this.cometObjects = [];
    this.beltMaterials = [];
    if (this.neighborPoints) {
      this.pcGroup.remove(this.neighborPoints);
      this.neighborPoints.geometry.dispose();
      (this.neighborPoints.material as ShaderMaterial).dispose();
      this.neighborPoints = null;
    }
    this.neighbors = [];
    for (const child of [...this.auGroup.children, ...this.overlay.children]) {
      child.parent?.remove(child);
      child.traverse((obj) => {
        if (obj instanceof Mesh || obj instanceof Points || obj instanceof Line) {
          obj.geometry.dispose();
          if (!Array.isArray(obj.material)) obj.material.dispose();
        }
      });
    }
    if (this.backdrop) {
      this.scene.remove(this.backdrop.group);
      this.backdrop.dispose();
      this.backdrop = null;
    }
    this.system = null;
  }

  /**
   * Daylight washout applied to everything stellar beyond the system.
   * The system's own star glints stay full — an unresolved sun (or a
   * bright companion) outshines any daytime sky.
   */
  private setSkyIntensity(value: number): void {
    if (this.backdrop) this.backdrop.intensity = value;
    if (this.neighborPoints) {
      (this.neighborPoints.material as ShaderMaterial).uniforms.uIntensity.value = value;
    }
  }

  /**
   * Heliocentric star positions at t, km, world axes. A close p-type
   * pair orbits its barycenter (which the planets orbit); a wide
   * companion moves on its relative orbit around the primary.
   */
  private stellarPositionsKm(tSeconds: number): Vector3[] {
    const system = this.system!;
    const positions = [new Vector3()];
    for (let i = 0; i < this.starNodes.length - 1; i++) {
      const companion = system.companions[i];
      const pairMu = G * (system.star.mass + companion.star.mass) * SOLAR_MASS;
      const { position } = elementsToState(companion.elements, pairMu, tSeconds);
      const relative = toWorld(position).divideScalar(1000);
      if (i === 0 && system.configuration === 'p-type') {
        const fraction = companion.star.mass / (system.star.mass + companion.star.mass);
        positions[0] = relative.clone().multiplyScalar(-fraction);
        positions.push(relative.clone().multiplyScalar(1 - fraction));
      } else {
        positions.push(positions[0].clone().add(relative));
      }
    }
    return positions;
  }

  /** Heliocentric position of the focus body at the current time, km. */
  private focusPositionKm(): Vector3 {
    if (!this.system) return new Vector3();
    const tSeconds = this.simTimeDays * DAY;
    if (!this.focusPlanet) return this.stellarPositionsKm(tSeconds)[0];
    const { position } = elementsToState(
      this.focusPlanet.elements,
      planetMu(this.system, this.focusPlanet),
      tSeconds,
    );
    return toWorld(position).divideScalar(1000);
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

    if (this.system) {
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
        const forward = heading
          .multiplyScalar(horizonBlend)
          .addScaledVector(up, vertical)
          .normalize();
        const gaze = new Matrix4().lookAt(
          this.camera.position,
          this.camera.position.clone().add(forward),
          up,
        );
        this.camera.quaternion.setFromRotationMatrix(gaze);
      }

      // Near tracks altitude (nothing sits closer than the ground below,
      // and at interstellar heights the nearest star is parsecs away);
      // far always reaches the neighborhood — every object is at its
      // true position, so occlusion is plain depth testing.
      this.camera.near = Math.max(
        0.006,
        Math.min(2000, this.altitudeKm * 0.15),
        this.altitudeKm * 1e-4,
      );
      this.camera.far = Math.max(
        this.camera.position.length() * 2.5,
        NEIGHBOR_RADIUS_PC * PC_KM * 2.5,
      );
      this.camera.updateProjectionMatrix();

      this.updateWorld(up);

      if (this.backdrop) {
        this.backdrop.group.position.copy(this.camera.position);
        const centerDistSq = this.camera.position.lengthSq();
        const tangentKm = Math.sqrt(Math.max(0, centerDistSq - this.radiusKm * this.radiusKm));
        this.backdrop.group.scale.setScalar(Math.max(1, (tangentKm * 1.35) / 2000));
      }
      this.chunkManager?.update(this.camera.position);
      // The diagrammatic orbit overlay appears at map heights.
      this.overlay.visible = this.altitudeKm > this.radiusKm * 25;
    }

    this.pipeline.render();
    requestAnimationFrame(() => this.frame());
  }

  private updateWorld(up: Vector3): void {
    if (!this.system) return;
    const solid = this.field !== null;
    const tSeconds = this.simTimeDays * DAY;
    const yAxis = new Vector3(0, 1, 0);

    // Ground-fixed frame: the heliocentric world (stars, planets, belts,
    // sky) sweeps around a spinning solid focus; envelopes spin their
    // cloud bands instead (mesh rotation inside PlanetObject).
    const spin =
      solid && this.focusPlanet
        ? (2 * Math.PI * 24 * this.simTimeDays) / this.focusPlanet.physical.rotation.periodHours
        : 0;
    const focusPos = this.focusPositionKm();
    this.heliocentric.rotation.y = spin;
    this.heliocentric.position.copy(focusPos).negate().applyAxisAngle(yAxis, spin);
    if (this.backdrop) this.backdrop.group.rotation.y = spin;

    const toFocusWorld = (heliocentricKm: Vector3): Vector3 =>
      heliocentricKm.clone().sub(focusPos).applyAxisAngle(yAxis, spin);

    // The stars at their true positions and radii: angular size, phase
    // light, parallax, and eclipses all come out right by construction.
    const starPositions = this.stellarPositionsKm(tSeconds);
    const spritePositions = this.starSprites?.geometry.getAttribute('position') as
      | BufferAttribute
      | undefined;
    for (let i = 0; i < this.starNodes.length; i++) {
      const node = this.starNodes[i];
      node.object.group.position.copy(toFocusWorld(starPositions[i]));
      node.object.update(this.simTimeDays, this.camera);
      spritePositions?.setXYZ(
        i,
        node.object.group.position.x,
        node.object.group.position.y,
        node.object.group.position.z,
      );
    }
    if (spritePositions) spritePositions.needsUpdate = true;
    const primaryWorld = this.starNodes.length
      ? this.starNodes[0].object.group.position
      : new Vector3();
    this.starDistanceKm = Math.max(primaryWorld.length(), this.radiusKm * 4);
    const sunDir =
      primaryWorld.lengthSq() > 1 ? primaryWorld.clone().normalize() : new Vector3(0, 0, 1);
    const angularRadius =
      (this.system.star.radius * SOLAR_RADIUS_KM) / Math.max(this.starDistanceKm, 1);
    const lightColor = this.system.star.linearRgb;

    // Planets on their orbits. The focused one is rendered at the origin
    // by terrain or the envelope sphere, so its node hides; the rest are
    // true-scale spheres with adaptive markers once they fall subpixel.
    for (let i = 0; i < this.planetNodes.length; i++) {
      const node = this.planetNodes[i];
      const isFocus = this.focus === i;
      node.object.group.visible = !isFocus;
      node.marker.visible = false;
      if (isFocus) continue;
      const state = elementsToState(node.planet.elements, node.mu, tSeconds);
      const positionKm = toWorld(state.position).divideScalar(1000);
      node.object.group.position.copy(positionKm);
      const worldPos = toFocusWorld(positionKm);
      const lightDir = primaryWorld.clone().sub(worldPos).normalize();
      node.object.update(this.simTimeDays, lightDir, lightColor);

      const cameraDistance = this.camera.position.distanceTo(worldPos);
      const bodyRadiusKm = node.planet.physical.bulk.radiusEarth * EARTH_RADIUS_KM;
      if (bodyRadiusKm / cameraDistance < 0.004) {
        node.marker.visible = true;
        node.marker.position.copy(positionKm);
        node.marker.scale.setScalar(cameraDistance * 0.0035);
      }
    }

    for (const material of this.beltMaterials) {
      material.uniforms.uTimeYears.value = this.simTimeDays / 365.25;
    }
    for (const comet of this.cometObjects) comet.update(tSeconds);

    this.bodyObject?.update(this.simTimeDays, sunDir, lightColor);

    // Moons on their true orbits; the focus planet eclipses them.
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

    if (!this.focusPlanet) {
      this.setSkyIntensity(1);
      return;
    }
    const { atmosphere } = this.focusPlanet.physical;
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

    const dayWash =
      atmosphere.class === 'none' || !solid
        ? 0
        : Math.min(1, sunElevation * Math.min(1, atmosphere.surfacePressureBar) * immersion * 3);
    this.setSkyIntensity(1 - dayWash * 0.97);

    if (this.atmosphereShell) {
      const material = this.atmosphereShell.material as ShaderMaterial;
      material.uniforms.uLightDir.value = [sunDir.x, sunDir.y, sunDir.z];
      material.uniforms.uLightColor.value.setRGB(...lightColor);
    }
    if (this.cloudShell) {
      const material = this.cloudShell.material as ShaderMaterial;
      material.uniforms.uLightDir.value = [sunDir.x, sunDir.y, sunDir.z];
      material.uniforms.uLightColor.value.setRGB(...lightColor);
      material.uniforms.uTimeDays.value = this.simTimeDays;
    }
    if (this.ringMesh) {
      const material = this.ringMesh.material as ShaderMaterial;
      material.uniforms.uLightDir.value = [sunDir.x, sunDir.y, sunDir.z];
      material.uniforms.uLightColor.value.setRGB(...lightColor);
      applyOccluders(material, [planetCaster], angularRadius);
    }

    for (const material of [this.terrainMaterial, this.oceanMaterial]) {
      if (!material) continue;
      material.uniforms.uLightDir.value = [sunDir.x, sunDir.y, sunDir.z];
      material.uniforms.uLightColor.value.setRGB(...lightColor);
      material.uniforms.uFogColor.value.copy(fog);
      material.uniforms.uFogDensity.value = density;
    }

    if (this.skyDome) {
      this.skyDome.position.copy(this.camera.position);
      const material = this.skyDome.material as ShaderMaterial;
      material.uniforms.uSunDir.value = [sunDir.x, sunDir.y, sunDir.z];
      material.uniforms.uUp.value = [up.x, up.y, up.z];
      material.uniforms.uLightColor.value.setRGB(...lightColor);
      // Sky radiance tracks optical depth: thin atmospheres barely glow.
      material.uniforms.uStrength.value =
        Math.exp(-this.altitudeKm / (10 * scaleHeightKm)) *
        Math.min(1, 3 * Math.sqrt(atmosphere.surfacePressureBar));
    }
  }
}
