import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  Quaternion,
  Scene,
  Sphere,
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
import { mu as muOf, seconds, type Mu, type Seconds } from '../core/physics/units';
import { Rng } from '../core/rng/rng';
import { deriveSeed, seedFromHex, seedToHex } from '../core/rng/hash';
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
import { createRockGeometry, createScatterMaterial } from '../render/terrain/scatterObjects';
import { createSkyDome } from '../render/terrain/skyDome';
import { createTerrainMaterial } from '../render/terrain/terrainMaterial';
import { GalaxyVolume } from '../render/galaxy/galaxyVolume';
import {
  computeNeighborhood,
  NEIGHBOR_RADIUS_PC,
  type Neighbor,
} from '../universe/galaxy/neighborhood';
import { starPhotometry } from '../universe/galaxy/photometry';
import { viewpointForSeed } from '../universe/galaxy/sectors';
import { spectralType } from '../universe/star/classification';
import type { Moon } from '../universe/moon/types';
import {
  bandMeanMotion,
  BELT_SECTORS,
  beltBandCount,
  beltCellAsteroids,
} from '../universe/smallbody/beltRegion';
import { notableAsteroids } from '../universe/smallbody/notable';
import type { Asteroid } from '../universe/smallbody/types';
import type { Star } from '../universe/star/types';
import { createAsteroidField } from '../universe/surface/asteroidField';
import { maxCraterDepthM } from '../universe/surface/craters';
import { createSurfaceField, type SurfaceField } from '../universe/surface/field';
import { planetMu } from '../universe/system/generate';
import { rotateToScene, sceneFromGalaxy } from '../universe/galaxy/orientation';
import { meanPopulationLuminosity, type SkyField } from '../universe/galaxy/skyfield';
import { getSkyField } from './skyService';
import { fmt } from './ui/format';
import type { Planet, StarSystem } from '../universe/system/types';

const EARTH_RADIUS_KM = EARTH_RADIUS / 1000;
const SOLAR_RADIUS_KM = SOLAR_RADIUS / 1000;
const AU_KM = AU / 1000;
const PC_KM = PARSEC / 1000;
const GALAXY_ARRIVAL_ALTITUDE_KM = 15 * PC_KM;
/** High enough to frame the whole galaxy from above the disk. */
const MAX_ALTITUDE_KM = 45_000 * PC_KM;

/** Crossfade band (distance from the system, pc) where the sky-sphere
 *  backdrop hands off to the volumetric galaxy — the sphere's parallax
 *  breaks down at these heights, the volume takes over. */
const GALAXY_FADE_NEAR_PC = 60;
const GALAXY_FADE_FAR_PC = 450;

export type FocusTarget = 'star' | number;
export type ScenePreset = 'star' | 'system' | 'planet' | 'galaxy';

/** What a pick resolved to; main decides how to act on it. */
export type PickTarget =
  | { kind: 'star' }
  | { kind: 'planet'; index: number }
  | { kind: 'notable'; index: number }
  | { kind: 'belt'; asteroid: Asteroid }
  | { kind: 'neighbor'; seedHex: string };

interface Pickable {
  x: number;
  y: number;
  z: number;
  name: string;
  info: string;
  action: string | null;
  target: PickTarget | null;
}

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
  mu: Mu;
}

interface PlanetNode {
  planet: Planet;
  object: PlanetObject;
  marker: Mesh;
  mu: Mu;
}

interface StarNode {
  object: StarObject;
  radiusKm: number;
}

/** Model frame (z out of plane) → viewer world frame. */
function toWorld(p: { x: number; y: number; z: number }): Vector3 {
  return new Vector3(p.x, p.z, -p.y);
}

/** Spectral letter by effective temperature, for field-star tooltips. */
function spectralLetter(tEff: number): string {
  if (tEff > 30000) return 'O';
  if (tEff > 10000) return 'B';
  if (tEff > 7500) return 'A';
  if (tEff > 6000) return 'F';
  if (tEff > 5200) return 'G';
  if (tEff > 3700) return 'K';
  if (tEff > 2400) return 'M';
  if (tEff > 1300) return 'L';
  if (tEff > 600) return 'T';
  return 'Y';
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
  /** Landmark belt asteroids, focusable after the planets. */
  asteroids: Asteroid[] = [];
  private simTimeDays = 0;
  private disposed = false;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly pipeline: RenderPipeline;
  private readonly controls: OrbitControls;
  private readonly lut = createTemperatureLutTexture();
  private readonly terrainMaterial = createTerrainMaterial();
  private readonly scatterMaterial = createScatterMaterial();
  /** Heliocentric content riding the focus translation and ground spin. */
  private readonly heliocentric = new Group();
  /** Map-frame subgroups (1 unit = 1 AU, z out of plane) inside it. */
  private readonly auGroup = new Group();
  private readonly overlay = new Group();
  /** Neighborhood stars (1 unit = 1 pc, already scene-frame) inside it. */
  private readonly pcGroup = new Group();
  private neighborPoints: Points | null = null;
  /** The far catalog stars as true 3D points (direction × distance in
   *  the neighborhood frame): parallax-correct at any altitude, they
   *  persist through the backdrop→volume crossfade — only the
   *  unresolved-glow representations swap. */
  private farPoints: Points | null = null;
  private neighborSeedHexes: string[] = [];
  private neighborPositionsPc: Float32Array = new Float32Array(0);
  /** Photometric glints for the system's own stars at unresolved range. */
  private starSprites: Points | null = null;
  private starNodes: StarNode[] = [];
  private planetNodes: PlanetNode[] = [];
  private beltMaterials: ShaderMaterial[] = [];
  private cometObjects: CometObject[] = [];
  private backdrop: StarfieldBackdrop | null = null;
  private skyData: SkyField | null = null;
  /**
   * Ground frame of the focused body: spin about Y composed with the
   * axial tilt. The terrain never moves (static vertices stay jitter-free
   * at ground zoom); instead the rest of the universe rotates around it.
   *
   * The frame contract — new content joins a frame group and is correct
   * by default, never hand-rolls the transform:
   * - ecliptic content (sun, planets, belts, comets, neighbors, sky
   *   glints) parents under `heliocentric`, which carries the full
   *   frameQuat plus the focus offset; the backdrop copies frameQuat.
   * - equatorial content (moons, orbit guides; rings are axisymmetric)
   *   parents under `moonGroup`, which carries the spin without the
   *   obliquity lean — the equatorial plane is world XZ by construction.
   * - the exceptions that must transform manually: star photospheres
   *   (corona billboards may not inherit rotation), the belt-region
   *   streamer, and the far-star hover scan — each applies frameQuat
   *   (or its inverse) directly.
   */
  private readonly frameQuat = new Quaternion();

  /** The whole galaxy as a raymarched volume of the same density model
   *  the sky integrates; crossfades in as the sky sphere's parallax
   *  breaks down with distance from the system. */
  private galaxyVolume: GalaxyVolume | null = null;
  private galaxyFade = 0;

  /** Free flight: right-shift + drag pans the camera through space. */
  private rightShiftHeld = false;
  /** Wheel ride input, applied to the altitude during the next frame. */
  private pendingWheelFactor = 1;
  private readonly onKeyChange = (e: KeyboardEvent): void => {
    if (e.code !== 'ShiftRight') return;
    this.rightShiftHeld = e.type === 'keydown';
    // Orbit rotation yields to panning while the modifier is held.
    this.controls.enabled = !this.rightShiftHeld;
  };
  private readonly onWindowBlur = (): void => {
    this.rightShiftHeld = false;
    this.controls.enabled = true;
  };
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
  private focusAsteroid: Asteroid | null = null;
  private extentAu = 1;
  private extentKm = AU_KM;
  private radiusKm = SOLAR_RADIUS_KM;
  private altitudeKm = SOLAR_RADIUS_KM * 2;
  private minAltitudeKm = SOLAR_RADIUS_KM * 0.3;
  private headingRad = 0;
  private pitchRad = 0;
  private starDistanceKm = AU_KM;
  private systemMu: Mu = muOf(1);
  /** Materialized belt members near the camera (see updateBeltRegion). */
  private readonly beltRockGeometry = createRockGeometry();
  private beltRockMesh: InstancedMesh | null = null;
  private beltRockPoints: Points | null = null;
  private beltCandidates: Array<{
    asteroid: Asteroid;
    spinAxis: Vector3;
    radiusKm: number;
    pseudoLum: number;
  }> = [];
  private beltCellSignature = '';
  private pointerDownAt: [number, number] | null = null;
  /** Everything hoverable this frame; nearest to the cursor tooltips. */
  private pickables: Pickable[] = [];
  private hovered: Pickable | null = null;
  private hoveredKey = '';
  private cursor: [number, number] | null = null;
  private dragging = false;
  private readonly tooltip: HTMLDivElement;
  private readonly tooltipLine: SVGLineElement;
  /** Fired when the user clicks a picked body. */
  onPick: ((target: PickTarget) => void) | null = null;
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
      if ((e.buttons & 2) === 0 || this.rightShiftHeld) return;
      this.headingRad -= e.movementX * 0.004;
      this.pitchRad = Math.min(1.1, Math.max(-0.6, this.pitchRad - e.movementY * 0.003));
    });

    // Free flight in every view: right-shift + drag grabs space itself —
    // a screen-plane pan scaled by altitude, so the same gesture slides
    // meters over a ridge and parsecs across the neighborhood. Looking
    // down it sweeps the horizontal plane; toward the horizon, vertical.
    this.pipeline.renderer.domElement.addEventListener('pointermove', (e) => {
      if (!this.rightShiftHeld || e.buttons === 0) return;
      const rect = this.pipeline.renderer.domElement.getBoundingClientRect();
      const worldPerPixel =
        (2 *
          Math.tan((this.camera.fov * Math.PI) / 360) *
          Math.max(this.altitudeKm, this.minAltitudeKm)) /
        Math.max(rect.height, 1);
      const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const upVec = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      const delta = right
        .multiplyScalar(-e.movementX * worldPerPixel)
        .addScaledVector(upVec, e.movementY * worldPerPixel);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    });
    window.addEventListener('keydown', this.onKeyChange);
    window.addEventListener('keyup', this.onKeyChange);
    window.addEventListener('blur', this.onWindowBlur);

    this.pipeline.renderer.domElement.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.pendingWheelFactor *= 1.0016 ** e.deltaY;
      },
      { passive: false },
    );

    const BELT_ROCK_CAP = 320;
    this.beltRockMesh = new InstancedMesh(this.beltRockGeometry, this.scatterMaterial, BELT_ROCK_CAP);
    this.beltRockMesh.count = 0;
    this.beltRockMesh.frustumCulled = false;
    this.scene.add(this.beltRockMesh);
    const pointGeometry = new BufferGeometry();
    pointGeometry.setAttribute('position', new BufferAttribute(new Float32Array(900 * 3), 3));
    pointGeometry.setAttribute('starColor', new BufferAttribute(new Float32Array(900 * 3), 3));
    pointGeometry.setAttribute('luminosity', new BufferAttribute(new Float32Array(900), 1));
    pointGeometry.setAttribute('aRadiusKm', new BufferAttribute(new Float32Array(900), 1));
    pointGeometry.setDrawRange(0, 0);
    // A permissive bound: positions rewrite every frame and the points
    // must stay raycastable without per-frame sphere recomputation.
    pointGeometry.boundingSphere = new Sphere(new Vector3(), 1e13);
    this.beltRockPoints = new Points(pointGeometry, createStarPointsMaterial(PC_KM));
    this.beltRockPoints.frustumCulled = false;
    this.scene.add(this.beltRockPoints);

    // Hover tooltip: the body nearest the cursor names itself, with a
    // connector line; a click acts on it.
    this.tooltip = document.createElement('div');
    this.tooltip.id = 'pick-tip';
    this.tooltip.style.display = 'none';
    container.appendChild(this.tooltip);
    const lineSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    lineSvg.id = 'pick-line';
    lineSvg.setAttribute('width', '100%');
    lineSvg.setAttribute('height', '100%');
    this.tooltipLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    this.tooltipLine.setAttribute('stroke', 'rgba(160, 175, 200, 0.55)');
    this.tooltipLine.setAttribute('stroke-width', '1');
    this.tooltipLine.setAttribute('visibility', 'hidden');
    lineSvg.appendChild(this.tooltipLine);
    container.appendChild(lineSvg);

    this.pipeline.renderer.domElement.addEventListener('pointermove', (e) => {
      const rect = this.pipeline.renderer.domElement.getBoundingClientRect();
      this.cursor = [e.clientX - rect.left, e.clientY - rect.top];
      this.dragging = e.buttons !== 0;
    });
    this.pipeline.renderer.domElement.addEventListener('pointerleave', () => {
      this.cursor = null;
    });
    this.pipeline.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.pointerDownAt = [e.clientX, e.clientY];
    });
    this.pipeline.renderer.domElement.addEventListener('pointerup', (e) => {
      const down = this.pointerDownAt;
      this.pointerDownAt = null;
      this.dragging = false;
      if (!down || e.button !== 0) return;
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      if (this.hovered?.target) this.onPick?.(this.hovered.target);
    });

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
      const object = new CometObject(comet, system.centralMassSolar);
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
    this.asteroids = notableAsteroids(system);
    this.systemMu = muOf(G * system.centralMassSolar * SOLAR_MASS);
    this.beltCandidates = [];
    this.beltCellSignature = '';

    const hood = computeNeighborhood(seedFromHex(system.seedHex));
    this.neighbors = hood.neighbors;
    this.neighborSeedHexes = hood.seedHexes;
    this.neighborPositionsPc = hood.positionsPc;
    this.neighborPoints = createNeighborStars(hood, PC_KM);
    this.pcGroup.add(this.neighborPoints);

    const viewpoint = viewpointForSeed(seedFromHex(system.seedHex));
    this.galaxyVolume = new GalaxyVolume(viewpoint, sceneFromGalaxy(seedFromHex(system.seedHex)));
    this.galaxyVolume.meanLuminosity = meanPopulationLuminosity(viewpoint);
    this.scene.add(this.galaxyVolume.mesh);

    getSkyField(system.seedHex).then((sky) => {
      if (this.disposed || this.system !== system) return;
      this.skyData = sky;
      // Every resolved star is 3D content now (near field above, far
      // field here); the backdrop keeps only the unresolved sky — glow,
      // rifts, nebulae, dark clouds — which the galaxy volume replaces.
      this.backdrop = new StarfieldBackdrop(sky, 2000, sky.starCount);
      this.scene.add(this.backdrop.group);

      const farCount = sky.starCount - sky.nearStarCount;
      if (farCount > 0) {
        const positions = new Float32Array(farCount * 3);
        const luminosities = new Float32Array(farCount);
        const radii = new Float32Array(farCount);
        for (let i = 0; i < farCount; i++) {
          const s = sky.nearStarCount + i;
          const d = sky.starDistances[s];
          const [x, y, z] = rotateToScene(
            sky.sceneFromGalaxy,
            sky.starDirs[s * 3] * d,
            sky.starDirs[s * 3 + 1] * d,
            sky.starDirs[s * 3 + 2] * d,
          );
          positions[i * 3] = x;
          positions[i * 3 + 1] = y;
          positions[i * 3 + 2] = z;
          luminosities[i] = sky.starBrightness[s] * d * d;
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(positions, 3));
        geometry.setAttribute(
          'starColor',
          new BufferAttribute(sky.starColors.slice(sky.nearStarCount * 3), 3),
        );
        geometry.setAttribute('luminosity', new BufferAttribute(luminosities, 1));
        geometry.setAttribute('aRadiusKm', new BufferAttribute(radii, 1));
        geometry.boundingSphere = new Sphere(new Vector3(), 1e13);
        this.farPoints = new Points(geometry, createStarPointsMaterial(PC_KM));
        this.farPoints.frustumCulled = false;
        this.farPoints.renderOrder = -2;
        this.pcGroup.add(this.farPoints);
      }
    });
  }

  /** Rebuild focus-specific content and jump the camera to an arrival orbit. */
  setFocus(target: FocusTarget, preset: ScenePreset): void {
    if (!this.system) return;
    this.clearFocus();
    this.focus = target;
    // Numeric targets index the planets, then the notable asteroids.
    const planetCount = this.system.planets.length;
    this.focusPlanet =
      typeof target === 'number' && target < planetCount
        ? (this.system.planets[target] ?? null)
        : null;
    this.focusAsteroid =
      typeof target === 'number' && target >= planetCount
        ? (this.asteroids[target - planetCount] ?? null)
        : null;

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
          this.scatterMaterial,
          { type: 'init', seedHex: planet.physical.seedHex, physical: planet.physical },
          this.radiusKm,
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
    } else if (this.focusAsteroid) {
      this.applyAsteroidFocus(this.focusAsteroid);
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

    this.arriveAtFocus(preset);
  }

  /** Focus-specific content for a small body: streamed irregular terrain. */
  private applyAsteroidFocus(asteroid: Asteroid): void {
    this.radiusKm = asteroid.diameterKm / 2;
    this.minAltitudeKm = 0.02;
    this.altitudeKm = this.radiusKm * 3;
    this.field = createAsteroidField(asteroid);
    this.chunkManager = new TerrainChunkManager(
      this.scene,
      this.terrainMaterial,
      null,
      this.scatterMaterial,
      { type: 'init-asteroid', asteroid },
      this.radiusKm,
    );
    // The shape can dip well below the datum: keep the depth-only
    // globe under the deepest lobe-valley-plus-crater excavation.
    this.occlusionGlobe = new Mesh(
      new SphereGeometry(this.radiusKm * 0.35, 64, 32),
      new MeshBasicMaterial({ colorWrite: false }),
    );
    this.occlusionGlobe.renderOrder = -5;
    this.scene.add(this.occlusionGlobe);
  }

  /** Jump the camera to the arrival orbit for the current focus. */
  private arriveAtFocus(preset: ScenePreset): void {
    // Arrive over a body's lit face, offset so sunlight rakes and casts
    // relief; at the star, near-horizontal for the limb close-up,
    // overhead for the system map, or oblique for the neighborhood.
    const focusPos = this.focusPositionKm();
    const toStar =
      this.focusPlanet || this.focusAsteroid
        ? focusPos.normalize().negate()
        : preset === 'galaxy'
          ? new Vector3(3, 5, 14).normalize()
          : preset === 'system'
            ? new Vector3(0.35, 1.15, 0.85).normalize()
            : new Vector3(0.3, 0.17, 1).normalize();
    const arrival = toStar.clone().applyAxisAngle(new Vector3(0, 1, 0), 0.7);
    // Ringed worlds greet the camera from above the ring plane — an
    // edge-on arrival would collapse the rings to a one-pixel sliver.
    if (this.focusPlanet?.rings) arrival.y += 0.55;
    arrival.normalize();
    this.camera.position.copy(arrival).multiplyScalar(this.radiusKm + this.altitudeKm);
    this.camera.up.set(0, 1, 0);
    // Any free-flight wandering ends here: the orbit re-anchors on the
    // new focus and pending ride input clears.
    this.controls.target.set(0, 0, 0);
    this.pendingWheelFactor = 1;
    this.controls.update();

    // Descending pitches toward screen-up: the orbit view keeps north
    // at the top of the frame, so a zero heading makes the horizon rise
    // straight ahead instead of sweeping sideways. Right-drag turns.
    this.headingRad = 0;
    this.pitchRad = 0;
  }

  /** Promote any materialized belt member to the focused body. */
  focusBeltAsteroid(asteroid: Asteroid): void {
    if (!this.system) return;
    this.clearFocus();
    this.focus = -1;
    this.focusAsteroid = asteroid;
    this.applyAsteroidFocus(asteroid);
    this.arriveAtFocus('planet');
  }

  /** True when the segment camera→point passes behind the focus body. */
  private occludedByFocus(x: number, y: number, z: number): boolean {
    const cam = this.camera.position;
    const dx = x - cam.x;
    const dy = y - cam.y;
    const dz = z - cam.z;
    const lengthSq = dx * dx + dy * dy + dz * dz;
    if (lengthSq < 1) return false;
    // Closest approach of the segment to the focus body at the origin.
    const t = Math.max(0, Math.min(1, -(cam.x * dx + cam.y * dy + cam.z * dz) / lengthSq));
    const px = cam.x + dx * t;
    const py = cam.y + dy * t;
    const pz = cam.z + dz * t;
    const r = this.radiusKm * 0.98;
    return t > 0 && t < 1 && px * px + py * py + pz * pz < r * r;
  }

  /** Find the pickable nearest the cursor and drive the tooltip. */
  private updateHover(): void {
    const rect = this.pipeline.renderer.domElement.getBoundingClientRect();
    let best: Pickable | null = null;
    if (this.cursor && !this.dragging) {
      const [cx, cy] = this.cursor;
      const v = new Vector3();
      let bestPx = 26;
      const consider = (pickable: Pickable, bias: number): void => {
        v.set(pickable.x, pickable.y, pickable.z).project(this.camera);
        if (v.z > 1 || v.z < -1) return;
        const sx = (v.x * 0.5 + 0.5) * rect.width;
        const sy = (-v.y * 0.5 + 0.5) * rect.height;
        const d = Math.hypot(sx - cx, sy - cy) * bias;
        if (d >= bestPx) return;
        if (this.occludedByFocus(pickable.x, pickable.y, pickable.z)) return;
        bestPx = d;
        best = pickable;
      };
      for (const pickable of this.pickables) consider(pickable, 1);

      // Neighborhood stars: bulk scan of the 3D point field.
      if (this.neighborPoints && this.system) {
        const positions = this.neighborPoints.geometry.getAttribute('position') as BufferAttribute;
        this.pcGroup.updateWorldMatrix(true, false);
        const matrix = this.pcGroup.matrixWorld;
        let bestStar = -1;
        for (let i = 0; i < positions.count; i++) {
          v.fromBufferAttribute(positions, i).applyMatrix4(matrix);
          const wx = v.x;
          const wy = v.y;
          const wz = v.z;
          v.project(this.camera);
          if (v.z > 1 || v.z < -1) continue;
          const sx = (v.x * 0.5 + 0.5) * rect.width;
          const sy = (-v.y * 0.5 + 0.5) * rect.height;
          const d = Math.hypot(sx - cx, sy - cy) * 1.5;
          if (d >= bestPx) continue;
          if (this.occludedByFocus(wx, wy, wz)) continue;
          bestPx = d;
          bestStar = i;
          best = null;
        }
        // The far field: catalog stars with seeds of their own — any
        // glint in the sky identifies itself and can be traveled to.
        // They are true 3D points; project their actual positions.
        if (this.skyData && this.farPoints) {
          const sky = this.skyData;
          const farPositions = this.farPoints.geometry.getAttribute(
            'position',
          ) as BufferAttribute;
          let bestFar = -1;
          for (let i = 0; i < farPositions.count; i++) {
            v.fromBufferAttribute(farPositions, i).applyMatrix4(matrix);
            v.project(this.camera);
            if (v.z > 1 || v.z < -1) continue;
            const sx = (v.x * 0.5 + 0.5) * rect.width;
            const sy = (-v.y * 0.5 + 0.5) * rect.height;
            const d = Math.hypot(sx - cx, sy - cy) * 1.45;
            if (d >= bestPx) continue;
            bestPx = d;
            bestFar = i;
            best = null;
            bestStar = -1;
          }
          if (bestFar >= 0) {
            const s = sky.nearStarCount + bestFar;
            const distance = sky.starDistances[s];
            const starSeed = sky.starSeeds[s];
            const world = v
              .fromBufferAttribute(farPositions, bestFar)
              .applyMatrix4(matrix);
            const position = { x: world.x, y: world.y, z: world.z };
            if (starSeed !== 0n) {
              const seedHex = seedToHex(starSeed);
              best = {
                ...position,
                name: `SIM-${seedHex.slice(-8).toUpperCase()}`,
                info: `${spectralType(starPhotometry(starSeed))} · ${fmt(distance, 3)} pc`,
                action: 'click to travel',
                target: { kind: 'neighbor', seedHex },
              };
            } else {
              // Cluster members ride their group's stream, not a seed
              // of their own — identifiable, not yet addressable.
              const tEff = sky.starTeffs[s];
              best = {
                ...position,
                name: 'cluster member',
                info: `${spectralLetter(tEff)}-type · ≈${fmt(distance, 3)} pc · coeval group`,
                action: null,
                target: null,
              };
            }
          }
        }

        if (bestStar >= 0 && this.neighborSeedHexes[bestStar]) {
          const seedHex = this.neighborSeedHexes[bestStar];
          const physical = starPhotometry(seedFromHex(seedHex));
          const distancePc = Math.hypot(
            this.neighborPositionsPc[bestStar * 3],
            this.neighborPositionsPc[bestStar * 3 + 1],
            this.neighborPositionsPc[bestStar * 3 + 2],
          );
          v.fromBufferAttribute(positions, bestStar).applyMatrix4(matrix);
          best = {
            x: v.x,
            y: v.y,
            z: v.z,
            name: `SIM-${seedHex.slice(-8).toUpperCase()}`,
            info: `${spectralType(physical)} · ${fmt(distancePc)} pc`,
            action: 'click to travel',
            target: { kind: 'neighbor', seedHex },
          };
        }
      }
    }

    this.hovered = best;
    if (!best) {
      if (this.hoveredKey) {
        this.hoveredKey = '';
        this.tooltip.style.display = 'none';
        this.tooltipLine.setAttribute('visibility', 'hidden');
      }
      return;
    }
    const key = `${best.name}|${best.info}`;
    if (key !== this.hoveredKey) {
      this.hoveredKey = key;
      this.tooltip.innerHTML = `
        <div class="tip-name">${best.name}</div>
        <div class="tip-info">${best.info}</div>
        ${best.action ? `<div class="tip-action">${best.action}</div>` : ''}
      `;
      this.tooltip.style.display = 'block';
    }
    const v = new Vector3(best.x, best.y, best.z).project(this.camera);
    const sx = (v.x * 0.5 + 0.5) * rect.width;
    const sy = (-v.y * 0.5 + 0.5) * rect.height;
    const boxX = Math.max(8, Math.min(rect.width - 270, sx + 22));
    const boxY = Math.max(8, Math.min(rect.height - 90, sy - 48));
    this.tooltip.style.left = `${boxX}px`;
    this.tooltip.style.top = `${boxY}px`;
    this.tooltipLine.setAttribute('visibility', 'visible');
    this.tooltipLine.setAttribute('x1', String(sx));
    this.tooltipLine.setAttribute('y1', String(sy));
    this.tooltipLine.setAttribute('x2', String(boxX + 4));
    this.tooltipLine.setAttribute('y2', String(boxY + this.tooltip.offsetHeight - 4));
  }

  /**
   * Materialize the belt population around the camera: the orbital
   * cells whose Keplerian motion has carried members near the camera's
   * belt position instantiate deterministically. Each member is a true
   * body — a shaped, spinning rock instance when resolved, a
   * reflected-sunlight photometric glint when subpixel — and a click
   * promotes it to the focused body. The additive point cloud stays as
   * the far-field statistical limit of the same population.
   */
  private updateBeltRegion(tSeconds: Seconds, focusPos: Vector3): void {
    const mesh = this.beltRockMesh;
    const points = this.beltRockPoints;
    if (!mesh || !points || !this.system) return;

    const REACH_AU = 0.35;
    const frameInv = this.frameQuat.clone().invert();
    // Camera into the heliocentric model frame (undo the ground frame).
    const helio = this.camera.position.clone().applyQuaternion(frameInv).add(focusPos);
    const mx = helio.x / AU_KM;
    const my = -helio.z / AU_KM;
    const rAu = Math.hypot(mx, my);
    const phi = Math.atan2(my, mx);

    const cells: Array<{ belt: number; band: number; sector: number }> = [];
    this.system.belts.forEach((belt, beltIndex) => {
      if (rAu < belt.innerAu - REACH_AU || rAu > belt.outerAu + REACH_AU) return;
      const bands = beltBandCount(belt);
      const inner2 = belt.innerAu ** 2;
      const outer2 = belt.outerAu ** 2;
      const bandOf = (a: number): number =>
        Math.floor(((a * a - inner2) / (outer2 - inner2)) * bands);
      const b0 = Math.max(0, bandOf(Math.max(belt.innerAu, rAu - REACH_AU)));
      const b1 = Math.min(bands - 1, bandOf(Math.min(belt.outerAu, rAu + REACH_AU)));
      for (let band = b0; band <= b1; band++) {
        // Members now at the camera's azimuth started the epoch back
        // along their mean motion; eccentricity widens the window.
        const lambdaEpoch = phi - bandMeanMotion(belt, band, this.systemMu) * tSeconds;
        const center = Math.round((lambdaEpoch / (2 * Math.PI)) * BELT_SECTORS);
        const margin =
          1 +
          Math.ceil(
            ((0.3 + REACH_AU / Math.max(rAu, 0.2)) / (2 * Math.PI)) * BELT_SECTORS,
          );
        for (let ds = -margin; ds <= margin; ds++) {
          cells.push({ belt: beltIndex, band, sector: center + ds });
        }
      }
    });

    const signature = cells.map((c) => `${c.belt}:${c.band}:${c.sector}`).join('|');
    if (signature !== this.beltCellSignature) {
      this.beltCellSignature = signature;
      // Instantiate the covered cells, then keep the nearest members —
      // a naive cap would truncate the region's far side.
      const drawn: Array<{ asteroid: Asteroid; distanceKm: number }> = [];
      for (const cell of cells) {
        const belt = this.system.belts[cell.belt];
        const beltSeed = deriveSeed(seedFromHex(this.system.seedHex), 'belt-region', cell.belt);
        for (const asteroid of beltCellAsteroids(beltSeed, belt, cell.band, cell.sector, 6)) {
          const state = elementsToState(asteroid.elements, this.systemMu, tSeconds);
          const posKm = toWorld(state.position).divideScalar(1000);
          const distanceKm = Math.hypot(
            posKm.x - helio.x,
            posKm.y - helio.y,
            posKm.z - helio.z,
          );
          if (distanceKm < REACH_AU * 1.4 * AU_KM) drawn.push({ asteroid, distanceKm });
        }
      }
      drawn.sort((a, b) => a.distanceKm - b.distanceKm);
      this.beltCandidates = drawn.slice(0, 900).map(({ asteroid }) => {
        const radiusKm = asteroid.diameterKm / 2;
        const axisRng = new Rng(deriveSeed(seedFromHex(asteroid.shape.noiseSeedHex), 'spin-axis'));
        const axisZ = axisRng.range(-1, 1);
        const axisAzimuth = axisRng.range(0, 2 * Math.PI);
        const planar = Math.sqrt(Math.max(0, 1 - axisZ * axisZ));
        // Reflected sunlight as a pseudo-luminosity for the glint shader.
        const starDistanceKm = (asteroid.elements.semiMajorAxis / AU) * AU_KM;
        const pseudoLum =
          this.system!.star.luminosity *
          (radiusKm / (2 * starDistanceKm)) ** 2 *
          asteroid.albedo *
          4;
        return {
          asteroid,
          spinAxis: new Vector3(planar * Math.cos(axisAzimuth), axisZ, planar * Math.sin(axisAzimuth)),
          radiusKm,
          pseudoLum,
        };
      });
    }

    const positionAttr = points.geometry.getAttribute('position') as BufferAttribute;
    const colorAttr = points.geometry.getAttribute('starColor') as BufferAttribute;
    const lumAttr = points.geometry.getAttribute('luminosity') as BufferAttribute;
    const radiusAttr = points.geometry.getAttribute('aRadiusKm') as BufferAttribute;
    const [sr, sg, sb] = this.system.star.linearRgb;
    const matrix = new Matrix4();
    const spinQuat = new Quaternion();
    const scale = new Vector3();
    let meshCount = 0;
    let pointCount = 0;

    const writeGlint = (
      pos: Vector3,
      distanceKm: number,
      pseudoLum: number,
      radiusKm: number,
    ): void => {
      if (pointCount >= 900) return;
      positionAttr.setXYZ(pointCount, pos.x, pos.y, pos.z);
      colorAttr.setXYZ(pointCount, sr, sg, sb);
      // Physical reflected light when close; a faint marker floor
      // otherwise — the moons-and-planets legibility convention, since
      // a kilometers-scale rock at these ranges is honestly invisible.
      const dPc = distanceKm / PC_KM;
      lumAttr.setX(pointCount, Math.max(pseudoLum, 2.5e-5 * dPc * dPc));
      radiusAttr.setX(pointCount, radiusKm);
      pointCount++;
    };

    for (let i = 0; i < this.beltCandidates.length; i++) {
      const candidate = this.beltCandidates[i];
      const state = elementsToState(candidate.asteroid.elements, this.systemMu, tSeconds);
      const pos = toWorld(state.position)
        .divideScalar(1000)
        .sub(focusPos)
        .applyQuaternion(this.frameQuat);
      const distanceKm = pos.distanceTo(this.camera.position);
      if (distanceKm > REACH_AU * AU_KM * 1.5) continue;

      writeGlint(pos, distanceKm, candidate.pseudoLum, candidate.radiusKm);
      this.pickables.push({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        name: `${this.system.star.designation} A-${candidate.asteroid.shape.noiseSeedHex.slice(-4).toUpperCase()}`,
        info: `belt member · ${fmt(candidate.asteroid.diameterKm)} km · ${candidate.asteroid.taxonomy}-type`,
        action: 'click to visit',
        target: { kind: 'belt', asteroid: candidate.asteroid },
      });
      if (meshCount < 320 && candidate.radiusKm / distanceKm > 4e-5) {
        const { shape, spinPeriodHours } = candidate.asteroid;
        const spinAngle = ((tSeconds / (spinPeriodHours * 3600)) * 2 * Math.PI) % (2 * Math.PI);
        spinQuat.setFromAxisAngle(candidate.spinAxis, spinAngle);
        const base = candidate.radiusKm / 0.65;
        scale.set(base / shape.elongation, base * shape.flattening, base);
        matrix.compose(pos, spinQuat, scale);
        mesh.setMatrixAt(meshCount, matrix);
        meshCount++;
      }
    }

    // The notable landmarks glint too — the same population's large end.
    for (let i = 0; i < this.asteroids.length; i++) {
      const notable = this.asteroids[i];
      if (notable === this.focusAsteroid) continue;
      const state = elementsToState(notable.elements, this.systemMu, tSeconds);
      const pos = toWorld(state.position)
        .divideScalar(1000)
        .sub(focusPos)
        .applyQuaternion(this.frameQuat);
      const distanceKm = pos.distanceTo(this.camera.position);
      const radiusKm = notable.diameterKm / 2;
      const starDistanceKm = (notable.elements.semiMajorAxis / AU) * AU_KM;
      const pseudoLum =
        this.system.star.luminosity * (radiusKm / (2 * starDistanceKm)) ** 2 * notable.albedo * 4;
      writeGlint(pos, distanceKm, pseudoLum, radiusKm);
      this.pickables.push({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        name: `${this.system.star.designation} A-${notable.shape.noiseSeedHex.slice(-4).toUpperCase()}`,
        info: `belt asteroid · ${fmt(notable.diameterKm)} km · ${notable.taxonomy}-type`,
        action: 'click to visit',
        target: { kind: 'notable', index: i },
      });
    }
    mesh.count = meshCount;
    mesh.instanceMatrix.needsUpdate = true;
    points.geometry.setDrawRange(0, pointCount);
    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    lumAttr.needsUpdate = true;
    radiusAttr.needsUpdate = true;
  }

  set exposure(value: number) {
    this.pipeline.exposure = value;
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyChange);
    window.removeEventListener('keyup', this.onKeyChange);
    window.removeEventListener('blur', this.onWindowBlur);
    this.controls.dispose();
    this.clearFocus();
    this.clearSystem();
    this.terrainMaterial.dispose();
    this.scatterMaterial.dispose();
    this.beltRockGeometry.dispose();
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
          mu: muOf(G * (planet.physical.bulk.massEarth + moon.physical.bulk.massEarth) * EARTH_MASS),
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
    this.focusAsteroid = null;
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
    if (this.farPoints) {
      this.pcGroup.remove(this.farPoints);
      this.farPoints.geometry.dispose();
      (this.farPoints.material as ShaderMaterial).dispose();
      this.farPoints = null;
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
    this.beltCandidates = [];
    this.beltCellSignature = '';
    if (this.beltRockMesh) this.beltRockMesh.count = 0;
    this.beltRockPoints?.geometry.setDrawRange(0, 0);
    if (this.backdrop) {
      this.scene.remove(this.backdrop.group);
      this.backdrop.dispose();
      this.backdrop = null;
    }
    if (this.galaxyVolume) {
      this.scene.remove(this.galaxyVolume.mesh);
      this.galaxyVolume.dispose();
      this.galaxyVolume = null;
    }
    this.skyData = null;
    this.system = null;
  }

  /**
   * Daylight washout applied to everything stellar beyond the system.
   * The system's own star glints stay full — an unresolved sun (or a
   * bright companion) outshines any daytime sky.
   */
  private setSkyIntensity(value: number): void {
    // The backdrop fades out as the volumetric galaxy fades in — its
    // sky-sphere geometry is wrong once the camera has real parallax.
    // The neighborhood points are true 3D and stay: they simply recede.
    if (this.backdrop) this.backdrop.intensity = value * (1 - this.galaxyFade);
    if (this.neighborPoints) {
      (this.neighborPoints.material as ShaderMaterial).uniforms.uIntensity.value = value;
    }
    if (this.farPoints) {
      (this.farPoints.material as ShaderMaterial).uniforms.uIntensity.value = value;
    }
  }

  /**
   * Heliocentric star positions at t, km, world axes. A close p-type
   * pair orbits its barycenter (which the planets orbit); a wide
   * companion moves on its relative orbit around the primary.
   */
  private stellarPositionsKm(tSeconds: Seconds): Vector3[] {
    const system = this.system!;
    const positions = [new Vector3()];
    for (let i = 0; i < this.starNodes.length - 1; i++) {
      const companion = system.companions[i];
      const pairMu = muOf(G * (system.star.mass + companion.star.mass) * SOLAR_MASS);
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
    const tSeconds = seconds(this.simTimeDays * DAY);
    if (this.focusAsteroid) {
      const { position } = elementsToState(
        this.focusAsteroid.elements,
        muOf(G * this.system.centralMassSolar * SOLAR_MASS),
        tSeconds,
      );
      return toWorld(position).divideScalar(1000);
    }
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
      // Asteroid shapes legitimately dip far below the datum sphere.
      const floorKm = this.focusAsteroid ? -this.radiusKm * 0.6 : -this.radiusKm * 0.01;
      const surfaceKm = this.radiusKm + Math.max(groundKm, floorKm);
      // The wheel rides toward what the camera is anchored on: the focus
      // body's surface when the orbit target sits there (altitude scales,
      // buttery down to the ground), or the panned anchor when free
      // flight has moved it — zoom goes where you look, not back home.
      const anchor = this.controls.target;
      if (anchor.lengthSq() < 1) {
        const freeAltitudeKm = Math.max(
          this.camera.position.length() - surfaceKm,
          this.minAltitudeKm,
        );
        this.altitudeKm = Math.min(
          this.maxAltitudeKm(),
          Math.max(freeAltitudeKm * this.pendingWheelFactor, this.minAltitudeKm),
        );
        this.camera.position.copy(up).multiplyScalar(surfaceKm + this.altitudeKm);
      } else {
        if (this.pendingWheelFactor !== 1) {
          const offset = this.camera.position.clone().sub(anchor);
          const distance = Math.max(offset.length() * this.pendingWheelFactor, 1);
          this.camera.position.copy(anchor).addScaledVector(offset.normalize(), distance);
        }
        // Altitude still derives from the focus body: floors and ceilings
        // stay planetary even while the ride is anchored elsewhere.
        const radial = this.camera.position.length();
        this.altitudeKm = Math.min(
          this.maxAltitudeKm(),
          Math.max(radial - surfaceKm, this.minAltitudeKm),
        );
        if (radial - surfaceKm < this.minAltitudeKm || radial - surfaceKm > this.maxAltitudeKm()) {
          this.camera.position.copy(up).multiplyScalar(surfaceKm + this.altitudeKm);
        }
      }
      this.pendingWheelFactor = 1;

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
        // Slerp from the orbit gaze into the steerable horizon gaze:
        // blending orientations (not look-at vectors) keeps the roll
        // continuous through the transition — a radial-up look-at near
        // nadir would snap screen-up from north to the heading, which
        // reads as the whole surface suddenly rotating.
        const forward = heading.addScaledVector(up, -0.12 + Math.sin(this.pitchRad)).normalize();
        const gaze = new Matrix4().lookAt(
          this.camera.position,
          this.camera.position.clone().add(forward),
          up,
        );
        const groundQuat = new Quaternion().setFromRotationMatrix(gaze);
        const t = horizonBlend * horizonBlend * (3 - 2 * horizonBlend);
        this.camera.quaternion.slerp(groundQuat, t);
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

      // The sky sphere hands off to the volumetric galaxy with distance
      // from the system: same model, inside view to outside view.
      const distancePc = this.camera.position.length() / PC_KM;
      const fade = Math.min(
        1,
        Math.max(0, (distancePc - GALAXY_FADE_NEAR_PC) / (GALAXY_FADE_FAR_PC - GALAXY_FADE_NEAR_PC)),
      );
      this.galaxyFade = fade * fade * (3 - 2 * fade);

      this.updateWorld(up);
      this.updateHover();

      if (this.backdrop) {
        this.backdrop.group.position.copy(this.camera.position);
        const centerDistSq = this.camera.position.lengthSq();
        const tangentKm = Math.sqrt(Math.max(0, centerDistSq - this.radiusKm * this.radiusKm));
        this.backdrop.group.scale.setScalar(Math.max(1, (tangentKm * 1.35) / 2000));
      }
      if (this.galaxyVolume) {
        const worldToScene = new Matrix3().setFromMatrix4(
          new Matrix4().makeRotationFromQuaternion(new Quaternion().copy(this.frameQuat).invert()),
        );
        // Dome radius: inside the far plane, but capped — software
        // rasterizers shred at 1e17-km clip coordinates.
        this.galaxyVolume.update(
          this.camera.position,
          worldToScene,
          PC_KM,
          this.galaxyFade,
          Math.min(this.camera.far * 0.3, 3e15),
        );
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
    this.pickables.length = 0;
    const solid = this.field !== null;
    const tSeconds = seconds(this.simTimeDays * DAY);
    const yAxis = new Vector3(0, 1, 0);

    // Ground-fixed frame: the heliocentric world (stars, planets, belts,
    // sky) sweeps around a spinning solid focus; envelopes spin their
    // cloud bands instead (mesh rotation inside PlanetObject).
    const spinPeriodHours =
      this.focusAsteroid?.spinPeriodHours ?? this.focusPlanet?.physical.rotation.periodHours;
    // Negative: the body rotates prograde — the same sense it revolves,
    // and the same sense the envelope planets spin their bands — so the
    // solar day runs longer than the sidereal day and moons lag the
    // stars instead of outrunning them.
    const spin =
      solid && spinPeriodHours ? (-2 * Math.PI * 24 * this.simTimeDays) / spinPeriodHours : 0;
    // Terrain worlds put their spin axis on world Y, so their axial tilt
    // lives in the frame: the ecliptic leans by the obliquity. Envelope
    // focuses tilt the body instead (inside PlanetObject).
    const tilt = solid && this.focusPlanet ? this.focusPlanet.physical.rotation.obliquityRad : 0;
    this.frameQuat
      .setFromAxisAngle(yAxis, spin)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), tilt));
    const focusPos = this.focusPositionKm();
    this.heliocentric.quaternion.copy(this.frameQuat);
    this.heliocentric.position.copy(focusPos).negate().applyQuaternion(this.frameQuat);
    if (this.backdrop) this.backdrop.group.quaternion.copy(this.frameQuat);

    const toFocusWorld = (heliocentricKm: Vector3): Vector3 =>
      heliocentricKm.clone().sub(focusPos).applyQuaternion(this.frameQuat);

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
      const star = i === 0 ? this.system.star : this.system.companions[i - 1]?.star;
      if (star && this.focus !== 'star') {
        this.pickables.push({
          x: node.object.group.position.x,
          y: node.object.group.position.y,
          z: node.object.group.position.z,
          name: star.designation,
          info: `${star.spectralType} · ${i === 0 ? 'primary' : 'companion'}`,
          action: 'click for star view',
          target: { kind: 'star' },
        });
      }
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
      const { climate, bulk } = node.planet.physical;
      this.pickables.push({
        x: worldPos.x,
        y: worldPos.y,
        z: worldPos.z,
        name: node.planet.name,
        info: `${node.planet.class} · ${fmt(bulk.massEarth)} M⊕ · ${fmt(climate.surfaceMeanK, 3)} K`,
        action: 'click to visit',
        target: { kind: 'planet', index: i },
      });
    }

    for (const material of this.beltMaterials) {
      material.uniforms.uTimeYears.value = this.simTimeDays / 365.25;
    }
    const cometHead = new Vector3();
    for (let i = 0; i < this.cometObjects.length; i++) {
      const comet = this.cometObjects[i];
      comet.update(tSeconds);
      if (comet.getHeadWorldPosition(cometHead)) {
        const elements = this.system.comets[i].elements;
        const perihelionAu = (elements.semiMajorAxis * (1 - elements.eccentricity)) / AU;
        this.pickables.push({
          x: cometHead.x,
          y: cometHead.y,
          z: cometHead.z,
          name: `${this.system.star.designation} comet`,
          info: `active comet · q ${fmt(perihelionAu)} AU`,
          action: null,
          target: null,
        });
      }
    }
    this.updateBeltRegion(tSeconds, focusPos);

    this.bodyObject?.update(this.simTimeDays, sunDir, lightColor);

    // Moons on their true orbits; the focus planet eclipses them. Their
    // group carries the ground frame's diurnal sweep — equatorial
    // content spins without the ecliptic's obliquity lean — so moons
    // rise and set over a fixed landscape like everything else in the
    // sky, lagging the stars by their own orbital rate.
    if (this.moonGroup) this.moonGroup.rotation.y = spin;
    const planetCaster = { position: new Vector3(0, 0, 0), radius: this.radiusKm };
    const moonWorld = new Vector3();
    for (const { moon, object, marker, mu } of this.moons) {
      const state = elementsToState(moon.elements, mu, tSeconds);
      object.group.position.copy(toWorld(state.position)).divideScalar(1000);
      moonWorld.copy(object.group.position).applyAxisAngle(yAxis, spin);
      object.update(this.simTimeDays, sunDir, lightColor);
      object.setOccluders([planetCaster], angularRadius);

      const cameraDistance = this.camera.position.distanceTo(moonWorld);
      const moonRadiusKm = moon.physical.bulk.radiusEarth * EARTH_RADIUS_KM;
      marker.visible = moonRadiusKm / cameraDistance < 0.004;
      marker.scale.setScalar((cameraDistance * 0.0045) / EARTH_RADIUS_KM);
      this.pickables.push({
        x: moonWorld.x,
        y: moonWorld.y,
        z: moonWorld.z,
        name: moon.name,
        info: `moon · ${fmt(moonRadiusKm)} km${moon.tidalState !== 'dead' ? ` · ${moon.tidalState}` : ''}`,
        action: null,
        target: null,
      });
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

    for (const material of [this.terrainMaterial, this.scatterMaterial, this.oceanMaterial]) {
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
