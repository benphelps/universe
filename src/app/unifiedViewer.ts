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
  Ray,
  Scene,
  Sphere,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { elementsToState, orbitPath } from '../core/math/kepler';
import { orbitalPeriod } from '../core/math/orbit';
import {
  AU,
  DAY,
  EARTH_MASS,
  EARTH_RADIUS,
  G,
  PARSEC,
  SOLAR_MASS,
  SOLAR_RADIUS,
  SOLAR_LUMINOSITY,
} from '../core/physics/constants';
import { mu as muOf, seconds, type Mu, type Seconds } from '../core/physics/units';
import { blackbodyLinearRgb } from '../core/color/blackbody';
import { Rng } from '../core/rng/rng';
import { deriveSeed, seedFromHex, seedToHex } from '../core/rng/hash';
import { createTemperatureLutTexture } from '../render/color/temperatureLut';
import { createAtmosphereShell } from '../render/planet/atmosphereShell';
import { PlanetObject } from '../render/planet/planetObject';
import { createRingMesh } from '../render/planet/ringMaterial';
import { applyOccluders } from '../render/planet/shadows';
import { planetSeedOffset } from '../render/planet/solidPlanetMaterial';
import { RenderPipeline } from '../render/fx/pipeline';
import { StarObject } from '../render/star/starObject';
import { applySecondSun } from '../render/lighting/secondSun';
import { foldShaderTime } from '../render/shaderTime';
import {
  reflectedFluxRatio,
  shineTint,
  type ShineBody,
} from '../render/lighting/reflectedLight';
import { StarfieldBackdrop } from '../render/starfield/starfieldBackdrop';
import {
  createNeighborStars,
  createStarPointsMaterial,
  setStarNebulaExtinction,
} from '../render/starfield/neighborStars';
import { createBeltPointsForSystem } from '../render/system/beltPoints';
import {
  BELT_REGION_POINT_CAPACITY,
  createBeltRegionPoints,
  finishBeltRegionPoints,
  updateBeltRegionPointFrame,
  writeBeltRegionPoint,
} from '../render/system/beltRegionPoints';
import { CometObject } from '../render/system/cometObject';
import { createOrbitLine } from '../render/system/orbitLine';
import { createBeltAnnulus, createZoneRings } from '../render/system/zoneRings';
import { SPLIT_RATIO, TerrainChunkManager } from '../render/terrain/chunkManager';
import { PointConeIndex } from '../render/picking/pointConeIndex';
import { createCloudShell } from '../render/terrain/cloudShell';
import { createMagmaMaterial, createOceanMaterial } from '../render/terrain/oceanSphere';
import {
  createRockGeometry,
  createScatterMaterial,
  createTreeGeometry,
} from '../render/terrain/scatterObjects';
import { createSkyDome } from '../render/terrain/skyDome';
import { createTerrainMaterial } from '../render/terrain/terrainMaterial';
import { BlackHoleObject } from '../render/blackhole/blackHoleObject';
import { framedFlowRadiusRg, LENSING_SOLID_RG } from '../render/blackhole/geodesicGlsl';
import { LensedSky } from '../render/blackhole/lensedSky';
import { stellarBlackHole } from '../universe/star/stellarHole';
import { GalaxyParticles } from '../render/galaxy/galaxyParticles';
import { createLandmarkMarkers } from '../render/galaxy/landmarkMarkers';
import { GalaxyVolume } from '../render/galaxy/galaxyVolume';
import { markAsDiagram } from '../render/fx/diagramLayer';
import { requestNebulaVolume } from './nebulaService';
import { nebulaFor, type Nebula } from '../universe/galaxy/nebula';
import { cloudReachPc, cloudsNear, type MolecularCloud } from '../universe/galaxy/clouds';
import type { NebulaVolumeBake } from '../universe/galaxy/nebulaVolume';
import { NebulaVolume } from '../render/galaxy/nebulaVolume';
import { NuclearCluster } from '../render/galaxy/nuclearCluster';
import { SectorChart } from '../render/galaxy/sectorChart';
import {
  computeNeighborhood,
  NEIGHBOR_RADIUS_PC,
  type Neighbor,
} from '../universe/galaxy/neighborhood';
import { galacticNucleus } from '../universe/galaxy/nucleus';
import { starPhotometry } from '../universe/galaxy/photometry';
import { sectorNameForSeed } from '../universe/galaxy/regions';
import { dustOpticalDepth, type GalacticPosition } from '../universe/galaxy/density';
import { spectralType } from '../universe/star/classification';
import { starDesignation } from '../universe/star/naming';
import type { Moon } from '../universe/moon/types';
import type { Characterization } from '../universe/planet/types';
import type { RingSystem } from '../universe/rings/types';
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
import { deriveTreeSpecies } from '../universe/surface/flora';
import { companionPlanetMu, planetMu } from '../universe/system/generate';
import { holeDonors } from '../universe/system/holeDonors';
import { rotateToScene, sceneFromGalaxy, sceneFromUpAxis } from '../universe/galaxy/orientation';
import {
  meanPopulationLuminosity,
  type SkyField,
  type SkyPreview,
} from '../universe/galaxy/skyfield';
import { getGalacticLandmarks } from './landmarkService';
import { cancelSkyBuilds, getSkyField, skyPending, skyProgress, watchSkyBuild } from './skyService';
import { bakeQueueDepth } from '../render/planet/surfaceBakeQueue';
import { FlightCamera, type FlightSurface } from './flightCamera';
import { fmt } from './ui/format';
import type { Planet, StarSystem } from '../universe/system/types';

const EARTH_RADIUS_KM = EARTH_RADIUS / 1000;
const SOLAR_RADIUS_KM = SOLAR_RADIUS / 1000;
const AU_KM = AU / 1000;
const BELT_REGION_REACH_AU = 0.35;
/** Rebase GPU orbit phases before float time loses useful precision. */
const BELT_POINT_REBASE_DAYS = 16_384;
/** A hole described in scene coordinates needs no rotation into them. */
const IDENTITY_FRAME = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const IDENTITY_MATRIX = new Matrix3();
const PC_KM = PARSEC / 1000;
/** How long the orbit keeps gliding after the hand comes off, seconds. */
const ORBIT_EASE_SECONDS = 0.05;
const GALAXY_ARRIVAL_ALTITUDE_KM = 15 * PC_KM;
/** High enough to frame the whole galaxy from above the disk. */
const MAX_ALTITUDE_KM = 45_000 * PC_KM;

/** Crossfade band (distance from the system, pc) where the sky-sphere
 *  backdrop hands off to the volumetric galaxy — the sphere's parallax
 *  breaks down at these heights, the volume takes over. */
/** How far out a nebula is still worth a volume of its own. */
const NEBULA_VOLUME_REACH_PC = 900;
const NEBULA_VOLUME_SIZE = 96;
/** Within this many cloud reaches, the box holds the whole cloud. */
const NEBULA_CLOUD_SCALE_RADII = 3;
/** How far the arrival stands off a cloud it lands inside. */
const NEBULA_FRAMING_RADII = 2.2;
/** Only clouds this close can be the one the camera is standing in. */
const NEBULA_HOME_REACH_PC = 400;
const GALAXY_FADE_NEAR_PC = 60;
const GALAXY_FADE_FAR_PC = 450;
/** Layers below the galaxy renderers' existing cutoff are visually nil. */
const SKY_VISIBILITY_FLOOR = 0.002;
const ORIGIN = new Vector3();

/** A backdrop standing before the sweep has no stars of its own yet. */
const EMPTY_F32 = new Float32Array(0);

/** Where the camera arrives, in units of the flow's drawn radius. Far
 *  enough to stand outside the flow — from within it, a disc is a floor
 *  and the hole is a bump on it — and close enough that it still
 *  reaches the edges of the frame. */
const FLOW_STANDOFF = 1.6;

/**
 * How far the camera stops down at the galactic centre. Eighteen
 * thousand of the cluster's stars are drawn and every one of them is
 * within a few parsecs — brighter, most of them, than Sirius is from
 * Earth. A sky like that is genuinely blinding, and a camera pointed
 * into it would be stopped right down; at the exposure the rest of the
 * universe is viewed at, it is a white sheet.
 */
const CORE_EXPOSURE = 0.22;

/** The galaxy's own centre — where the hole is, by definition. */
const GALACTIC_CENTRE: GalacticPosition = { xPc: 0, yPc: 0, zPc: 0 };

/** Point stars snap the hover only from this close (px), so the space
 *  between glints stays hoverable for nebulae, rifts, and the other
 *  extended sky objects; solid pickables keep their generous reach. */
const STAR_SNAP_PX = 10;

/** Auto ride-out pace: decades of altitude per second. Constant speed
 *  per scale decade — ground to galaxy frame spans ~17 decades (~28 s),
 *  a system view about half that. */
const RIDE_OUT_DECADES_PER_SEC = 0.6;

/** A planet's year in days — the seasonal clock its weather runs on. */
function orbitDays(mu: Mu, planet: Planet): number {
  return orbitalPeriod(mu, planet.elements.semiMajorAxis) / 86400;
}

export type FocusTarget = 'star' | 'cloud' | number | { planet: number; moon: number };

/** A cloud as a subject: its body, and the group lighting it if any. */
export interface FocusedCloud {
  cloud: MolecularCloud;
  nebula: Nebula | null;
}
export type ScenePreset = 'star' | 'system' | 'planet' | 'galaxy';

/** What a pick resolved to; main decides how to act on it. */
export type PickTarget =
  | { kind: 'star'; companion?: number }
  | { kind: 'planet'; index: number }
  | { kind: 'moon'; planet: number; index: number }
  | { kind: 'notable'; index: number }
  | { kind: 'belt'; asteroid: Asteroid }
  | { kind: 'neighbor'; seedHex: string; positionPc: GalacticPosition }
  | { kind: 'cloud'; seedHex: string; positionPc: GalacticPosition };

interface Pickable {
  x: number;
  y: number;
  z: number;
  name: string;
  info: string;
  action: string | null;
  target: PickTarget | null;
}

interface BeltCandidate {
  asteroid: Asteroid;
  spinAxis: Vector3;
  radiusKm: number;
  pseudoLum: number;
  pickable: Pickable;
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
  /** Set only where the star is a black hole: the traced hole, the sky
   *  captured at it, and where that sky was captured from. */
  hole: BlackHoleObject | null;
  holeSky: LensedSky | null;
  capturedAt: Vector3 | null;
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
  private readonly terrainMaterial = createTerrainMaterial(SPLIT_RATIO);
  private readonly scatterMaterial = createScatterMaterial();
  /** Heliocentric content riding the focus translation and ground spin. */
  private readonly heliocentric = new Group();
  /** Map-frame subgroups (1 unit = 1 AU, z out of plane) inside it. */
  private readonly auGroup = new Group();
  private readonly stellarOrbits = new Group();
  private readonly overlay = new Group();
  /** Zone rings and belt annuli: same map altitudes, own toggle. */
  private readonly zoneOverlay = new Group();
  /** Orbit traces of a focused planet's moons, inside moonGroup. */
  private moonOrbits: Group | null = null;
  /** Neighborhood stars (1 unit = 1 pc, already scene-frame) inside it. */
  private readonly pcGroup = new Group();
  private neighborPoints: Points | null = null;
  private neighborPointIndex: PointConeIndex | null = null;
  /** The far catalog stars as true 3D points (direction × distance in
   *  the neighborhood frame): parallax-correct at any altitude, they
   *  persist through the backdrop→volume crossfade — only the
   *  unresolved-glow representations swap. */
  private farPoints: Points | null = null;
  private farPointIndex: PointConeIndex | null = null;
  private hostIndex = -1;
  private hostStar: Star | null = null;
  private hostBelts: StarSystem['belts'] = [];
  private hostSeedHex = '';
  private neighborSeedHexes: string[] = [];
  private neighborGalacticPc: Float32Array = new Float32Array(0);
  private viewpointPc: GalacticPosition = { xPc: 0, yPc: 0, zPc: 0 };
  private neighborPositionsPc: Float32Array = new Float32Array(0);
  /** Photometric glints for the system's own stars at unresolved range. */
  private starSprites: Points | null = null;
  private starNodes: StarNode[] = [];
  private planetNodes: PlanetNode[] = [];
  private beltMaterials: ShaderMaterial[] = [];
  private cometObjects: CometObject[] = [];
  private backdrop: StarfieldBackdrop | null = null;
  /** Slabs of the sky drawn while the rest of it is still being swept. */
  private skyPreview: Points[] = [];
  /** The rotation those slabs are placed with, known before the field
   *  itself is: the galaxy's frame does not wait on the sweep. */
  private skyPreviewFrame: Float32Array | null = null;
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
  /** The one nearby nebula drawn as the volume it is, rather than as a
   *  sprite on the sky. The rest of the sky keeps its sprites. */
  private nebulaVolume: NebulaVolume | null = null;
  private volumeSuppressedSeed: bigint | null = null;
  /** The cloud's own body, and its ionized region at its own scale. */
  private coarseBake: NebulaVolumeBake | null = null;
  private fineBake: NebulaVolumeBake | null = null;
  private galaxyParticles: GalaxyParticles | null = null;
  /** Set while the camera is at the galactic centre: no system at all,
   *  the galaxy around it, and the hole traced at its own scale. */
  private coreView = false;
  private blackHole: BlackHoleObject | null = null;
  private lensedSky: LensedSky | null = null;
  private skyCaptured = false;
  /** The exposure the session was viewing at before the centre. */
  private exposureOutsideCore = 1;
  private nuclearCluster: NuclearCluster | null = null;
  /** Sky frame the cluster would be built in, once it is worth building. */
  private clusterFrame: Float32Array | null = null;
  /** Dust transmission from the camera to the galactic centre. From
   *  inside the disk this is effectively zero — the centre is dozens of
   *  optical depths away — and it only opens up above the dust layer. */
  private coreTransmission = 0;
  /** The named complexes as travel targets, in scene-frame pc. */
  private landmarkList: import('../universe/galaxy/regions').GalacticLandmark[] | null = null;
  private landmarkScene: Float32Array | null = null;
  private landmarkMarkers: Points | null = null;
  private galaxyFade = 0;
  private sectorChart: SectorChart | null = null;
  /** User toggle: sector borders, sky-region borders, and their names. */
  chartVisible = true;
  /** User toggle: planet, moon, and stellar orbit lines. */
  orbitsVisible = true;
  /** User toggle: habitable-zone rings and belt annuli. */
  zonesVisible = true;
  /** User toggle: the marker spheres carrying subpixel bodies. */
  markersVisible = true;

  /** What the background generators are working on right now: terrain
   *  tiles in flight, distant-world bakes queued, the focused world's
   *  climate survey, and sky fields still building. */
  get generationStatus(): {
    surveying: boolean;
    terrain: number;
    worlds: number;
    skies: number;
    skyProgress: number;
    skyStage: string;
    skyStageProgress: number;
  } {
    const sky = skyProgress();
    return {
      surveying: this.surveying,
      terrain: this.chunkManager?.outstanding ?? 0,
      worlds: bakeQueueDepth(),
      skies: skyPending(),
      skyProgress: sky.fraction,
      skyStage: sky.stage,
      skyStageProgress: sky.stageFraction,
    };
  }

  /** Free flight: right-shift + drag pans the camera through space. */
  private rightShiftHeld = false;
  /** Plain right-drag pan in progress (space altitudes only). */
  private panHeld = false;
  /** Wheel ride input, applied to the altitude during the next frame. */
  private pendingWheelFactor = 1;
  /** Auto wheel ride: >0 while the slow pull-back to the galaxy runs. */
  private rideOutRate = 0;
  /** Fired when the automatic ride out starts, ends, or is cut short. */
  onRideOutChange: ((active: boolean) => void) | null = null;
  private readonly onKeyChange = (e: KeyboardEvent): void => {
    if (e.code !== 'ShiftRight') return;
    this.rightShiftHeld = e.type === 'keydown';
  };
  private readonly onWindowBlur = (): void => {
    this.rightShiftHeld = false;
    this.panHeld = false;
    this.controls.enabled = true;
  };

  /**
   * Grab space itself: a screen-plane slide scaled by altitude, so the
   * same gesture moves meters over a ridge and parsecs across the
   * neighborhood. Shared by the right-drag and the two-finger pan.
   */
  private panBy(dxPixels: number, dyPixels: number): void {
    const rect = this.pipeline.renderer.domElement.getBoundingClientRect();
    const worldPerPixel =
      (2 *
        Math.tan((this.camera.fov * Math.PI) / 360) *
        Math.max(this.altitudeKm, this.minAltitudeKm)) /
      Math.max(rect.height, 1);
    const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const upVec = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const delta = right
      .multiplyScalar(-dxPixels * worldPerPixel)
      .addScaledVector(upVec, dyPixels * worldPerPixel);
    this.camera.position.add(delta);
    this.controls.target.add(delta);
  }

  /**
   * The switch wears the drag it is doing: an orbit ring around a
   * body, or the four ways space slides. Near the ground, where a
   * right-drag turns the head instead of grabbing space, it says so.
   */
  private paintDragMode(): void {
    const button = this.dragModeButton;
    if (!button) return;
    const panning = this.touchDragMode === 'pan';
    const surface = this.inSurfaceRegime();
    // Down at the surface the alternative to panning is the head, not
    // an orbit there is nothing to orbit around.
    const looking = !panning && surface;
    button.classList.toggle('active', panning);
    const label = panning
      ? `drag pans — switch to ${surface ? 'look' : 'orbit'}`
      : looking
        ? 'drag looks around — switch to pan'
        : 'drag orbits — switch to pan';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(panning));
    button.innerHTML = `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${
      !panning
        ? // An orbit ring carrying its body around a centre.
          '<circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="9.2" ry="4.4" transform="rotate(-28 12 12)"/><circle cx="19" cy="8.6" r="1.7" fill="currentColor" stroke="none"/>'
        : looking
          ? // An eye: the horizon gaze the same drag turns down here.
            '<path d="M2.6 12S6.2 6.2 12 6.2 21.4 12 21.4 12 17.8 17.8 12 17.8 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.5"/>'
          : // The four ways space slides under a finger.
            '<path d="M12 3.4v17.2M3.4 12h17.2M12 3.4 9.4 6M12 3.4 14.6 6M12 20.6 9.4 18M12 20.6 14.6 18M3.4 12 6 9.4M3.4 12 6 14.6M20.6 12 18 9.4M20.6 12 18 14.6"/>'
    }</svg>`;
  }

  /**
   * Who owns the drag right now. The orbit gives it up to ground
   * flight, to a finger set to pan, to a mouse pan — and to any
   * gesture with a second finger in it: OrbitControls has no state for
   * a two-finger gesture whose dolly and pan are both switched off, so
   * it stays in touch-rotate and steers by the midpoint between the
   * fingers. Left enabled, a pinch would spin the camera by whatever
   * that midpoint did. A pinch is a pinch and nothing else.
   */
  private syncControlsEnabled(): void {
    const fingerPanning = this.oneFingerDown && this.touchDragMode === 'pan';
    this.controls.enabled =
      !this.flight.active &&
      !this.multiTouched &&
      !fingerPanning &&
      // Down at the surface the left button is the head and the right
      // one is the ground; the orbit has nothing left to steer, and
      // steering anyway was what inverted the drag down there.
      !this.inSurfaceRegime() &&
      !((this.rightShiftHeld || this.panHeld) && this.freeFlightAvailable());
  }

  /** Latch the span a pinch measures from. */
  private beginTwoFinger(): void {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return;
    this.pinchSpan = Math.hypot(a.x - b.x, a.y - b.y);
    // A pinch supersedes whatever a tap had named or a drag had hold of.
    this.armedKey = '';
    this.cursor = null;
    this.tapPending = null;
    this.grabbed = null;
  }

  /**
   * The pinch rides the scales and does nothing else. Fingers never
   * hold their centre while they spread, so reading a pan out of it
   * too would drag the camera sideways through every zoom — the drag
   * mode owns panning instead.
   */
  private updateTwoFinger(): void {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return;
    const span = Math.hypot(a.x - b.x, a.y - b.y);
    if (this.pinchSpan > 0 && span > 0) {
      // Spreading the fingers descends, the way scrolling up does.
      this.stopRideOut();
      this.pendingWheelFactor *= this.pinchSpan / span;
    }
    this.pinchSpan = span;
  }

  /**
   * A finger has no hover, so the tap itself is the probe: it waits for
   * the next pass to name what it hit, and only a second tap on the
   * same body acts. Travel is a long way back if it was a mis-tap.
   */
  private resolveTap(): void {
    const tap = this.tapPending;
    if (!tap) return;
    this.tapPending = null;
    const target = this.hovered?.target;
    if (!target || this.flight.active) {
      this.armedKey = '';
      this.cursor = null;
      return;
    }
    if (this.hoveredKey === this.armedKey) {
      this.armedKey = '';
      this.cursor = null;
      this.onPick?.(target);
    } else {
      this.armedKey = this.hoveredKey;
    }
  }

  /**
   * Where the horizon gaze has the camera: the body fills the view and
   * the orbit means nothing, so the drag takes hold of the ground and
   * the head instead. The same threshold the gaze blends over, so the
   * controls change hands exactly when the view does.
   */
  private inSurfaceRegime(): boolean {
    return !this.flight.active && this.altitudeKm < 0.12 * this.radiusKm;
  }

  /**
   * Where a screen point's ray meets the focused body, as a unit
   * direction from its centre. Past the limb the ray misses entirely,
   * so the closest approach stands in and the grab stays continuous
   * out into the sky.
   */
  private surfaceDirectionAt(clientX: number, clientY: number, radiusKm: number): Vector3 {
    // Unprojection reads the world matrix, which is otherwise a render
    // behind — and a drag can turn the camera several times between
    // two frames.
    this.camera.updateMatrixWorld();
    const rect = this.pipeline.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
      -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1,
    );
    const origin = this.camera.position.clone();
    const direction = new Vector3(ndc.x, ndc.y, 0.5)
      .unproject(this.camera)
      .sub(origin)
      .normalize();
    const ray = new Ray(origin, direction);
    const hit = new Vector3();
    if (!ray.intersectSphere(new Sphere(new Vector3(), radiusKm), hit)) {
      ray.closestPointToPoint(new Vector3(), hit);
    }
    return hit.lengthSq() > 0 ? hit.normalize() : origin.normalize();
  }

  /**
   * Once a press has plainly become a drag, take the pointer: it goes
   * invisible and stops moving, so the gesture can run as far as the
   * hand does. Waiting for real movement first leaves a plain click
   * alone. Capture is the fallback if the lock is refused — it at
   * least keeps events coming from outside the viewport.
   */
  private holdPointer(e: PointerEvent): void {
    const lock = this.dragLock;
    if (!lock || lock.held) return;
    if (Math.hypot(e.clientX - lock.startX, e.clientY - lock.startY) < 3) return;
    lock.held = true;
    lock.x = e.clientX;
    lock.y = e.clientY;
    const element = this.pipeline.renderer.domElement;
    try {
      element.setPointerCapture(e.pointerId);
    } catch {
      // No capture available; the lock below is the real mechanism.
    }
    try {
      const request = element.requestPointerLock() as unknown as Promise<void> | undefined;
      request?.catch?.(() => {
        // Refused: the capture still keeps the drag alive.
      });
    } catch {
      // Same.
    }
  }

  /** Let the pointer go, wherever the drag ended. */
  private releasePointer(): void {
    if (this.dragLock?.held && document.pointerLockElement === this.pipeline.renderer.domElement) {
      document.exitPointerLock();
    }
    this.dragLock = null;
  }

  /**
   * Where the drag's pointer is. A captured pointer reports the same
   * client position forever, so it carries one of its own instead —
   * moved by the deltas, and held inside the viewport, which is the
   * one place a grabbed point can still be aimed at.
   */
  private dragPointerAt(e: PointerEvent): [number, number] {
    const lock = this.dragLock;
    if (!lock?.held) return [e.clientX, e.clientY];
    const rect = this.pipeline.renderer.domElement.getBoundingClientRect();
    lock.x = Math.max(rect.left, Math.min(rect.right, lock.x + e.movementX));
    lock.y = Math.max(rect.top, Math.min(rect.bottom, lock.y + e.movementY));
    return [lock.x, lock.y];
  }

  /** Take hold of whatever the cursor is over, if the body is near
   *  enough to grab. */
  private beginGrab(clientX: number, clientY: number): boolean {
    if (!this.inSurfaceRegime()) return false;
    const radiusKm = Math.max(this.camera.position.length() - this.altitudeKm, 1e-6);
    this.grabbed = {
      radiusKm,
      direction: this.surfaceDirectionAt(clientX, clientY, radiusKm),
    };
    return true;
  }

  /**
   * Carry the ground with the cursor: the surface point the drag took
   * hold of stays under the cursor, so the body turns exactly as far
   * as the hand moves it and no further. Solved against that grabbed
   * point every move rather than accumulated from deltas, so it can
   * neither drift nor run away at its own speed.
   */
  private dragSurface(clientX: number, clientY: number): void {
    const grab = this.grabbed;
    if (!grab) return;
    const under = this.surfaceDirectionAt(clientX, clientY, grab.radiusKm);
    const turn = new Quaternion().setFromUnitVectors(under, grab.direction);
    // The camera turns bodily about the body's centre, orientation with
    // it, so the solve holds for several moves inside one frame.
    this.camera.position.applyQuaternion(turn);
    this.camera.quaternion.premultiply(turn);
  }

  /** Above the horizon-gaze regime, right-drag grabs space instead of
   *  turning the head. */
  private inPanRegime(): boolean {
    return (
      !this.flight.active &&
      this.freeFlightAvailable() &&
      this.altitudeKm > 0.12 * this.radiusKm
    );
  }

  /**
   * Free flight belongs to the space views. On the ground — a solid
   * body below the altitude where the horizon gaze engages — descent
   * and ground flight own the camera.
   */
  private freeFlightAvailable(): boolean {
    // The core view orbits one point and nothing else: an anchor moved
    // off the hole would take the altitude ladder with it.
    if (this.coreView) return false;
    const grounded = this.field !== null || this.focusAsteroid !== null;
    return !grounded || this.altitudeKm > this.radiusKm * 0.12;
  }
  /** WASD locomotion once the wheel ride touches down. */
  private readonly flight = new FlightCamera();
  private walkHint: HTMLDivElement | null = null;
  private walkHintText = '';
  private recenter: HTMLButtonElement | null = null;
  /** Hold-to-fly, the ground regime's control on a touch device. */
  private flyStick: HTMLButtonElement | null = null;
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
  /** True while the focused world's climate/river survey is still in a
   *  worker — the field stands, its rivers attach when it lands. */
  private surveying = false;
  private system: StarSystem | null = null;
  private focus: FocusTarget = 'star';
  /** The cloud the camera is standing off, when one is the focus. */
  private focusCloud: FocusedCloud | null = null;
  private focusMoon: Moon | null = null;
  /** The parent planet hanging in a focused moon's sky. */
  private parentObject: PlanetObject | null = null;
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
  private beltCandidates: BeltCandidate[] = [];
  /** Only candidates resolved on the last 10 Hz selection pass need
   * CPU propagation while no hover probe is active. */
  private beltMeshCandidates: BeltCandidate[] = [];
  private lastBeltMeshSelectionMs = -Infinity;
  private beltCellSignature = '';
  private beltPointEpochDays = Number.NaN;
  private beltPointFocusAsteroid: Asteroid | null = null;
  private pointerDownAt: [number, number] | null = null;
  /** Everything hoverable this frame; nearest to the cursor tooltips. */
  private pickables: Pickable[] = [];
  /** Body discs that block the hover: a star behind a planet is not
   *  under the cursor. World-frame spheres, rebuilt with pickables. */
  private occluders: Array<{ x: number; y: number; z: number; rKm: number }> = [];
  private hovered: Pickable | null = null;
  private hoveredKey = '';
  private cursor: [number, number] | null = null;
  /** Narrow-cone candidates replace projecting every catalog star. */
  private readonly neighborHoverCandidates: number[] = [];
  private readonly farHoverCandidates: number[] = [];
  private readonly hoverRayOrigin = new Vector3();
  private readonly hoverRayDirection = new Vector3();
  private readonly hoverPcInverse = new Matrix4();
  private hoverViewportWidth = 1;
  private hoverViewportHeight = 1;
  private tooltipHeight = 0;
  /** Live fingers by pointer id; the two-finger gestures read from here. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  /** Span of the last two-finger frame, for the pinch delta. */
  private pinchSpan = 0;
  /**
   * What one finger does when it drags. A mouse has two buttons for
   * this; a finger has a switch instead — 'pan' makes the drag behave
   * as a right-drag does, grabbing space or turning the head by
   * regime.
   */
  private touchDragMode: 'orbit' | 'pan' = 'orbit';
  /** A single finger is down and dragging: the orbit yields to it. */
  private oneFingerDown = false;
  private dragModeButton: HTMLButtonElement | null = null;
  /** The surface point a drag has hold of: a unit direction from the
   *  body's centre, and the sphere radius it was taken on. */
  private grabbed: { direction: Vector3; radiusKm: number } | null = null;
  /**
   * A surface drag holds the pointer once it is plainly a drag: hidden,
   * and unable to walk out of the viewport and cut the gesture short
   * halfway through a turn. `x`/`y` carry the pointer's position while
   * it is captured, since a captured pointer has none of its own.
   */
  private dragLock: {
    startX: number;
    startY: number;
    x: number;
    y: number;
    held: boolean;
  } | null = null;
  /** Distance the pointer has covered since it went down — a captured
   *  pointer's client position never moves, so a drag would otherwise
   *  release as a click. */
  private dragTravelPx = 0;
  /** The regime the switch was last drawn for. */
  private dragModeLooking = false;
  /** A second finger joined this gesture: it is no longer a tap. */
  private multiTouched = false;
  /** True once the last input came from a finger: the tooltip arms
   *  before it acts, and the ground regime grows a fly control. */
  private touchMode = false;
  /** A tap waiting on the next hover pass to learn what it hit. */
  private tapPending: [number, number] | null = null;
  /** What the last tap named; a second tap on the same body commits. */
  private armedKey = '';
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
    for (const group of [this.auGroup, this.overlay, this.zoneOverlay, this.stellarOrbits]) {
      group.rotation.x = -Math.PI / 2;
      group.scale.setScalar(AU_KM);
      this.heliocentric.add(group);
    }
    this.pcGroup.scale.setScalar(PC_KM);
    this.heliocentric.add(this.pcGroup);
    this.scene.add(this.heliocentric);

    // Down where the body fills the view the orbit means nothing, so
    // the buttons take the jobs they hold everywhere else: left turns
    // the head, right grabs the ground. Higher up the left button goes
    // back to the orbit and the right one keeps panning.
    this.pipeline.renderer.domElement.addEventListener('pointermove', (e) => {
      if ((e.buttons & 1) === 0 || this.rightShiftHeld || this.flight.active) return;
      if (!this.inSurfaceRegime()) return;
      this.holdPointer(e);
      // The head turns with the hand, at the pace it turns on foot:
      // this is the same first-person view as ground flight, reached a
      // little before the feet touch down. The ground is what gets
      // grabbed and carried; the view is what gets aimed.
      this.headingRad += e.movementX * 0.0022;
      this.pitchRad = Math.min(1.5, Math.max(-1.5, this.pitchRad - e.movementY * 0.0022));
    });
    // The right button is a camera control at every altitude, so the
    // scene owns the menu it would otherwise raise. OrbitControls
    // suppresses this too, but only while it is enabled — and it is
    // not, in the regimes where the right button matters most.
    this.pipeline.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    this.pipeline.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      // Either button, down here: one aims the view and the other
      // carries the ground, and both want the whole desk to work in.
      if ((e.button === 0 || e.button === 2) && this.inSurfaceRegime()) {
        this.dragLock = { startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, held: false };
      }
      if (e.button !== 2) return;
      if (this.beginGrab(e.clientX, e.clientY) || this.inPanRegime()) this.panHeld = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0 || e.button === 2) this.releasePointer();
      if (e.button !== 2) return;
      this.panHeld = false;
      this.grabbed = null;
    });
    // Escape hands the pointer back mid-drag; the gesture carries on
    // with a cursor that exists again.
    document.addEventListener('pointerlockchange', () => {
      if (this.dragLock && document.pointerLockElement !== this.pipeline.renderer.domElement) {
        this.dragLock.held = false;
      }
    });

    // On foot the mouse is the head: click takes pointer lock, motion
    // steers the gaze, Escape hands the cursor back.
    this.pipeline.renderer.domElement.addEventListener('click', () => {
      if (!this.flight.active || this.touchMode) return;
      if (document.pointerLockElement !== this.pipeline.renderer.domElement) {
        // The cursor stops existing the moment it is captured; leaving
        // its last position behind would leave a probe in the sky.
        this.cursor = null;
        this.pipeline.renderer.domElement.requestPointerLock();
      }
    });
    this.pipeline.renderer.domElement.addEventListener('pointermove', (e) => {
      if (document.pointerLockElement !== this.pipeline.renderer.domElement) return;
      if (!this.flight.active) return;
      // Head convention, not the drag handler's grab-the-world sign:
      // mouse right looks right.
      this.headingRad += e.movementX * 0.0022;
      this.pitchRad = Math.min(1.5, Math.max(-1.5, this.pitchRad - e.movementY * 0.0022));
    });

    // Free flight in every view: right-drag (or right-shift + drag)
    // grabs space itself — a screen-plane pan scaled by altitude, so
    // the same gesture slides meters over a ridge and parsecs across
    // the neighborhood. Looking down it sweeps the horizontal plane;
    // toward the horizon, vertical.
    this.pipeline.renderer.domElement.addEventListener('pointermove', (e) => {
      const rightDragPan = (e.buttons & 2) !== 0 && this.panHeld;
      const shiftPan = this.rightShiftHeld && e.buttons !== 0;
      if (!rightDragPan && !shiftPan) return;
      if (this.grabbed) {
        this.holdPointer(e);
        this.dragSurface(...this.dragPointerAt(e));
        return;
      }
      if (!this.freeFlightAvailable()) return;
      this.panBy(e.movementX, e.movementY);
    });
    // Fingers: one drags (OrbitControls orbits, or the gaze turns on
    // foot), two ride and pan at once — the wheel and the right-drag
    // of a device that has neither.
    this.pipeline.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.touchMode = true;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.oneFingerDown = this.touches.size === 1;
      if (this.oneFingerDown && this.touchDragMode === 'pan') {
        this.beginGrab(e.clientX, e.clientY);
      }
      if (this.touches.size >= 2) {
        this.multiTouched = true;
        this.beginTwoFinger();
      }
      // Now, not at the next frame: a move can arrive before it.
      this.syncControlsEnabled();
    });
    this.pipeline.renderer.domElement.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') return;
      const previous = this.touches.get(e.pointerId);
      if (!previous) return;
      const dx = e.clientX - previous.x;
      const dy = e.clientY - previous.y;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size >= 2) {
        this.updateTwoFinger();
        return;
      }
      // The tail of a pinch, fingers coming off one at a time: the
      // remainder is not a fresh drag, and nothing takes it over
      // until the hand is off the glass.
      if (this.multiTouched) return;
      if (this.flight.active) {
        // Pointer lock is a mouse idea; on foot the drag is the head.
        this.headingRad += dx * 0.0032;
        this.pitchRad = Math.min(1.5, Math.max(-1.5, this.pitchRad - dy * 0.0032));
      } else if (this.touchDragMode === 'pan') {
        // Whichever pan applies here — the ground itself, or the scene.
        if (this.grabbed) this.dragSurface(e.clientX, e.clientY);
        else if (this.inPanRegime()) this.panBy(dx, dy);
      } else if (this.inSurfaceRegime()) {
        // The orbit's finger, down where there is nothing to orbit: the
        // same head the drag turns on foot.
        this.headingRad += dx * 0.0032;
        this.pitchRad = Math.min(1.5, Math.max(-1.5, this.pitchRad - dy * 0.0032));
      }
    });
    const endTouch = (e: PointerEvent): void => {
      if (e.pointerType !== 'touch') return;
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.panHeld = false;
      this.grabbed = null;
      if (this.touches.size === 0) {
        this.multiTouched = false;
        this.oneFingerDown = false;
      } else if (this.touches.size >= 2) {
        this.beginTwoFinger();
      }
      this.syncControlsEnabled();
    };
    this.pipeline.renderer.domElement.addEventListener('pointerup', endTouch);
    this.pipeline.renderer.domElement.addEventListener('pointercancel', endTouch);

    window.addEventListener('keydown', this.onKeyChange);
    window.addEventListener('keyup', this.onKeyChange);
    window.addEventListener('blur', this.onWindowBlur);

    this.pipeline.renderer.domElement.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.stopRideOut();
        this.pendingWheelFactor *= 1.0016 ** e.deltaY;
      },
      { passive: false },
    );

    const BELT_ROCK_CAP = 320;
    this.beltRockMesh = new InstancedMesh(this.beltRockGeometry, this.scatterMaterial, BELT_ROCK_CAP);
    this.beltRockMesh.count = 0;
    this.beltRockMesh.frustumCulled = false;
    this.scene.add(this.beltRockMesh);
    this.beltRockPoints = createBeltRegionPoints(
      PC_KM,
      BELT_REGION_REACH_AU * AU_KM * 1.5,
    );
    this.scene.add(this.beltRockPoints);

    // Hover tooltip: the body nearest the cursor names itself, with a
    // connector line; a click acts on it.
    this.tooltip = document.createElement('div');
    this.tooltip.id = 'pick-tip';
    this.tooltip.style.display = 'none';
    container.appendChild(this.tooltip);
    this.walkHint = document.createElement('div');
    this.walkHint.id = 'walk-hint';
    this.walkHint.style.display = 'none';
    container.appendChild(this.walkHint);
    // Panning moves the orbit anchor off the focus; this brings it home.
    this.recenter = document.createElement('button');
    this.recenter.id = 'recenter';
    this.recenter.textContent = 'return to focus';
    this.recenter.style.display = 'none';
    this.recenter.addEventListener('click', () => {
      this.controls.target.set(0, 0, 0);
    });
    container.appendChild(this.recenter);
    // On foot a finger has no WASD: look with the drag, hold this to
    // fly where you look. It shares the flight camera's key path.
    this.flyStick = document.createElement('button');
    this.flyStick.id = 'fly-stick';
    this.flyStick.setAttribute('aria-label', 'fly forward');
    this.flyStick.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5.5 5 18l7-3.6 7 3.6z"/></svg>';
    this.flyStick.style.display = 'none';
    this.flyStick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.flight.press('KeyW');
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      this.flyStick.addEventListener(type, () => this.flight.release('KeyW'));
    }
    container.appendChild(this.flyStick);
    // The switch a mouse doesn't need: which of the two drags one
    // finger is doing. It stands where the fly stick would, since the
    // two never apply at once.
    this.dragModeButton = document.createElement('button');
    this.dragModeButton.id = 'drag-mode';
    this.dragModeButton.style.display = 'none';
    this.dragModeButton.addEventListener('click', () => {
      this.touchDragMode = this.touchDragMode === 'orbit' ? 'pan' : 'orbit';
      this.paintDragMode();
    });
    this.paintDragMode();
    container.appendChild(this.dragModeButton);
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
      if (e.buttons !== 0) {
        this.dragTravelPx += Math.hypot(e.movementX || 0, e.movementY || 0);
      }
      if (document.pointerLockElement) return;
      this.dragging = e.buttons !== 0;
      // A finger has no hover, so only a tap probes; a drag must not
      // leave a phantom cursor naming whatever it ended over.
      if (e.pointerType === 'touch') return;
      const rect = this.pipeline.renderer.domElement.getBoundingClientRect();
      this.hoverViewportWidth = Math.max(rect.width, 1);
      this.hoverViewportHeight = Math.max(rect.height, 1);
      this.cursor = [e.clientX - rect.left, e.clientY - rect.top];
    });
    this.pipeline.renderer.domElement.addEventListener('pointerleave', () => {
      this.cursor = null;
    });
    this.pipeline.renderer.domElement.addEventListener('pointerdown', (e) => {
      this.dragTravelPx = 0;
      if (e.button === 0) this.pointerDownAt = [e.clientX, e.clientY];
    });
    this.pipeline.renderer.domElement.addEventListener('pointerup', (e) => {
      const down = this.pointerDownAt;
      this.pointerDownAt = null;
      this.dragging = false;
      if (!down || e.button !== 0) return;
      // A held pointer's client position never moves, so how far it
      // actually travelled is the only thing separating a look from a
      // click.
      if (this.dragTravelPx > 6) return;
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      if (e.pointerType === 'touch') {
        if (this.multiTouched) return;
        const rect = this.pipeline.renderer.domElement.getBoundingClientRect();
        this.hoverViewportWidth = Math.max(rect.width, 1);
        this.hoverViewportHeight = Math.max(rect.height, 1);
        this.cursor = [e.clientX - rect.left, e.clientY - rect.top];
        this.tapPending = this.cursor;
        return;
      }
      if (this.hovered?.target && !this.flight.active) this.onPick?.(this.hovered.target);
    });

    window.addEventListener('resize', this.onResize);
    this.resize();
    requestAnimationFrame(() => this.frame());
  }

  /** Build the system-wide content: stars, planets, belts, comets, overlay. */
  setSystem(system: StarSystem): void {
    this.clearFocus();
    this.clearCore();
    this.clearSystem();
    this.system = system;

    // Real photospheres at scene root: the corona billboard orients by
    // copying the camera quaternion, so star groups must not inherit the
    // heliocentric group's spin rotation. Positions are set every frame.
    const spriteColors: number[] = [];
    const spriteLuminosities: number[] = [];
    const spriteRadii: number[] = [];
    const addStar = (star: Star, index: number): void => {
      const object = new StarObject(star, this.lut);
      object.group.scale.setScalar(SOLAR_RADIUS_KM);
      this.scene.add(object.group);
      // A black hole is not shaded, it is traced: the same pass the
      // galactic nucleus uses, at seven orders of magnitude less.
      let hole: BlackHoleObject | null = null;
      let holeSky: LensedSky | null = null;
      // A remnant's own luminosity is zero, which is the truth about
      // the hole and a lie about the system: what falls in radiates,
      // and for one taking a companion's overflow that is tens of
      // thousands of suns out of an object no wider than a town. Left
      // at zero it has no sprite and casts no light, so the brightest
      // thing for a light-hour around is invisible.
      let luminosity = star.luminosity;
      let color = star.linearRgb;
      if (star.stage === 'black-hole') {
        const model = stellarBlackHole(star, holeDonors(system, index), this.holeAxis(system, index));
        hole = new BlackHoleObject(model, this.lut, IDENTITY_FRAME);
        holeSky = new LensedSky(512);
        hole.sky = holeSky.target;
        this.scene.add(hole.mesh);
        luminosity = model.flow.luminosityW / SOLAR_LUMINOSITY;
        color = blackbodyLinearRgb(model.flow.innerTemperatureK);
      }
      this.starNodes.push({
        object,
        radiusKm: Math.max(star.radius, 1e-4) * SOLAR_RADIUS_KM,
        hole,
        holeSky,
        capturedAt: null,
      });
      spriteColors.push(...color);
      spriteLuminosities.push(luminosity);
      spriteRadii.push(Math.max(star.radius, 1e-4) * SOLAR_RADIUS_KM);
    };
    addStar(system.star, 0);
    for (let c = 0; c < system.companions.length; c++) {
      const companion = system.companions[c];
      // Every companion shines, and its stellar orbit is charted like a
      // planet's — visible whenever the orbit map is.
      addStar(companion.star, c + 1);
      this.stellarOrbits.add(createOrbitLine(companion.elements, 0xa0a0cc, 0.55));
      this.markDiagrams();
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

    this.asteroids = notableAsteroids(system);
    this.setHost(0);

    // The neighborhood rides in the scene as true 3D points: the night
    // sky's near field from the ground, the flyable galaxy layer from
    // interstellar altitude — the same objects, parallax-correct.

    const viewpoint = system.localePc;
    this.viewpointPc = viewpoint;
    this.buildNeighborhood();

    const galaxyOrientation = sceneFromGalaxy(seedFromHex(system.seedHex));
    // The same rotation the finished field will carry, so a slab drawn
    // early sits exactly where its star ends up.
    this.skyPreviewFrame = galaxyOrientation;
    this.galaxyVolume = new GalaxyVolume(viewpoint, galaxyOrientation);
    this.galaxyVolume.meanLuminosity = meanPopulationLuminosity();
    this.scene.add(this.galaxyVolume.mesh);
    this.galaxyParticles = new GalaxyParticles(viewpoint, galaxyOrientation, PC_KM);
    this.pcGroup.add(this.galaxyParticles.group);
    this.chooseNebulaVolume(viewpoint, galaxyOrientation);
    // The nuclear cluster waits until something could see it. From
    // anywhere in the disk the centre is a hundred magnitudes of dust
    // away, so surveying tens of thousands of its stars and shipping
    // them to the GPU on every arrival would buy a black screen.
    this.clusterFrame = galaxyOrientation;
    // The landmark catalog is universal; orient it into this system's
    // sky frame when it lands (once per session, off-thread).
    getGalacticLandmarks().then((landmarks) => {
      if (this.disposed || this.system !== system) return;
      const scenePc = new Float32Array(landmarks.length * 3);
      for (let i = 0; i < landmarks.length; i++) {
        const p = landmarks[i].positionPc;
        const [x, y, z] = rotateToScene(
          galaxyOrientation,
          p.xPc - viewpoint.xPc,
          p.yPc - viewpoint.yPc,
          p.zPc - viewpoint.zPc,
        );
        scenePc[i * 3] = x;
        scenePc[i * 3 + 1] = y;
        scenePc[i * 3 + 2] = z;
      }
      this.landmarkList = landmarks;
      this.landmarkScene = scenePc;
      this.landmarkMarkers = createLandmarkMarkers(landmarks, scenePc);
      this.pcGroup.add(this.landmarkMarkers);
    });

    // Slabs land one at a time over what can be a minute in the bulge.
    // Each one is drawn as it arrives, so the sky thickens in front of
    // the traveler instead of a progress bar counting toward a field
    // that appears all at once at the end.
    watchSkyBuild(
      system.seedHex,
      (preview) => {
        if (this.disposed || this.system !== system) return;
        this.addSkyPreview(preview);
      },
      // The gas, dust and glow are built beside the sweep rather than
      // after it, so they land seconds in. The backdrop draws no stars
      // — every one of them is 3D content — which means this is the
      // whole of it and the finished field has nothing to add.
      (background) => {
        if (this.disposed || this.system !== system || this.backdrop) return;
        this.backdrop = new StarfieldBackdrop(
          { ...background, starCount: 0, starDirs: EMPTY_F32, starColors: EMPTY_F32, starBrightness: EMPTY_F32 },
          2000,
        );
        if (this.volumeSuppressedSeed !== null) {
          this.backdrop.suppressNebula(this.volumeSuppressedSeed);
        }
        this.scene.add(this.backdrop.group);
      },
    );

    getSkyField(system.seedHex, viewpoint).then((sky) => {
      if (this.disposed || this.system !== system) return;
      this.clearSkyPreview();
      this.skyData = sky;
      // Every resolved star is 3D content (near field above, far field
      // here); the backdrop keeps only the unresolved sky — glow,
      // rifts, nebulae, dark clouds — which the galaxy volume replaces.
      // It usually stands already, put up when the background landed.
      if (!this.backdrop) {
        this.backdrop = new StarfieldBackdrop(sky, 2000, sky.starCount);
        if (this.volumeSuppressedSeed !== null) {
          this.backdrop.suppressNebula(this.volumeSuppressedSeed);
        }
        this.scene.add(this.backdrop.group);
      }
      this.sectorChart = new SectorChart(sky);
      this.pcGroup.add(this.sectorChart.group);

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
        this.farPointIndex = new PointConeIndex(positions, farCount);
      }
    });
  }

  /**
   * The nebula worth drawing as a volume: the brightest H II region
   * near enough to have a face, and far enough that the camera is not
   * standing inside the box. One for now — the tier that keeps several
   * resident and hands off to the sprites by projected size comes with
   * the streaming pass.
   */
  private chooseNebulaVolume(viewpoint: GalacticPosition, orientation: Float32Array): void {
    // Which cloud is worth a volume is a question about the screen, not
    // about distance: radii run from ten parsecs to sixty, so a great
    // cloud well away can cover more of the sky than a small one
    // nearby. Every cloud is a candidate, lit or not — the dark rifts
    // are the same objects and they are bodies too.
    let chosen: MolecularCloud | null = null;
    let bestAngular = 0;
    for (const cloud of cloudsNear(viewpoint, NEBULA_VOLUME_REACH_PC)) {
      const dx = cloud.positionPc.xPc - viewpoint.xPc;
      const dy = cloud.positionPc.yPc - viewpoint.yPc;
      const dz = cloud.positionPc.zPc - viewpoint.zPc;
      const angular = cloudReachPc(cloud) / Math.max(1, Math.hypot(dx, dy, dz));
      if (angular <= bestAngular) continue;
      bestAngular = angular;
      chosen = cloud;
    }
    if (chosen) this.requestVolumeFor(chosen, viewpoint, orientation);
  }

  /**
   * The volume for one cloud, at both the scales it needs.
   *
   * A cloud is a hundred parsecs and the bubble its newborns blow is a
   * few. One grid cannot hold both — a box around the cloud puts the
   * whole ionized region inside a single cell, and the nebula
   * disappears — so the cloud's dust is baked at cloud scale and the
   * H II region again at its own, and the march reads whichever it is
   * passing through.
   */
  private requestVolumeFor(
    cloud: MolecularCloud,
    viewpoint: GalacticPosition,
    orientation: Float32Array,
  ): void {
    const stale = (): boolean => this.disposed || this.viewpointPc !== viewpoint;
    const nebula = nebulaFor(cloud);
    const lit = nebula !== null && nebula.photonRate > 0;
    const coarse = requestNebulaVolume(
      cloud,
      NEBULA_VOLUME_SIZE,
      cloudReachPc(cloud),
      (ready) => {
        if (stale()) return;
        this.coarseBake = ready;
        this.installNebulaVolume(viewpoint, orientation);
      },
    );
    if (coarse) this.coarseBake = coarse;
    if (lit) {
      const fine = requestNebulaVolume(cloud, NEBULA_VOLUME_SIZE, undefined, (ready) => {
        if (stale()) return;
        this.fineBake = ready;
        this.installNebulaVolume(viewpoint, orientation);
      });
      this.fineBake = fine;
    } else {
      this.fineBake = null;
    }
    if (coarse) this.installNebulaVolume(viewpoint, orientation);
  }

  private installNebulaVolume(viewpoint: GalacticPosition, orientation: Float32Array): void {
    const coarse = this.coarseBake;
    if (!coarse) return;
    if (this.nebulaVolume) {
      this.scene.remove(this.nebulaVolume.mesh);
      this.nebulaVolume.dispose();
    }
    const fine = this.fineBake && this.fineBake.seed === coarse.seed ? this.fineBake : null;
    this.nebulaVolume = new NebulaVolume(coarse, fine, viewpoint, orientation);
    this.scene.add(this.nebulaVolume.mesh);
    // The sprite stands for a volume that is now actually there. The
    // backdrop may not be up yet, so the seed is kept for it to read.
    this.volumeSuppressedSeed = coarse.seed;
    this.backdrop?.suppressNebula(coarse.seed);
  }

  /**
   * One slab of the sky, drawn where it will finally sit.
   *
   * Its own Points rather than a place in a growing buffer: the final
   * count is not known until the sweep ends, and a slab is a few
   * thousand stars that will be thrown away inside a minute. The draw
   * calls collect — a hundred at the worst — and all of them go the
   * moment the assembled field arrives to replace them with one.
   */
  private addSkyPreview(preview: SkyPreview): void {
    if (!this.skyPreviewFrame) return;
    const count = preview.brightness.length;
    if (count === 0) return;
    const positions = new Float32Array(count * 3);
    const luminosities = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const d = preview.distances[i];
      const [x, y, z] = rotateToScene(
        this.skyPreviewFrame,
        preview.dirs[i * 3] * d,
        preview.dirs[i * 3 + 1] * d,
        preview.dirs[i * 3 + 2] * d,
      );
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      luminosities[i] = preview.brightness[i] * d * d;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('starColor', new BufferAttribute(preview.colors, 3));
    geometry.setAttribute('luminosity', new BufferAttribute(luminosities, 1));
    geometry.setAttribute('aRadiusKm', new BufferAttribute(new Float32Array(count), 1));
    geometry.boundingSphere = new Sphere(new Vector3(), 1e13);
    const points = new Points(geometry, createStarPointsMaterial(PC_KM));
    points.frustumCulled = false;
    points.renderOrder = -2;
    this.skyPreview.push(points);
    this.pcGroup.add(points);
  }

  /** Drop the slabs: the assembled field draws all of them as one. */
  private clearSkyPreview(): void {
    for (const points of this.skyPreview) {
      this.pcGroup.remove(points);
      points.geometry.dispose();
      (points.material as ShaderMaterial).dispose();
    }
    this.skyPreview = [];
  }

  /**
   * Re-root the system pipeline on one of the system's stars: the
   * host's planets, belts, zone rings, and orbit lines are the only
   * system content rendered — the other stars stay as photospheres on
   * their stellar orbits until selected.
   */
  setHost(index: number): void {
    if (!this.system) return;
    const clamped = Math.max(0, Math.min(index, this.system.companions.length));
    if (clamped === this.hostIndex) return;
    this.clearHostContent();
    this.hostIndex = clamped;
    const system = this.system;
    const companion = clamped > 0 ? (system.companions[clamped - 1] ?? null) : null;
    const hostStar = companion ? companion.star : system.star;
    const planets = companion ? companion.planets : system.planets;
    const belts = companion ? companion.belts : system.belts;
    const zones = companion ? companion.zones : system.zones;
    const centralMassSolar = companion ? companion.star.mass : system.centralMassSolar;
    this.hostStar = hostStar;
    this.hostBelts = belts;
    this.hostSeedHex = companion ? companion.star.seedHex : system.seedHex;
    this.systemMu = muOf(G * centralMassSolar * SOLAR_MASS);
    this.beltCandidates = [];
    this.beltMeshCandidates = [];
    this.lastBeltMeshSelectionMs = -Infinity;
    this.beltCellSignature = '';
    this.beltPointEpochDays = Number.NaN;
    this.beltPointFocusAsteroid = null;

    const orbitExtent = planets.length
      ? Math.max(...planets.map((p) => p.elements.semiMajorAxis / AU))
      : companion
        ? 0.4
        : 1;
    const beltExtent = Math.max(0, ...belts.map((b) => b.outerAu));
    this.extentAu = Math.max(orbitExtent * 1.2, beltExtent * 1.1, 0.5);
    this.extentKm = this.extentAu * AU_KM;

    const starRgb = hostStar.linearRgb;
    this.planetNodes = planets.map((planet) => {
      const mu = companion ? companionPlanetMu(companion, planet) : planetMu(system, planet);
      const object = new PlanetObject(planet.physical, planet.rings, orbitDays(mu, planet));
      object.group.scale.setScalar(EARTH_RADIUS_KM);
      this.heliocentric.add(object.group);
      const marker = new Mesh(
        new SphereGeometry(1, 12, 6),
        new MeshBasicMaterial({ color: markerColor(planet.physical.appearance, starRgb) }),
      );
      this.heliocentric.add(marker);
      return {
        planet,
        object,
        marker,
        mu,
      };
    });

    for (const points of createBeltPointsForSystem(belts, this.hostSeedHex, hostStar.luminosity)) {
      const material = points.material as ShaderMaterial;
      material.uniforms.uSqrtCentralMass.value = Math.sqrt(centralMassSolar);
      // Point sizing was tuned for AU-unit view distances.
      material.uniforms.uPointScale.value = 40 * AU_KM;
      this.beltMaterials.push(material);
      this.auGroup.add(points);
    }
    // The comet reservoirs belong to the primary's system.
    if (!companion) {
      for (const comet of system.comets) {
        const object = new CometObject(comet, system.centralMassSolar);
        this.cometObjects.push(object);
        this.auGroup.add(object.group);
      }
    }

    this.zoneOverlay.add(createZoneRings(zones));
    for (const belt of belts) {
      this.zoneOverlay.add(createBeltAnnulus(belt.innerAu, belt.outerAu));
    }
    for (const planet of planets) {
      this.overlay.add(
        createOrbitLine(planet.elements, planet.inHabitableZone ? 0x5fdf97 : 0x8a97ab, 0.75),
      );
    }
    this.markDiagrams();
  }

  /**
   * The zone and orbit diagrams are annotations, not sky: they come out
   * of the scene pass and composite onto the finished image, so a
   * decal's strength is its own rather than borrowed from whatever
   * happens to lie behind it. Called wherever their contents change,
   * since the layer belongs to each object rather than to the group.
   */
  private markDiagrams(): void {
    markAsDiagram(this.overlay);
    markAsDiagram(this.zoneOverlay);
    markAsDiagram(this.stellarOrbits);
    if (this.moonOrbits) markAsDiagram(this.moonOrbits);
  }

  /** Tear down the host-scoped content (planets, belts, comets, chart lines). */
  private clearHostContent(): void {
    for (const node of this.planetNodes) {
      node.object.dispose();
      node.marker.geometry.dispose();
      (node.marker.material as MeshBasicMaterial).dispose();
      this.heliocentric.remove(node.object.group);
      this.heliocentric.remove(node.marker);
    }
    this.planetNodes = [];
    for (const comet of this.cometObjects) comet.dispose();
    this.cometObjects = [];
    this.beltMaterials = [];
    for (const child of [
      ...this.auGroup.children,
      ...this.overlay.children,
      ...this.zoneOverlay.children,
    ]) {
      child.parent?.remove(child);
      child.traverse((obj) => {
        if (obj instanceof Mesh || obj instanceof Line || obj instanceof Points) {
          obj.geometry.dispose();
          if (!Array.isArray(obj.material)) obj.material.dispose();
        }
      });
    }
    this.hostIndex = -1;
  }

  /** Rebuild focus-specific content and jump the camera to an arrival orbit. */
  setFocus(target: FocusTarget, preset: ScenePreset): void {
    if (!this.system) return;
    this.clearFocus();
    this.focus = target;
    // Numeric targets index the host's planets; past them, the notable
    // asteroids (the primary's belts only). Object targets name a moon
    // of one of those planets.
    // A cloud is a body here, not a place a body happens to sit in: the
    // camera measures its ride against the cloud's own reach, so
    // arriving means standing off the cloud rather than standing on a
    // star that is zoomed out until the cloud fits.
    if (target === 'cloud') {
      this.focusCloud = this.localCloud();
      this.focusPlanet = null;
      this.focusMoon = null;
      this.focusAsteroid = null;
      const reachPc = this.focusCloud ? cloudReachPc(this.focusCloud.cloud) : 40;
      // The volume follows the subject: whatever was chosen on arrival,
      // the focused cloud is the one that gets drawn.
      if (this.focusCloud && this.skyPreviewFrame) {
        this.requestVolumeFor(this.focusCloud.cloud, this.viewpointPc, this.skyPreviewFrame);
      }
      this.radiusKm = reachPc * PC_KM;
      // Distance from the cloud's centre, not height above an edge it
      // does not have: the ride runs from well outside the body down to
      // deep inside it without ever hitting a floor it cannot pass.
      this.minAltitudeKm = this.radiusKm * 0.02;
      this.altitudeKm = this.radiusKm * 2.2;
      this.arriveAtFocus(preset);
      return;
    }
    this.focusCloud = null;

    const hostPlanets = this.planetNodes.map((node) => node.planet);
    const planetCount = hostPlanets.length;
    const planetIndex =
      typeof target === 'object' ? target.planet : typeof target === 'number' ? target : -1;
    this.focusPlanet =
      planetIndex >= 0 && planetIndex < planetCount ? (hostPlanets[planetIndex] ?? null) : null;
    this.focusMoon =
      typeof target === 'object' && this.focusPlanet
        ? (this.focusPlanet.moons[target.moon] ?? null)
        : null;
    this.focusAsteroid =
      typeof target === 'number' && target >= planetCount && this.hostIndex === 0
        ? (this.asteroids[target - planetCount] ?? null)
        : null;

    if (this.focusPlanet && this.focusMoon) {
      // A moon focuses exactly like a planet — same terrain streamer,
      // same regimes — with its parent's system in the sky around it.
      this.radiusKm = this.focusMoon.physical.bulk.radiusEarth * EARTH_RADIUS_KM;
      this.minAltitudeKm = 0.05;
      this.altitudeKm = this.radiusKm * 2.2;
      this.applySolidBodyFocus(this.focusMoon.physical, null);
      this.buildMoons(this.focusPlanet);
    } else if (this.focusPlanet) {
      const planet = this.focusPlanet;
      const solid = !planet.physical.appearance.banding;
      this.radiusKm = planet.physical.bulk.radiusEarth * EARTH_RADIUS_KM;
      // Envelopes have no ground: keep clear of the cloud deck.
      this.minAltitudeKm = solid ? 0.05 : this.radiusKm * 0.05;
      this.altitudeKm = this.radiusKm * 2.2;

      if (solid) {
        this.applySolidBodyFocus(planet.physical, planet.rings);
      } else {
        // Gas envelope: the banded shader sphere carries the body, its
        // atmosphere limb, and its rings (all inside PlanetObject).
        // The focused envelope bakes its deck at full resolution.
        this.bodyObject = new PlanetObject(
          planet.physical,
          planet.rings,
          orbitDays(planetMu(this.system, planet), planet),
          1024,
        );
        this.bodyObject.group.scale.setScalar(EARTH_RADIUS_KM);
        this.scene.add(this.bodyObject.group);
      }
      this.buildMoons(planet);
    } else if (this.focusAsteroid) {
      this.applyAsteroidFocus(this.focusAsteroid);
    } else {
      const focusStar = this.hostStar ?? this.system.star;
      this.radiusKm = Math.max(focusStar.radius, 1e-4) * SOLAR_RADIUS_KM;
      this.minAltitudeKm = this.radiusKm * 0.3;
      this.altitudeKm =
        preset === 'system'
          ? this.extentKm
          : preset === 'galaxy'
            ? this.galaxyArrivalAltitudeKm()
            : this.radiusKm * 3.2;
    }

    this.arriveAtFocus(preset);
  }

  /**
   * The cloud the camera is standing in, if any: the nearest whose own
   * field reaches the viewpoint. Lit or not — a dark rift is the same
   * kind of object as the nebula beside it, and just as much a place.
   */
  private localCloud(): FocusedCloud | null {
    let best: MolecularCloud | null = null;
    let bestDistance = Infinity;
    for (const cloud of cloudsNear(this.viewpointPc, NEBULA_HOME_REACH_PC)) {
      const dx = cloud.positionPc.xPc - this.viewpointPc.xPc;
      const dy = cloud.positionPc.yPc - this.viewpointPc.yPc;
      const dz = cloud.positionPc.zPc - this.viewpointPc.zPc;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > cloudReachPc(cloud) || distance >= bestDistance) continue;
      best = cloud;
      bestDistance = distance;
    }
    return best ? { cloud: best, nebula: nebulaFor(best) } : null;
  }

  /** The cloud the camera is standing off, for the panels that name it. */
  get focusedCloud(): FocusedCloud | null {
    return this.focusCloud;
  }

  /**
   * How far out to stand on arrival in the galaxy view. Normally a
   * neighbourhood hop, but arriving inside a molecular cloud the
   * subject is the cloud: stand off far enough to see all of it, the
   * way arriving at a system stands off far enough to see the system.
   */
  private galaxyArrivalAltitudeKm(): number {
    const local = this.localCloud();
    return local
      ? Math.max(GALAXY_ARRIVAL_ALTITUDE_KM, NEBULA_FRAMING_RADII * cloudReachPc(local.cloud) * PC_KM)
      : GALAXY_ARRIVAL_ALTITUDE_KM;
  }

  /** Focus-specific content for any solid terrain body — planet or moon:
   *  the streamed surface, its air and clouds, and the depth globe. */
  private applySolidBodyFocus(physical: Characterization, rings: RingSystem | null): void {
    // Deferred grid: the ~100k-sample climate/river survey would freeze
    // the UI for over a second — a terrain worker builds the identical
    // field anyway and ships the products back to attach here.
    const field = createSurfaceField(physical.seedHex, physical, { deferGrid: true });
    this.field = field;
    this.surveying = field.finishGrid !== undefined;
    this.oceanMaterial =
      this.field.params.magmaCoverage > 0
        ? createMagmaMaterial(physical.appearance.oceanColor, planetSeedOffset(physical.seedHex))
        : createOceanMaterial(physical.appearance.oceanColor);
    this.chunkManager = new TerrainChunkManager(
      this.scene,
      this.terrainMaterial,
      this.oceanMaterial,
      this.scatterMaterial,
      { type: 'init', seedHex: physical.seedHex, physical },
      this.radiusKm,
      this.field.params.biosphere
        ? deriveTreeSpecies(this.field.params).map(createTreeGeometry)
        : [],
      (survey) => {
        if (this.field === field) {
          field.finishGrid?.(survey);
          this.surveying = false;
        }
      },
    );
    if (physical.atmosphere.class !== 'none') {
      this.skyDome = createSkyDome(physical.atmosphere.scatteringColor);
      this.scene.add(this.skyDome);
    }
    this.atmosphereShell = createAtmosphereShell(physical, this.radiusKm);
    if (this.atmosphereShell) this.scene.add(this.atmosphereShell);
    this.cloudShell = createCloudShell(
      physical,
      this.radiusKm,
      this.field.seaLevelM / 1000,
      this.field.params.reliefM / 1000,
    );
    if (this.cloudShell) this.scene.add(this.cloudShell);
    if (rings) {
      this.ringMesh = createRingMesh(rings, this.radiusKm);
      this.ringMesh.rotation.x = -Math.PI / 2;
      this.scene.add(this.ringMesh);
    }
    // Depth-only globe: writes the body's depth even where terrain
    // isn't loaded, so sky objects eclipse per-fragment. Sized below
    // the deepest terrain — crater excavation included, or bowls dip
    // under it and render as black holes.
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
    // A planet's lit face looks at its own host sun.
    const hostPos =
      this.focusPlanet || this.focusAsteroid
        ? (this.stellarPositionsKm(seconds(this.simTimeDays * DAY))[
            Math.max(this.hostIndex, 0)
          ]?.clone() ?? new Vector3())
        : new Vector3();
    const toStar =
      this.focusPlanet || this.focusAsteroid
        ? hostPos.sub(focusPos).normalize()
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
    this.camera.position
      .copy(arrival)
      .multiplyScalar(this.focus === 'cloud' ? this.altitudeKm : this.radiusKm + this.altitudeKm);
    this.camera.up.set(0, 1, 0);
    // Any free-flight wandering ends here: the orbit re-anchors on the
    // new focus and pending ride input clears.
    this.controls.target.set(0, 0, 0);
    this.pendingWheelFactor = 1;
    this.stopRideOut();
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
  /** Sight-line test against a sphere: does cam→point pass inside it? */
  private static segmentHitsSphere(
    cam: Vector3,
    x: number,
    y: number,
    z: number,
    cx: number,
    cy: number,
    cz: number,
    r: number,
  ): boolean {
    const dx = x - cam.x;
    const dy = y - cam.y;
    const dz = z - cam.z;
    const lengthSq = dx * dx + dy * dy + dz * dz;
    if (lengthSq < 1) return false;
    const ox = cam.x - cx;
    const oy = cam.y - cy;
    const oz = cam.z - cz;
    // Closest approach of the segment to the sphere's center.
    const t = Math.max(0, Math.min(1, -(ox * dx + oy * dy + oz * dz) / lengthSq));
    const px = ox + dx * t;
    const py = oy + dy * t;
    const pz = oz + dz * t;
    return t > 0 && t < 1 && px * px + py * py + pz * pz < r * r;
  }

  /** Whether any body disc — the focus at the origin, or a star,
   *  planet, or moon on its orbit — hides this point from the camera. */
  private occluded(x: number, y: number, z: number): boolean {
    const cam = this.camera.position;
    if (UnifiedViewer.segmentHitsSphere(cam, x, y, z, 0, 0, 0, this.radiusKm * 0.98)) {
      return true;
    }
    for (const body of this.occluders) {
      if (UnifiedViewer.segmentHitsSphere(cam, x, y, z, body.x, body.y, body.z, body.rKm * 0.98)) {
        return true;
      }
    }
    return false;
  }

  /** Begin the slow pull-back: a hands-free wheel ride from wherever
   *  the camera stands — a planet's ground included — out to the
   *  galaxy frame. Orbit drag still steers; the wheel, a travel, or a
   *  second press takes the ride back. */
  startRideOut(): void {
    if (this.rideOutRate > 0) return;
    this.rideOutRate = RIDE_OUT_DECADES_PER_SEC;
    this.onRideOutChange?.(true);
  }

  stopRideOut(): void {
    if (this.rideOutRate === 0) return;
    this.rideOutRate = 0;
    this.onRideOutChange?.(false);
  }

  get ridingOut(): boolean {
    return this.rideOutRate > 0;
  }

  /** Find the pickable nearest the cursor and drive the tooltip. */
  private updateHover(): void {
    // No probe means no projection work and, importantly, no layout read.
    if (!this.cursor || this.dragging || this.flight.active) {
      this.hovered = null;
      if (this.hoveredKey) {
        this.hoveredKey = '';
        this.tooltip.style.display = 'none';
        this.tooltipLine.setAttribute('visibility', 'hidden');
      }
      return;
    }
    // Every projection below reads the camera's world matrix, which the
    // renderer only refreshes later in the frame — so without this the
    // scan runs against where the camera was pointing last frame. Still,
    // that is invisible; turning your head, it is the whole hit radius,
    // and nothing in the sky can be reliably aimed at.
    this.camera.updateMatrixWorld();
    const width = this.hoverViewportWidth;
    const height = this.hoverViewportHeight;
    let best: Pickable | null = null;
    let softStarBest = false;
    // In flight the cursor is the head, not a probe.
    {
      const [cx, cy] = this.cursor;
      const v = new Vector3();
      // A fingertip covers more sky than a cursor point does.
      let bestPx = this.touchMode ? 44 : 26;
      const consider = (pickable: Pickable, bias: number): void => {
        v.set(pickable.x, pickable.y, pickable.z).project(this.camera);
        if (v.z > 1 || v.z < -1) return;
        const sx = (v.x * 0.5 + 0.5) * width;
        const sy = (-v.y * 0.5 + 0.5) * height;
        const d = Math.hypot(sx - cx, sy - cy) * bias;
        if (d >= bestPx) return;
        if (this.occluded(pickable.x, pickable.y, pickable.z)) return;
        bestPx = d;
        best = pickable;
      };
      for (const pickable of this.pickables) consider(pickable, 1);

      // Neighborhood stars: the point index reduces the full 3D field
      // to the narrow cone around the cursor before exact projection.
      if (this.neighborPoints && this.neighborPointIndex && this.system) {
        const positions = this.neighborPoints.geometry.getAttribute('position') as BufferAttribute;
        this.pcGroup.updateWorldMatrix(true, false);
        const matrix = this.pcGroup.matrixWorld;
        this.hoverPcInverse.copy(matrix).invert();
        this.hoverRayOrigin.copy(this.camera.position).applyMatrix4(this.hoverPcInverse);
        this.hoverRayDirection
          .set((cx / width) * 2 - 1, -(cy / height) * 2 + 1, 0.5)
          .unproject(this.camera)
          .sub(this.camera.position)
          .normalize()
          .transformDirection(this.hoverPcInverse);
        // Screen-space angular scale is greatest at the optical axis;
        // this bound is therefore conservative toward the viewport edge.
        const coneTangent =
          (2 * Math.tan((this.camera.fov * Math.PI) / 360) * STAR_SNAP_PX * 1.05) / height;
        const ray = this.hoverRayDirection;
        const origin = this.hoverRayOrigin;
        const nearby = this.neighborHoverCandidates;
        nearby.length = 0;
        this.neighborPointIndex.query(
          origin.x,
          origin.y,
          origin.z,
          ray.x,
          ray.y,
          ray.z,
          coneTangent,
          nearby,
        );
        let bestStar = -1;
        for (const i of nearby) {
          v.fromBufferAttribute(positions, i).applyMatrix4(matrix);
          const wx = v.x;
          const wy = v.y;
          const wz = v.z;
          v.applyMatrix4(this.camera.matrixWorldInverse);
          if (v.z >= 0) continue;
          v.applyMatrix4(this.camera.projectionMatrix);
          const sx = (v.x * 0.5 + 0.5) * width;
          const sy = (-v.y * 0.5 + 0.5) * height;
          const px = Math.hypot(sx - cx, sy - cy);
          if (px > STAR_SNAP_PX) continue;
          const d = px * 1.5;
          if (d >= bestPx) continue;
          if (this.occluded(wx, wy, wz)) continue;
          bestPx = d;
          bestStar = i;
          best = null;
        }
        // The far field: catalog stars with seeds of their own — any
        // glint in the sky identifies itself and can be traveled to.
        // They are true 3D points, mostly beyond the far plane (the
        // shader clamps their depth so they still draw), so the only
        // valid rejection is behind-the-camera — never the z range.
        if (this.skyData && this.farPoints && this.farPointIndex) {
          const sky = this.skyData;
          const farPositions = this.farPoints.geometry.getAttribute(
            'position',
          ) as BufferAttribute;
          const far = this.farHoverCandidates;
          far.length = 0;
          this.farPointIndex.query(
            origin.x,
            origin.y,
            origin.z,
            ray.x,
            ray.y,
            ray.z,
            coneTangent,
            far,
          );
          let bestFar = -1;
          for (const i of far) {
            v.fromBufferAttribute(farPositions, i).applyMatrix4(matrix);
            v.applyMatrix4(this.camera.matrixWorldInverse);
            if (v.z >= 0) continue;
            v.applyMatrix4(this.camera.projectionMatrix);
            const sx = (v.x * 0.5 + 0.5) * width;
            const sy = (-v.y * 0.5 + 0.5) * height;
            const px = Math.hypot(sx - cx, sy - cy);
            if (px > STAR_SNAP_PX) continue;
            const d = px * 1.45;
            if (d >= bestPx) continue;
            v.fromBufferAttribute(farPositions, i).applyMatrix4(matrix);
            if (this.occluded(v.x, v.y, v.z)) continue;
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
              softStarBest = false;
              const seedHex = seedToHex(starSeed);
              const starPc = {
                xPc: this.viewpointPc.xPc + sky.starDirs[s * 3] * distance,
                yPc: this.viewpointPc.yPc + sky.starDirs[s * 3 + 1] * distance,
                zPc: this.viewpointPc.zPc + sky.starDirs[s * 3 + 2] * distance,
              };
              const physical = starPhotometry(starSeed, starPc);
              const bayer = sky.bayerNames.get(starSeed);
              best = {
                ...position,
                name: starDesignation(starSeed, starPc, physical.luminosity),
                info: `${bayer ? `${bayer} · ` : ''}${spectralType(physical)} · ${fmt(distance, 3)} pc`,
                action: 'click to travel',
                target: { kind: 'neighbor', seedHex, positionPc: starPc },
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
              softStarBest = true;
            }
          }
        }

        if (bestStar >= 0 && this.neighborSeedHexes[bestStar]) {
          softStarBest = false;
          const seedHex = this.neighborSeedHexes[bestStar];
          const starPc = {
            xPc: this.neighborGalacticPc[bestStar * 3],
            yPc: this.neighborGalacticPc[bestStar * 3 + 1],
            zPc: this.neighborGalacticPc[bestStar * 3 + 2],
          };
          const physical = starPhotometry(seedFromHex(seedHex), starPc);
          const distancePc = Math.hypot(
            this.neighborPositionsPc[bestStar * 3],
            this.neighborPositionsPc[bestStar * 3 + 1],
            this.neighborPositionsPc[bestStar * 3 + 2],
          );
          v.fromBufferAttribute(positions, bestStar).applyMatrix4(matrix);
          const bayer = this.skyData?.bayerNames.get(seedFromHex(seedHex));
          best = {
            x: v.x,
            y: v.y,
            z: v.z,
            name: starDesignation(seedFromHex(seedHex), starPc, physical.luminosity),
            info: `${bayer ? `${bayer} · ` : ''}${spectralType(physical)} · ${fmt(distancePc)} pc`,
            action: 'click to travel',
            target: { kind: 'neighbor', seedHex, positionPc: starPc },
          };
        }
      }
    }

    // Nothing travelable under the cursor: the extended sky objects
    // get to introduce themselves. A nebula is its natal cloud lit up,
    // a rift is the same kind of cloud unlit — both carry the cloud's
    // name, the one its province is charted under. Containment-only
    // and behind every seeded star in priority, so the big patches
    // never steal a clickable hover — but an anonymous cluster member
    // yields to the named cloud it lights, keeping the nebula's face
    // hoverable, and stands only where no cloud claims the cursor.
    if (
      (!best || softStarBest) &&
      this.cursor &&
      !this.dragging &&
      // On foot the cursor is the head, not a probe — the same rule the
      // body scan above keeps. Left out here, a stale cursor from before
      // the pointer was captured went on naming clouds every frame.
      !this.flight.active &&
      this.skyData &&
      this.galaxyFade < 0.6
    ) {
      const fallback = best;
      best = null;
      const [cx, cy] = this.cursor;
      const sky = this.skyData;
      const ray = new Vector3(
        (cx / width) * 2 - 1,
        -(cy / height) * 2 + 1,
        0.5,
      )
        .unproject(this.camera)
        .sub(this.camera.position)
        .normalize();
      // A body disc under the cursor blocks the whole sky behind it:
      // test the sight line itself, out past everything in the scene.
      const beyond = this.camera.far * 40;
      const blocked = this.occluded(
        this.camera.position.x + ray.x * beyond,
        this.camera.position.y + ray.y * beyond,
        this.camera.position.z + ray.z * beyond,
      );
      const dir = new Vector3();
      let bestAngular = blocked ? -Infinity : Infinity;
      const consider = (
        patchDir: [number, number, number],
        angularRadius: number,
        seed: bigint,
        distancePc: number,
        kind: string,
        info: string,
        travelable: boolean,
      ): void => {
        if (angularRadius >= bestAngular) return;
        const [ox, oy, oz] = rotateToScene(sky.sceneFromGalaxy, ...patchDir);
        dir.set(ox, oy, oz).applyQuaternion(this.frameQuat);
        if (dir.dot(ray) < Math.cos(angularRadius)) return;
        bestAngular = angularRadius;
        const reach = this.camera.far * 0.25;
        // A cloud is a place, and its own gateway system is how you
        // stand in it — the same seed the gazetteer names it by, so
        // arriving somewhere and reading its name agree.
        const centre: GalacticPosition = {
          xPc: this.viewpointPc.xPc + patchDir[0] * distancePc,
          yPc: this.viewpointPc.yPc + patchDir[1] * distancePc,
          zPc: this.viewpointPc.zPc + patchDir[2] * distancePc,
        };
        best = {
          x: this.camera.position.x + dir.x * reach,
          y: this.camera.position.y + dir.y * reach,
          z: this.camera.position.z + dir.z * reach,
          name: `the ${sectorNameForSeed(seed)} ${kind}`,
          info: `${info} · ≈${fmt(distancePc, 3)} pc`,
          action: travelable ? 'click to travel' : null,
          target: travelable
            ? {
                kind: 'cloud',
                seedHex: seedToHex(deriveSeed(seed, 'gateway')),
                positionPc: centre,
              }
            : null,
        };
      };
      for (const nebula of sky.nebulae) {
        consider(
          nebula.dir,
          nebula.angularRadius,
          nebula.seed,
          nebula.distancePc,
          'Nebula',
          'molecular cloud lit by its newborn stars',
          true,
        );
      }
      for (const cloud of sky.darkClouds) {
        consider(
          cloud.dir,
          cloud.halfExtent,
          cloud.seed,
          cloud.distancePc,
          'Rift',
          'dark molecular cloud',
          true,
        );
      }
      if (!best) best = fallback;
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
      // A finger already spent its click naming the body, so the
      // prompt asks for the one that acts.
      const action =
        best.action && this.touchMode ? best.action.replace(/^click/, 'tap again') : best.action;
      this.tooltip.innerHTML = `
        <div class="tip-name">${best.name}</div>
        <div class="tip-info">${best.info}</div>
        ${action ? `<div class="tip-action">${action}</div>` : ''}
      `;
      this.tooltip.style.display = 'block';
      this.tooltipHeight = this.tooltip.offsetHeight;
    }
    const v = new Vector3(best.x, best.y, best.z).project(this.camera);
    const sx = (v.x * 0.5 + 0.5) * width;
    const sy = (-v.y * 0.5 + 0.5) * height;
    const boxX = Math.max(8, Math.min(width - 270, sx + 22));
    const boxY = Math.max(8, Math.min(height - 90, sy - 48));
    this.tooltip.style.left = `${boxX}px`;
    this.tooltip.style.top = `${boxY}px`;
    this.tooltipLine.setAttribute('visibility', 'visible');
    this.tooltipLine.setAttribute('x1', String(sx));
    this.tooltipLine.setAttribute('y1', String(sy));
    this.tooltipLine.setAttribute('x2', String(boxX + 4));
    this.tooltipLine.setAttribute('y2', String(boxY + this.tooltipHeight - 4));
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
  private updateBeltRegion(tSeconds: Seconds, focusPos: Vector3, hostPos: Vector3): void {
    const mesh = this.beltRockMesh;
    const points = this.beltRockPoints;
    if (!mesh || !points || !this.system) return;

    const frameInv = this.frameQuat.clone().invert();
    // Camera into the host's model frame (undo the ground frame, then
    // measure from the host star).
    const helio = this.camera.position
      .clone()
      .applyQuaternion(frameInv)
      .add(focusPos)
      .sub(hostPos);
    const mx = helio.x / AU_KM;
    const my = -helio.z / AU_KM;
    const rAu = Math.hypot(mx, my);
    const phi = Math.atan2(my, mx);

    const cells: Array<{ belt: number; band: number; sector: number }> = [];
    this.hostBelts.forEach((belt, beltIndex) => {
      if (
        rAu < belt.innerAu - BELT_REGION_REACH_AU ||
        rAu > belt.outerAu + BELT_REGION_REACH_AU
      ) return;
      const bands = beltBandCount(belt);
      const inner2 = belt.innerAu ** 2;
      const outer2 = belt.outerAu ** 2;
      const bandOf = (a: number): number =>
        Math.floor(((a * a - inner2) / (outer2 - inner2)) * bands);
      const b0 = Math.max(
        0,
        bandOf(Math.max(belt.innerAu, rAu - BELT_REGION_REACH_AU)),
      );
      const b1 = Math.min(
        bands - 1,
        bandOf(Math.min(belt.outerAu, rAu + BELT_REGION_REACH_AU)),
      );
      for (let band = b0; band <= b1; band++) {
        // Members now at the camera's azimuth started the epoch back
        // along their mean motion; eccentricity widens the window.
        const lambdaEpoch = phi - bandMeanMotion(belt, band, this.systemMu) * tSeconds;
        const center = Math.round((lambdaEpoch / (2 * Math.PI)) * BELT_SECTORS);
        const margin =
          1 +
          Math.ceil(
            ((0.3 + BELT_REGION_REACH_AU / Math.max(rAu, 0.2)) / (2 * Math.PI)) *
              BELT_SECTORS,
          );
        for (let ds = -margin; ds <= margin; ds++) {
          cells.push({ belt: beltIndex, band, sector: center + ds });
        }
      }
    });

    const signature = cells.map((c) => `${c.belt}:${c.band}:${c.sector}`).join('|');
    const cellsChanged = signature !== this.beltCellSignature;
    if (cellsChanged) {
      this.beltCellSignature = signature;
      // Instantiate the covered cells, then keep the nearest members —
      // a naive cap would truncate the region's far side.
      const drawn: Array<{ asteroid: Asteroid; distanceKm: number }> = [];
      for (const cell of cells) {
        const belt = this.hostBelts[cell.belt];
        const beltSeed = deriveSeed(seedFromHex(this.hostSeedHex), 'belt-region', cell.belt);
        for (const asteroid of beltCellAsteroids(beltSeed, belt, cell.band, cell.sector, 6)) {
          const state = elementsToState(asteroid.elements, this.systemMu, tSeconds);
          const posKm = toWorld(state.position).divideScalar(1000);
          const distanceKm = Math.hypot(
            posKm.x - helio.x,
            posKm.y - helio.y,
            posKm.z - helio.z,
          );
          if (distanceKm < BELT_REGION_REACH_AU * 1.4 * AU_KM) {
            drawn.push({ asteroid, distanceKm });
          }
        }
      }
      drawn.sort((a, b) => a.distanceKm - b.distanceKm);
      this.beltCandidates = drawn.slice(0, BELT_REGION_POINT_CAPACITY).map(({ asteroid }) => {
        const radiusKm = asteroid.diameterKm / 2;
        const axisRng = new Rng(deriveSeed(seedFromHex(asteroid.shape.noiseSeedHex), 'spin-axis'));
        const axisZ = axisRng.range(-1, 1);
        const axisAzimuth = axisRng.range(0, 2 * Math.PI);
        const planar = Math.sqrt(Math.max(0, 1 - axisZ * axisZ));
        // Reflected sunlight as a pseudo-luminosity for the glint shader.
        const starDistanceKm = (asteroid.elements.semiMajorAxis / AU) * AU_KM;
        const pseudoLum =
          (this.hostStar ?? this.system!.star).luminosity *
          (radiusKm / (2 * starDistanceKm)) ** 2 *
          asteroid.albedo *
          4;
        const designation = (this.hostStar ?? this.system!.star).designation;
        return {
          asteroid,
          spinAxis: new Vector3(planar * Math.cos(axisAzimuth), axisZ, planar * Math.sin(axisAzimuth)),
          radiusKm,
          pseudoLum,
          pickable: {
            x: 0,
            y: 0,
            z: 0,
            name: `${designation} A-${asteroid.shape.noiseSeedHex.slice(-4).toUpperCase()}`,
            info: `belt member · ${fmt(asteroid.diameterKm)} km · ${asteroid.taxonomy}-type`,
            action: 'click to visit',
            target: { kind: 'belt', asteroid },
          },
        };
      });
    }

    const [sr, sg, sb] = (this.hostStar ?? this.system.star).linearRgb;
    const pointDays = tSeconds / DAY;
    const beltFocusChanged = this.beltPointFocusAsteroid !== this.focusAsteroid;
    if (
      !Number.isFinite(this.beltPointEpochDays) ||
      beltFocusChanged ||
      Math.abs(pointDays - this.beltPointEpochDays) > BELT_POINT_REBASE_DAYS ||
      cellsChanged
    ) {
      this.refreshBeltRegionPoints(points, tSeconds);
    }
    updateBeltRegionPointFrame(
      points,
      pointDays - this.beltPointEpochDays,
      focusPos,
      hostPos,
      this.frameQuat,
      [sr, sg, sb],
    );

    const matrix = new Matrix4();
    const spinQuat = new Quaternion();
    const scale = new Vector3();
    let meshCount = 0;
    const picking = this.cursor !== null && !this.dragging && !this.flight.active;
    const nowMs = performance.now();
    const refreshMeshSelection =
      cellsChanged ||
      beltFocusChanged ||
      nowMs - this.lastBeltMeshSelectionMs >= 100;
    const movingCandidates =
      picking || refreshMeshSelection ? this.beltCandidates : this.beltMeshCandidates;
    if (refreshMeshSelection) {
      this.beltMeshCandidates = [];
      this.lastBeltMeshSelectionMs = nowMs;
    }

    for (const candidate of movingCandidates) {
      if (candidate.asteroid === this.focusAsteroid) continue;
      const state = elementsToState(candidate.asteroid.elements, this.systemMu, tSeconds);
      const pos = toWorld(state.position)
        .divideScalar(1000)
        .add(hostPos)
        .sub(focusPos)
        .applyQuaternion(this.frameQuat);
      const distanceKm = pos.distanceTo(this.camera.position);
      if (distanceKm > BELT_REGION_REACH_AU * AU_KM * 1.5) continue;

      if (picking) {
        candidate.pickable.x = pos.x;
        candidate.pickable.y = pos.y;
        candidate.pickable.z = pos.z;
        this.pickables.push(candidate.pickable);
      }
      if (meshCount < 320 && candidate.radiusKm / distanceKm > 4e-5) {
        if (refreshMeshSelection) this.beltMeshCandidates.push(candidate);
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
    if (meshCount > 0 || mesh.count > 0) mesh.instanceMatrix.needsUpdate = true;
    mesh.count = meshCount;
  }

  /** Rewrite orbit attributes only when the streamed population changes. */
  private refreshBeltRegionPoints(points: Points, tSeconds: Seconds): void {
    if (!this.system) return;
    const epochDays = tSeconds / DAY;
    let count = 0;
    for (const candidate of this.beltCandidates) {
      if (candidate.asteroid === this.focusAsteroid) continue;
      count = writeBeltRegionPoint(
        points,
        count,
        candidate.asteroid,
        this.systemMu,
        epochDays,
        candidate.pseudoLum,
        true,
        true,
      );
      if (count >= BELT_REGION_POINT_CAPACITY) break;
    }
    for (const notable of this.asteroids) {
      if (count >= BELT_REGION_POINT_CAPACITY) break;
      if (notable === this.focusAsteroid) continue;
      const radiusKm = notable.diameterKm / 2;
      const starDistanceKm = (notable.elements.semiMajorAxis / AU) * AU_KM;
      const pseudoLum =
        this.system.star.luminosity * (radiusKm / (2 * starDistanceKm)) ** 2 * notable.albedo * 4;
      count = writeBeltRegionPoint(
        points,
        count,
        notable,
        this.systemMu,
        epochDays,
        pseudoLum,
        false,
        false,
      );
    }
    finishBeltRegionPoints(points, count);
    this.beltPointEpochDays = epochDays;
    this.beltPointFocusAsteroid = this.focusAsteroid;
  }

  get exposure(): number {
    return this.pipeline.exposure;
  }

  set exposure(value: number) {
    this.pipeline.exposure = value;
  }

  dispose(): void {
    this.clearCore();
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

  /**
   * Strongest other-star light at a world position, relative to the
   * host star's flux there: direction written into `out`, color
   * premultiplied by the flux ratio. Null when nothing contributes —
   * single-star systems pay one cheap loop.
   */
  private otherSunAt(
    worldPos: Vector3,
    hostIndex: number,
    out: Vector3,
  ): [number, number, number] | null {
    if (!this.system || this.starNodes.length < 2) return null;
    const hostNode = this.starNodes[hostIndex];
    const hostStar =
      hostIndex === 0 ? this.system.star : this.system.companions[hostIndex - 1]?.star;
    if (!hostNode || !hostStar) return null;
    const hostFlux =
      hostStar.luminosity /
      Math.max(hostNode.object.group.position.distanceToSquared(worldPos), 1);
    let bestRatio = 0.004;
    let bestIndex = -1;
    for (let i = 0; i < this.starNodes.length; i++) {
      if (i === hostIndex) continue;
      const star = i === 0 ? this.system.star : this.system.companions[i - 1]?.star;
      if (!star) continue;
      const ratio =
        star.luminosity /
        Math.max(this.starNodes[i].object.group.position.distanceToSquared(worldPos), 1) /
        Math.max(hostFlux, 1e-30);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) return null;
    out.copy(this.starNodes[bestIndex].object.group.position).sub(worldPos).normalize();
    const scale = Math.min(bestRatio, 4);
    const star =
      bestIndex === 0 ? this.system.star : this.system.companions[bestIndex - 1].star;
    return [star.linearRgb[0] * scale, star.linearRgb[1] * scale, star.linearRgb[2] * scale];
  }

  private buildMoons(planet: Planet): void {
    if (!this.system) return;
    const starRgb = this.system.star.linearRgb;
    this.moonGroup = new Group();
    if (this.focusMoon) {
      // The parent planet hangs in the focused moon's sky, rings and
      // all, positioned each frame at its true planet-centric offset.
      // The parent fills a moon's sky: full-resolution deck.
      this.parentObject = new PlanetObject(
        planet.physical,
        planet.rings,
        orbitDays(planetMu(this.system!, planet), planet),
        1024,
      );
      this.parentObject.group.scale.setScalar(EARTH_RADIUS_KM);
      this.moonGroup.add(this.parentObject.group);
    }
    this.moonOrbits = new Group();
    this.moonGroup.add(this.moonOrbits);
    this.moons = planet.moons.map((moon) => {
        const object = new PlanetObject(moon.physical, null);
        object.group.scale.setScalar(EARTH_RADIUS_KM);
        this.moonGroup!.add(object.group);

        const points = orbitPath(moon.elements, 128).map((p) => toWorld(p).divideScalar(1000));
        this.moonOrbits!.add(
          new Line(
            new BufferGeometry().setFromPoints(points),
            new LineBasicMaterial({ color: 0x8b9cb8, transparent: true, opacity: 0.45 }),
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
    this.markDiagrams();
  }

  /**
   * Travel to the galaxy's own centre. There is no system here — the
   * hole is the only body, and the sky is the galaxy seen from the
   * inside of its own nucleus. The camera frames the accretion flow
   * from fifteen degrees above its plane, which is where the far side
   * of the flow comes up over the top of the shadow.
   */
  setCoreView(): void {
    this.clearFocus();
    this.clearCore();
    this.clearSystem();
    this.coreView = true;

    const nucleus = galacticNucleus();
    // The centre has no system to inherit a sky angle from, so it takes
    // the hole's own: spin axis up the scene's +Y. That lays the
    // accretion flow in the plane the orbit camera turns in, and keeps
    // camera.up at the value OrbitControls latched onto when it was
    // built — its orbit axis is fixed at construction and a later
    // camera.up only rolls the image out from under the drag.
    const frame = sceneFromUpAxis(nucleus.spinAxis);
    this.viewpointPc = GALACTIC_CENTRE;
    this.frameQuat.identity();
    this.heliocentric.quaternion.identity();
    this.heliocentric.position.set(0, 0, 0);

    this.galaxyVolume = new GalaxyVolume(GALACTIC_CENTRE, frame);
    this.galaxyVolume.meanLuminosity = meanPopulationLuminosity();
    this.scene.add(this.galaxyVolume.mesh);
    this.galaxyParticles = new GalaxyParticles(GALACTIC_CENTRE, frame, PC_KM);
    this.pcGroup.add(this.galaxyParticles.group);
    this.nuclearCluster = new NuclearCluster(GALACTIC_CENTRE, frame, PC_KM);
    this.pcGroup.add(this.nuclearCluster.group);

    const hole = new BlackHoleObject(nucleus, this.lut, frame);
    this.scene.add(hole.mesh);
    this.blackHole = hole;
    this.lensedSky = new LensedSky();
    hole.sky = this.lensedSky.target;
    this.skyCaptured = false;

    // The shadow is the body here: everything the camera does is
    // measured against the radius a distant eye actually sees. But the
    // flow is what sets where to stand — inside it there is no picture
    // to take, only a lit floor with a dark bump on it. Where to stand
    // is the bright part of the flow, not all of it: a torus is drawn
    // out to its own edge and standing clear of that would cost the
    // shadow two thirds of its size for gas that can hang off the
    // frame instead.
    this.radiusKm = nucleus.shadowRadiusM / 1000;
    this.minAltitudeKm = this.radiusKm * 0.35;
    const litFlowKm =
      framedFlowRadiusRg(nucleus.flow) * nucleus.gravitationalRadiusM * 1e-3;
    this.altitudeKm = litFlowKm * FLOW_STANDOFF - this.radiusKm;

    // Fifteen degrees above the flow: high enough that its far side
    // comes up over the top of the shadow, low enough to keep it.
    const lift = (15 * Math.PI) / 180;
    this.camera.position
      .set(Math.cos(lift), Math.sin(lift), 0)
      .multiplyScalar(this.radiusKm + this.altitudeKm);
    this.camera.up.set(0, 1, 0);
    this.controls.target.set(0, 0, 0);
    this.pendingWheelFactor = 1;
    this.stopRideOut();
    this.controls.update();
    this.headingRad = 0;
    this.pitchRad = 0;
    this.galaxyFade = 1;
    // Stopped down while standing in the cluster and back up on the way
    // out, so the galaxy seen from here at kiloparsec range is the same
    // galaxy the system views show. Leaving restores it outright: the
    // store sets the exposure again on load.
    this.exposureOutsideCore = this.exposure;
    this.exposure = CORE_EXPOSURE;
  }

  /** Whether the camera is at the galactic centre rather than a system. */
  get atCore(): boolean {
    return this.coreView;
  }

  private clearCore(): void {
    if (!this.coreView) return;
    this.coreView = false;
    this.lensedSky?.dispose();
    this.lensedSky = null;
    this.skyCaptured = false;
    if (this.blackHole) {
      this.scene.remove(this.blackHole.mesh);
      this.blackHole.dispose();
      this.blackHole = null;
    }
    this.camera.up.set(0, 1, 0);
  }

  /**
   * The core view's own frame: one point to orbit, one wheel ladder,
   * and the galaxy always on — the distance-from-a-system crossfade
   * that drives it everywhere else has nothing to measure here.
   */
  private frameCore(dtSeconds: number): void {
    this.controls.rotateSpeed = Math.min(
      1.2,
      Math.max(0.05, (0.9 * this.altitudeKm) / this.radiusKm),
    );
    this.controls.enabled = !this.multiTouched;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    if (this.rideOutRate > 0) {
      if (this.altitudeKm >= this.maxAltitudeKm() * 0.999) this.stopRideOut();
      else this.pendingWheelFactor *= 10 ** (this.rideOutRate * dtSeconds);
    }
    const up = this.camera.position.clone().normalize();
    const free = Math.max(this.camera.position.length() - this.radiusKm, this.minAltitudeKm);
    this.altitudeKm = Math.min(
      this.maxAltitudeKm(),
      Math.max(free * this.pendingWheelFactor, this.minAltitudeKm),
    );
    this.camera.position.copy(up).multiplyScalar(this.radiusKm + this.altitudeKm);
    this.pendingWheelFactor = 1;

    this.camera.near = Math.max(this.altitudeKm * 1e-4, 1);
    this.camera.far = Math.max(this.camera.position.length() * 2.5, NEIGHBOR_RADIUS_PC * PC_KM * 2.5);
    this.camera.updateProjectionMatrix();

    const identity = new Matrix3();
    const pixelsPerRadian =
      this.pipeline.renderer.domElement.clientHeight /
      (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    if (this.nuclearCluster) {
      this.nuclearCluster.intensity = 1;
      this.nuclearCluster.group.visible = true;
      const out = this.nuclearCluster.update(this.camera.position.length() / PC_KM);
      this.exposure = CORE_EXPOSURE + (this.exposureOutsideCore - CORE_EXPOSURE) * out;
    }
    // The particle galaxy is a statistical stand-in whose grains are
    // hundreds of parsecs wide: from inside the nucleus the camera
    // sits within its own sprites, so it only takes over once there is
    // room to see it as a galaxy. The cluster and the volume carry the
    // centre until then — which is also the honest picture, since the
    // disk beyond is a hundred magnitudes of dust away.
    const centrePc = this.camera.position.length() / PC_KM;
    const bodyFade = Math.min(1, Math.max(0, (centrePc - 200) / 1800));

    // The bent rays' background is the sky arriving at the hole, so it
    // is photographed from the hole — once, with the dome re-centred
    // there and the hole itself out of frame.
    if (this.lensedSky && this.blackHole && !this.skyCaptured) {
      this.skyCaptured = true;
      this.galaxyVolume?.update(ORIGIN, identity, PC_KM, 1, 1e15);
      this.galaxyParticles?.update(0, pixelsPerRadian);
      if (this.nuclearCluster) {
        this.nuclearCluster.sizeScale = this.lensedSky.pixelsPerRadian / pixelsPerRadian;
      }
      this.captureWithSkyAt(this.lensedSky, ORIGIN, [this.blackHole.mesh]);
      if (this.nuclearCluster) this.nuclearCluster.sizeScale = 1;
    }

    // Close in, every ray on screen is bent enough that the hole draws
    // the whole sky itself, out of the cube map — the dome's own march
    // would be paid for and then covered over. Only once it really is
    // covered over: the trace fades out across its last stretch, and a
    // camera further out than LENSING_SOLID_RG has frame edges where
    // that fade has begun. Switching the dome off there took the sky
    // away from under a half-transparent image of it and left the
    // outside of the frame black but for the brightest arcs.
    const holeCoversSky =
      this.blackHole !== null &&
      this.camera.position.length() < LENSING_SOLID_RG * this.blackHole.kmPerRg;
    this.galaxyVolume?.update(
      this.camera.position,
      identity,
      PC_KM,
      holeCoversSky ? 0 : 1,
      Math.min(this.camera.far * 0.3, 3e15),
    );
    this.galaxyParticles?.update(
      holeCoversSky ? 0 : bodyFade * bodyFade * (3 - 2 * bodyFade),
      pixelsPerRadian,
    );
    if (this.nuclearCluster) this.nuclearCluster.group.visible = !holeCoversSky;
    this.blackHole?.update(this.camera, ORIGIN, identity, 1, 1, this.simTimeDays * 86400);
    // The geodesics are traced into the hole's own target before the
    // scene is drawn; what the scene holds is only the result.
    this.blackHole?.render(this.pipeline.renderer);
  }

  /**
   * The other stars in the system, as things that could be feeding this
   * one. A hole is lit by whatever is close enough to lose material to
   * it, so every other star is offered with the separation between
   * them — the companion's own orbit for a hole at the primary, and the
   * same orbit read the other way for a hole that is the companion.
   */
  private holeAxis(system: StarSystem, index: number): [number, number, number] {
    const elements =
      index === 0 ? system.companions[0]?.elements : system.companions[index - 1]?.elements;
    if (!elements) return [0, 1, 0];
    const i = elements.inclination;
    const node = elements.longitudeOfAscendingNode;
    // Orbital normal in the model frame, carried into the world frame.
    const n = toWorld({
      x: Math.sin(i) * Math.sin(node),
      y: -Math.sin(i) * Math.cos(node),
      z: Math.cos(i),
    });
    return [n.x, n.y, n.z];
  }

  /**
   * Draw the hole standing at this star's place. The trace is only
   * worth anything from close in — a stellar shadow is some tens of
   * kilometres across, so from anywhere in the system it is far below a
   * pixel and the object fades itself out — and the sky it lenses is
   * captured at the hole, refreshed when the hole has moved far enough
   * for its own surroundings to have shifted behind it.
   */
  private updateStellarHole(node: StarNode, position: Vector3): void {
    const hole = node.hole;
    if (!hole || !node.holeSky) return;
    hole.update(this.camera, position, IDENTITY_MATRIX, 1, 1, this.simTimeDays * 86400);
    if (!hole.mesh.visible) return;
    const parallax = this.nearestStarSeparation(position);
    if (!node.capturedAt || node.capturedAt.distanceTo(position) > 0.02 * parallax) {
      node.capturedAt = position.clone();
      // A point sprite is sized in pixels, so drawn into a capture
      // coarser than the screen it comes back out of it fatter than the
      // same star beside it. Scale every sprite layer by the two
      // resolutions' ratio for the duration of the capture, the way the
      // nuclear cluster is scaled for the hole at the galaxy's centre.
      const screen =
        this.pipeline.renderer.domElement.clientHeight /
        (2 * Math.tan((this.camera.fov * Math.PI) / 360));
      const scale = node.holeSky.pixelsPerRadian / screen;
      this.scaleSprites(scale);
      this.captureWithSkyAt(node.holeSky, position, [hole.mesh]);
      this.scaleSprites(1);
    }
    hole.render(this.pipeline.renderer);
  }

  /** Set every point-sprite layer's size scale at once. */
  /**
   * Take a cube capture with the sky moved to where it is being
   * photographed from.
   *
   * The backdrop is a sphere of finite radius centred on the camera
   * every frame, because from the camera that is indistinguishable from
   * a sky at infinity. From anywhere else it is not. A capture taken at
   * a hole sixty thousand kilometres away sees that sphere from three
   * quarters of the way to its wall: the galaxy piles into one side of
   * the cube and smears off the other, and once the camera is further
   * from the hole than the sphere's own radius the hole is outside the
   * sky altogether and the capture comes back black. Which is what it
   * looked like — a crowded cream Milky Way everywhere on screen, and a
   * few streaks on nothing inside the lensing.
   *
   * Recentred for the capture and put back after, the sky the lensing
   * bends is the sky the eye is already looking at.
   */
  private captureWithSkyAt(sky: LensedSky, atWorldKm: Vector3, hidden: Mesh[]): void {
    const backdrop = this.backdrop?.group;
    const was = backdrop?.position.clone();
    backdrop?.position.copy(atWorldKm);
    sky.capture(this.pipeline.renderer, this.scene, atWorldKm, hidden);
    if (backdrop && was) backdrop.position.copy(was);
  }

  private scaleSprites(scale: number): void {
    this.scene.traverse((object) => {
      const material = (object as { material?: { uniforms?: Record<string, { value: unknown }> } })
        .material;
      const uniform = material?.uniforms?.uSizeScale;
      if (uniform) uniform.value = scale;
    });
  }

  /** Distance to the nearest other star, which is the scale on which
   *  the sky behind a moving hole actually shifts. */
  private nearestStarSeparation(position: Vector3): number {
    let best = Infinity;
    for (const other of this.starNodes) {
      const d = other.object.group.position.distanceTo(position);
      if (d > 1 && d < best) best = d;
    }
    return Number.isFinite(best) ? best : 1e9;
  }

  private clearFocus(): void {
    this.focusMoon = null;
    this.flight.stop();
    if (document.pointerLockElement) document.exitPointerLock();
    this.chunkManager?.dispose();
    this.chunkManager = null;
    this.oceanMaterial?.dispose();
    this.oceanMaterial = null;
    this.field = null;
    this.surveying = false;
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
      this.parentObject?.dispose();
      this.parentObject = null;
      for (const entry of this.moons) entry.object.dispose();
      this.moonGroup.traverse((obj) => {
        if (obj instanceof Line) {
          obj.geometry.dispose();
          if (!Array.isArray(obj.material)) obj.material.dispose();
        }
      });
      this.moonGroup = null;
      this.moonOrbits = null;
      this.moons = [];
    }
    this.focusPlanet = null;
    this.focusAsteroid = null;
  }

  /**
   * The stars around this one, as far out as the budget reaches.
   *
   * How far it reaches depends on how crowded it is here, so it is
   * worth having by itself rather than buried in the middle of setting
   * a system up.
   */
  private buildNeighborhood(): void {
    if (!this.system) return;
    if (this.neighborPoints) {
      this.pcGroup.remove(this.neighborPoints);
      this.neighborPoints.geometry.dispose();
      (this.neighborPoints.material as ShaderMaterial).dispose();
      this.neighborPoints = null;
      this.neighborPointIndex = null;
    }
    const hood = computeNeighborhood(seedFromHex(this.system.seedHex), this.viewpointPc);
    this.neighbors = hood.neighbors;
    this.neighborSeedHexes = hood.seedHexes;
    this.neighborPositionsPc = hood.positionsPc;
    this.neighborGalacticPc = hood.galacticPc;
    this.neighborPoints = createNeighborStars(hood, PC_KM);
    const positions = this.neighborPoints.geometry.getAttribute('position') as BufferAttribute;
    this.neighborPointIndex = new PointConeIndex(
      positions.array as ArrayLike<number>,
      positions.count,
    );
    this.pcGroup.add(this.neighborPoints);
  }

  private clearSystem(): void {
    // Whatever sky was still building was building for here, and here
    // is being left.
    cancelSkyBuilds();
    for (const node of this.starNodes) {
      if (node.hole) {
        this.scene.remove(node.hole.mesh);
        node.hole.dispose();
      }
      node.holeSky?.dispose();
    }
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
    // Host teardown must go through clearHostContent: it resets
    // hostIndex, and setHost's change guard trusts that — a stale
    // index here left the whole travel destination running on the
    // previous system's planets, belts, and host star.
    this.clearHostContent();
    for (const child of [...this.stellarOrbits.children]) {
      this.stellarOrbits.remove(child);
      if (child instanceof Line) {
        child.geometry.dispose();
        (child.material as LineBasicMaterial).dispose();
      }
    }
    if (this.neighborPoints) {
      this.pcGroup.remove(this.neighborPoints);
      this.neighborPoints.geometry.dispose();
      (this.neighborPoints.material as ShaderMaterial).dispose();
      this.neighborPoints = null;
      this.neighborPointIndex = null;
    }
    if (this.farPoints) {
      this.pcGroup.remove(this.farPoints);
      this.farPoints.geometry.dispose();
      (this.farPoints.material as ShaderMaterial).dispose();
      this.farPoints = null;
      this.farPointIndex = null;
    }
    this.neighbors = [];
    for (const child of [
      ...this.auGroup.children,
      ...this.overlay.children,
      ...this.zoneOverlay.children,
    ]) {
      child.parent?.remove(child);
      child.traverse((obj) => {
        if (obj instanceof Mesh || obj instanceof Points || obj instanceof Line) {
          obj.geometry.dispose();
          if (!Array.isArray(obj.material)) obj.material.dispose();
        }
      });
    }
    this.beltCandidates = [];
    this.beltMeshCandidates = [];
    this.lastBeltMeshSelectionMs = -Infinity;
    this.beltCellSignature = '';
    this.beltPointEpochDays = Number.NaN;
    this.beltPointFocusAsteroid = null;
    if (this.beltRockMesh) this.beltRockMesh.count = 0;
    this.beltRockPoints?.geometry.setDrawRange(0, 0);
    if (this.backdrop) {
      this.scene.remove(this.backdrop.group);
      this.backdrop.dispose();
      this.backdrop = null;
    }
    // Slabs of a sky nobody is standing under any more.
    this.clearSkyPreview();
    this.skyPreviewFrame = null;
    if (this.galaxyVolume) {
      this.scene.remove(this.galaxyVolume.mesh);
      this.galaxyVolume.dispose();
      this.galaxyVolume = null;
    }
    if (this.nebulaVolume) {
      this.scene.remove(this.nebulaVolume.mesh);
      this.nebulaVolume.dispose();
      this.nebulaVolume = null;
      setStarNebulaExtinction(null);
    }
    if (this.galaxyParticles) {
      this.pcGroup.remove(this.galaxyParticles.group);
      this.galaxyParticles.dispose();
      this.galaxyParticles = null;
    }
    if (this.nuclearCluster) {
      this.pcGroup.remove(this.nuclearCluster.group);
      this.nuclearCluster.dispose();
      this.nuclearCluster = null;
    }
    this.clusterFrame = null;
    if (this.landmarkMarkers) {
      this.pcGroup.remove(this.landmarkMarkers);
      this.landmarkMarkers.geometry.dispose();
      (this.landmarkMarkers.material as ShaderMaterial).dispose();
      this.landmarkMarkers = null;
    }
    this.landmarkList = null;
    this.landmarkScene = null;
    if (this.sectorChart) {
      this.pcGroup.remove(this.sectorChart.group);
      this.sectorChart.dispose();
      this.sectorChart = null;
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
      this.neighborPoints.visible = value > SKY_VISIBILITY_FLOOR;
    }
    if (this.farPoints) {
      (this.farPoints.material as ShaderMaterial).uniforms.uIntensity.value = value;
      this.farPoints.visible = value > SKY_VISIBILITY_FLOOR;
    }
    // Nothing at the centre reaches the disk in visible light; only a
    // camera lifted clear of the dust layer ever sees the cluster.
    if (this.nuclearCluster) {
      const clusterIntensity = value * this.coreTransmission;
      this.nuclearCluster.intensity = clusterIntensity;
      this.nuclearCluster.group.visible = clusterIntensity > SKY_VISIBILITY_FLOOR;
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
    if (!this.focusPlanet) {
      const positions = this.stellarPositionsKm(tSeconds);
      return positions[Math.max(this.hostIndex, 0)] ?? positions[0];
    }
    const node = this.planetNodes.find((candidate) => candidate.planet === this.focusPlanet);
    const mu = node ? node.mu : planetMu(this.system, this.focusPlanet);
    const { position } = elementsToState(this.focusPlanet.elements, mu, tSeconds);
    const planetPos = toWorld(position).divideScalar(1000);
    const hostPos = this.stellarPositionsKm(tSeconds)[Math.max(this.hostIndex, 0)];
    if (hostPos) planetPos.add(hostPos);
    const moonEntry = this.focusMoon
      ? this.moons.find((entry) => entry.moon === this.focusMoon)
      : null;
    if (moonEntry) {
      const moonState = elementsToState(moonEntry.moon.elements, moonEntry.mu, tSeconds);
      planetPos.add(toWorld(moonState.position).divideScalar(1000));
    }
    return planetPos;
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.hoverViewportWidth = Math.max(width, 1);
    this.hoverViewportHeight = Math.max(height, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.pipeline.setSize(width, height);
  }

  /** The focus body as the flyer's surface, when it has one to clamp to. */
  private flightSurface(): FlightSurface | null {
    const field = this.field;
    if (!field) return null;
    // The clamp low-passes the ground: bands finer than ~0.7 m
    // wavelength are texture to skim over, not terrain to bob across.
    const strideLodRad = 0.00035 / this.radiusKm;
    return {
      radiusKm: this.radiusKm,
      heightM: (u) => field.heightAt(u, strideLodRad),
      waterLevelM: (u) => field.waterLevelAt(u),
    };
  }

  /** One quiet line of guidance for the ground regime. */
  private updateRecenter(): void {
    if (!this.recenter) return;
    const panned = !this.flight.active && this.controls.target.lengthSq() >= 1;
    this.recenter.style.display = panned ? '' : 'none';
  }

  private updateWalkHint(): void {
    if (!this.walkHint) return;
    if (this.flyStick) {
      this.flyStick.style.display = this.flight.active && this.touchMode ? '' : 'none';
    }
    if (this.dragModeButton) {
      this.dragModeButton.style.display = this.touchMode && !this.flight.active ? '' : 'none';
      // Descending to the surface changes what both drags do.
      if (this.inSurfaceRegime() !== this.dragModeLooking) {
        this.dragModeLooking = this.inSurfaceRegime();
        this.paintDragMode();
      }
    }
    let text = '';
    if (this.flight.active) {
      text = this.touchMode
        ? 'drag to look · hold to fly · pinch out to leave'
        : document.pointerLockElement === this.pipeline.renderer.domElement
          ? 'w a s d fly · space rise · c dive · shift boost · scroll up to leave'
          : 'click to take the controls';
    } else if (this.field && this.altitudeKm <= this.minAltitudeKm * 1.02) {
      text = this.touchMode ? 'pinch in to fly' : 'scroll in to fly';
    }
    if (text !== this.walkHintText) {
      this.walkHintText = text;
      this.walkHint.textContent = text;
      this.walkHint.style.display = text ? 'block' : 'none';
    }
  }

  private frame(): void {
    if (this.disposed) return;
    const now = performance.now();
    const dtSeconds = Math.min((now - this.lastFrameMs) / 1000, 0.1);
    this.lastFrameMs = now;
    // OrbitControls decays its leftover motion once per frame, so a
    // fixed damping factor eases for three times as long at twenty
    // frames a second as at sixty — the glide outlasts the drag exactly
    // when the frame rate is already making things feel heavy. Convert
    // a time constant into this frame's factor instead: the ease lasts
    // the same fraction of a second whatever the rate, and collapses to
    // no ease at all once frames are slower than the constant itself.
    this.controls.dampingFactor = Math.min(1, 1 - Math.exp(-dtSeconds / ORBIT_EASE_SECONDS));
    this.simTimeDays += dtSeconds * this.timeScaleDaysPerSecond;

    if (this.coreView) {
      this.frameCore(dtSeconds);
    } else if (this.system) {
      this.controls.rotateSpeed = Math.min(
        1.2,
        Math.max(0.012, (1.4 * this.altitudeKm) / this.radiusKm),
      );
      // Orbit rotation yields to panning only where free flight applies;
      // descending into the surface regime restores the classic controls
      // and re-anchors the orbit (and the wheel ride) on the body. In
      // ground flight, the flight camera owns the position outright.
      const flying = this.flight.active;
      const freeFlight = this.freeFlightAvailable();
      this.syncControlsEnabled();
      if (!flying) {
        if (!freeFlight && this.controls.target.lengthSq() > 0) {
          this.controls.target.set(0, 0, 0);
        }
        this.controls.update();
      }

      let up = this.camera.position.clone().normalize();
      const terrainM = this.field ? this.field.heightAt(up) : 0;
      const waterM = this.field ? this.field.waterLevelAt(up) : -Infinity;
      const groundKm = this.field ? Math.max(terrainM, waterM) / 1000 : 0;
      // Asteroid shapes legitimately dip far below the datum sphere.
      const floorKm = this.focusAsteroid ? -this.radiusKm * 0.6 : -this.radiusKm * 0.01;
      // A cloud has no surface, so the ride measures the distance itself
    // rather than a height above one: the wheel scales it the whole way
    // in, from standing off the body to standing inside it, instead of
    // clamping a parsec-scale floor the camera cannot pass.
    const surfaceKm =
      this.focus === 'cloud' ? 0 : this.radiusKm + Math.max(groundKm, floorKm);
      // The wheel rides toward what the camera is anchored on: the focus
      // body's surface when the orbit target sits there (altitude scales,
      // buttery down to the ground), or the panned anchor when free
      // flight has moved it — zoom goes where you look, not back home.
      const anchor = this.controls.target;
      if (this.rideOutRate > 0) {
        if (this.altitudeKm >= this.maxAltitudeKm() * 0.999) {
          this.stopRideOut();
        } else {
          this.pendingWheelFactor *= 10 ** (this.rideOutRate * dtSeconds);
          // From a standstill near the ground the first push must clear
          // the flight camera's exit threshold whatever the frame rate.
          if (flying) {
            this.pendingWheelFactor = Math.max(this.pendingWheelFactor, 1.03);
          }
        }
      }
      if (flying) {
        if (this.pendingWheelFactor > 1.02) {
          // One notch out hands the camera back to the wheel ride,
          // which resumes from wherever the flight left it.
          this.flight.stop();
          if (document.pointerLockElement) document.exitPointerLock();
        }
        this.flight.update(dtSeconds, this.camera.position, this.headingRad, this.pitchRad);
        up = this.camera.position.clone().normalize();
        const flownKm = this.field
          ? Math.max(this.field.heightAt(up), this.field.waterLevelAt(up)) / 1000
          : 0;
        this.altitudeKm = Math.max(
          this.camera.position.length() - (this.radiusKm + Math.max(flownKm, floorKm)),
          0.0008,
        );
      } else if (anchor.lengthSq() < 1) {
        const freeAltitudeKm = Math.max(
          this.camera.position.length() - surfaceKm,
          this.minAltitudeKm,
        );
        this.altitudeKm = Math.min(
          this.maxAltitudeKm(),
          Math.max(freeAltitudeKm * this.pendingWheelFactor, this.minAltitudeKm),
        );
        this.camera.position.copy(up).multiplyScalar(surfaceKm + this.altitudeKm);
        // The wheel's floor is where the ground begins: one more notch
        // in hands the camera over to free flight, anywhere at all —
        // open ocean included, since a camera doesn't wade.
        if (
          this.field &&
          this.pendingWheelFactor < 0.999 &&
          freeAltitudeKm <= this.minAltitudeKm * 1.001
        ) {
          const surface = this.flightSurface();
          if (surface) this.flight.begin(surface);
        }
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

      // Nadir gaze from orbit tipping up into a steerable horizon gaze
      // near the ground. The tip is the only thing that blends: pitch
      // runs from straight down to wherever the head is aimed, and the
      // orientation is then built outright from the tangent frame.
      //
      // Interpolating whole orientations instead — from whatever pose
      // the orbit left, toward a look-at — cost both ends of the
      // control. The two poses differ by a rotation that grows with
      // heading, so behind the camera the interpolation became
      // ill-conditioned and the view swung tens of degrees for a
      // degree of input; and short of the ground the blend only ever
      // delivered a fraction of the aimed pitch, which is why the gaze
      // hit a ceiling well below straight up.
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
        const t = horizonBlend * horizonBlend * (3 - 2 * horizonBlend);
        // Descending tips the resting gaze from straight down to the
        // horizon; the aim rides on top of that and keeps its whole
        // range the whole way, so a head half way down can still look
        // at its own zenith. Screen-up swings with the gaze through the
        // same plane, so nadir carries the heading up the screen and
        // there is no orientation the basis degenerates at.
        const restPitch = -(Math.PI / 2) * (1 - t);
        // Straight down is where the orbit above is looking, so the
        // total has to be able to reach it. The aim is bounded short of
        // vertical on its own, at the input.
        const pitch = Math.max(
          -Math.PI / 2,
          Math.min(Math.PI / 2, restPitch + this.pitchRad),
        );
        const forward = heading
          .clone()
          .multiplyScalar(Math.cos(pitch))
          .addScaledVector(up, Math.sin(pitch));
        const screenUp = up
          .clone()
          .multiplyScalar(Math.cos(pitch))
          .addScaledVector(heading, -Math.sin(pitch));
        // Looking straight down, the heading is pure roll: it decides
        // nothing about where the camera points, only what lies up the
        // screen. The orbit above puts north up there, so the roll has
        // to arrive from north rather than start at the heading — or
        // entering the band spins the view by the whole heading, which
        // for a quarter turn is the ground going sideways.
        screenUp.applyAxisAngle(forward, -this.headingRad * (1 - t));
        const right = new Vector3().crossVectors(forward, screenUp);
        this.camera.quaternion.setFromRotationMatrix(
          new Matrix4().makeBasis(right, screenUp, forward.clone().negate()),
        );
      }

      // Near tracks altitude (nothing sits closer than the ground below,
      // and at interstellar heights the nearest star is parsecs away);
      // far always reaches the neighborhood — every object is at its
      // true position, so occlusion is plain depth testing. In ground
      // flight the floor drops to centimeters; mid-distance depth
      // precision costs are accepted until the S2 precision hardening.
      this.camera.near = flying
        ? Math.max(0.00006, this.altitudeKm * 0.1)
        : Math.max(0.006, Math.min(2000, this.altitudeKm * 0.15), this.altitudeKm * 1e-4);
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
      if (this.sectorChart) {
        // The flat chart surfaces as the camera leaves the neighborhood;
        // the constellation borders belong to the local sky and hand off
        // to it — one gesture, star map to province map.
        const chart = this.chartVisible
          ? Math.min(1, Math.max(0, (distancePc - 30) / 270))
          : 0;
        const eased = chart * chart * (3 - 2 * chart);
        this.sectorChart.opacity = eased;
        this.sectorChart.skyOpacity = this.chartVisible ? 1 - eased : 0;
        this.sectorChart.skyRadiusLimitPc = (this.camera.far / PC_KM) * 0.45;
        this.sectorChart.labelFade =
          1 - Math.min(1, Math.max(0, (distancePc - 3500) / 3500));
      }

      this.updateWorld(up);
      this.updateHover();
      this.resolveTap();
      this.updateWalkHint();
      this.updateRecenter();

      if (this.backdrop?.group.visible) {
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
        // The nebula is a body in the same galaxy, marched in the same
        // frame — it does not fade with the band, because unlike the
        // band it is an object standing at a place.
        this.nebulaVolume?.update(
          this.camera.position,
          worldToScene,
          PC_KM,
          Math.min(this.camera.far * 0.3, 3e15),
        );
        // Every star behind the cloud dims and reddens through it. The
        // depth buffer cannot say which stars those are — the points
        // are additive and write no depth — so each one asks the volume.
        setStarNebulaExtinction(
          this.nebulaVolume
            ? this.nebulaVolume.extinctionFor(
                new Matrix3().setFromMatrix4(this.camera.matrixWorld),
              )
            : null,
        );
        // The nuclear cluster's light comes through the same dust the
        // volume march extinguishes the band with.
        const kpc = this.galaxyVolume.cameraGalacticKpc;
        this.coreTransmission = Math.exp(
          -dustOpticalDepth(
            { xPc: kpc.x * 1000, yPc: kpc.y * 1000, zPc: kpc.z * 1000 },
            GALACTIC_CENTRE,
          ),
        );
        // Out of the dust at last: now the cluster is worth having.
        if (
          !this.nuclearCluster &&
          this.clusterFrame &&
          this.coreTransmission > SKY_VISIBILITY_FLOOR
        ) {
          this.nuclearCluster = new NuclearCluster(this.viewpointPc, this.clusterFrame, PC_KM);
          this.pcGroup.add(this.nuclearCluster.group);
        }
        this.nuclearCluster?.update(Math.hypot(kpc.x, kpc.y, kpc.z) * 1000);
      }
      this.galaxyParticles?.update(
        this.galaxyFade,
        this.pipeline.renderer.domElement.clientHeight /
          (2 * Math.tan((this.camera.fov * Math.PI) / 360)),
      );
      this.chunkManager?.update(this.camera.position, groundKm);
      // The diagrammatic overlays appear at map heights — capped by the
      // system extent, since 25 radii of a giant star can lie beyond
      // its own planets and the map would never surface — each family
      // behind its own user toggle.
      const mapHeight = this.altitudeKm > Math.min(this.radiusKm * 25, this.extentKm * 0.5);
      this.overlay.visible = mapHeight && this.orbitsVisible;
      this.stellarOrbits.visible = this.overlay.visible;
      this.zoneOverlay.visible = mapHeight && this.zonesVisible;
      if (this.moonOrbits) this.moonOrbits.visible = this.orbitsVisible;
    }

    this.pipeline.render();
    requestAnimationFrame(() => this.frame());
  }

  private updateWorld(up: Vector3): void {
    if (!this.system) return;
    this.pickables.length = 0;
    this.occluders.length = 0;
    const solid = this.field !== null;
    const tSeconds = seconds(this.simTimeDays * DAY);
    const yAxis = new Vector3(0, 1, 0);

    // At map altitudes the landmark complexes become chart targets:
    // hover names them, a click travels to their gateway system.
    if (this.landmarkMarkers) {
      this.landmarkMarkers.visible = this.markersVisible && this.galaxyFade > 0.3;
    }
    if (this.landmarkList && this.landmarkScene && this.galaxyFade > 0.3) {
      this.pcGroup.updateWorldMatrix(true, false);
      const toWorldM = this.pcGroup.matrixWorld;
      const world = new Vector3();
      for (let i = 0; i < this.landmarkList.length; i++) {
        const landmark = this.landmarkList[i];
        world
          .set(
            this.landmarkScene[i * 3],
            this.landmarkScene[i * 3 + 1],
            this.landmarkScene[i * 3 + 2],
          )
          .applyMatrix4(toWorldM);
        const distanceKpc =
          Math.hypot(
            landmark.positionPc.xPc - this.viewpointPc.xPc,
            landmark.positionPc.yPc - this.viewpointPc.yPc,
            landmark.positionPc.zPc - this.viewpointPc.zPc,
          ) / 1000;
        this.pickables.push({
          x: world.x,
          y: world.y,
          z: world.z,
          name: `${landmark.name} Complex`,
          info: `molecular complex · anchor of the ${landmark.sector} Sector · ${fmt(distanceKpc)} kpc`,
          action: 'click to travel',
          target: { kind: 'neighbor', seedHex: landmark.seedHex, positionPc: landmark.positionPc },
        });
      }
    }

    // Ground-fixed frame: the heliocentric world (stars, planets, belts,
    // sky) sweeps around a spinning solid focus; envelopes spin their
    // cloud bands instead (mesh rotation inside PlanetObject).
    const focusBody = this.focusMoon?.physical ?? this.focusPlanet?.physical;
    const spinPeriodHours = this.focusAsteroid?.spinPeriodHours ?? focusBody?.rotation.periodHours;
    // Negative: the body rotates prograde — the same sense it revolves,
    // and the same sense the envelope planets spin their bands — so the
    // solar day runs longer than the sidereal day and moons lag the
    // stars instead of outrunning them.
    const spin =
      solid && spinPeriodHours ? (-2 * Math.PI * 24 * this.simTimeDays) / spinPeriodHours : 0;
    // Terrain worlds put their spin axis on world Y, so their axial tilt
    // lives in the frame: the ecliptic leans by the obliquity. Envelope
    // focuses tilt the body instead (inside PlanetObject).
    const tilt = solid && focusBody ? focusBody.rotation.obliquityRad : 0;
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
      if (node.hole) this.updateStellarHole(node, node.object.group.position);
      spritePositions?.setXYZ(
        i,
        node.object.group.position.x,
        node.object.group.position.y,
        node.object.group.position.z,
      );
      const star = i === 0 ? this.system.star : this.system.companions[i - 1]?.star;
      if (star) {
        this.occluders.push({
          x: node.object.group.position.x,
          y: node.object.group.position.y,
          z: node.object.group.position.z,
          rKm: star.radius * SOLAR_RADIUS_KM,
        });
      }
      // Every star identifies itself except the one already filling
      // the screen as the focus.
      const focusedNode = this.focus === 'star' ? Math.max(this.hostIndex, 0) : -1;
      if (star && i !== focusedNode) {
        this.pickables.push({
          x: node.object.group.position.x,
          y: node.object.group.position.y,
          z: node.object.group.position.z,
          name: star.designation,
          info: `${star.spectralType} · ${i === 0 ? 'primary' : 'companion'}`,
          action: 'click for star view',
          target: i === 0 ? { kind: 'star' } : { kind: 'star', companion: i - 1 },
        });
      }
    }
    if (spritePositions) spritePositions.needsUpdate = true;
    // The selected host star lights its system: terrain, sky, moons,
    // and every planet node; any other star bright enough joins as the
    // second light. The chart groups ride the host's position.
    const hostIndex = Math.max(this.hostIndex, 0);
    const hostStar = this.hostStar ?? this.system.star;
    const hostWorld = this.starNodes[hostIndex]?.object.group.position ?? new Vector3();
    const hostPos = starPositions[hostIndex] ?? new Vector3();
    this.auGroup.position.copy(hostPos);
    this.overlay.position.copy(hostPos);
    this.zoneOverlay.position.copy(hostPos);
    this.starDistanceKm = Math.max(hostWorld.length(), this.radiusKm * 4);
    const sunDir =
      hostWorld.lengthSq() > 1 ? hostWorld.clone().normalize() : new Vector3(0, 0, 1);
    const angularRadius = (hostStar.radius * SOLAR_RADIUS_KM) / Math.max(this.starDistanceKm, 1);
    const lightColor = hostStar.linearRgb;
    const light2Dir = new Vector3(0, 0, 1);
    const light2Color = this.otherSunAt(ORIGIN, hostIndex, light2Dir);

    // Planets on their orbits. The focused one is rendered at the origin
    // by terrain or the envelope sphere, so its node hides; the rest are
    // true-scale spheres with adaptive markers once they fall subpixel.
    const node2Dir = new Vector3();
    for (let i = 0; i < this.planetNodes.length; i++) {
      const node = this.planetNodes[i];
      const isFocus =
        this.focus === i || (this.focusMoon !== null && node.planet === this.focusPlanet);
      node.object.group.visible = !isFocus;
      node.marker.visible = false;
      if (isFocus) continue;
      const state = elementsToState(node.planet.elements, node.mu, tSeconds);
      const positionKm = toWorld(state.position).divideScalar(1000).add(hostPos);
      node.object.group.position.copy(positionKm);
      const worldPos = toFocusWorld(positionKm);
      const lightDir = hostWorld.clone().sub(worldPos).normalize();
      const node2Color = this.otherSunAt(worldPos, hostIndex, node2Dir);
      node.object.update(this.simTimeDays, lightDir, lightColor, node2Dir, node2Color, this.pipeline.renderer);

      const cameraDistance = this.camera.position.distanceTo(worldPos);
      const bodyRadiusKm = node.planet.physical.bulk.radiusEarth * EARTH_RADIUS_KM;
      if (this.markersVisible && bodyRadiusKm / cameraDistance < 0.004) {
        node.marker.visible = true;
        node.marker.position.copy(positionKm);
        node.marker.scale.setScalar(cameraDistance * 0.0035);
      }
      const { climate, bulk } = node.planet.physical;
      this.occluders.push({ x: worldPos.x, y: worldPos.y, z: worldPos.z, rKm: bodyRadiusKm });
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
      material.uniforms.uTimeYears.value = foldShaderTime(this.simTimeDays / 365.25);
    }
    const cometHead = new Vector3();
    const radPerPixel =
      (this.camera.fov * Math.PI) /
      180 /
      Math.max(this.pipeline.renderer.domElement.clientHeight, 1);
    for (let i = 0; i < this.cometObjects.length; i++) {
      const comet = this.cometObjects[i];
      comet.update(tSeconds, this.camera.position, radPerPixel);
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
    this.updateBeltRegion(tSeconds, focusPos, hostPos);

    this.bodyObject?.update(this.simTimeDays, sunDir, lightColor, light2Dir, light2Color, this.pipeline.renderer);

    // Moons on their true orbits; the focus planet eclipses them. Their
    // group carries the ground frame's diurnal sweep — equatorial
    // content spins without the ecliptic's obliquity lean — so moons
    // rise and set over a fixed landscape like everything else in the
    // sky, lagging the stars by their own orbital rate.
    // With a moon focused, the whole moon system — parent planet
    // included — shifts by the focus moon's planet-centric position, so
    // the focus sits at the origin and everything else keeps its true
    // geometry. A tidally locked moon then holds its parent fixed in
    // the sky by construction.
    const focusEntry = this.focusMoon
      ? this.moons.find((entry) => entry.moon === this.focusMoon)
      : undefined;
    const groupShift = new Vector3();
    if (focusEntry) {
      const state = elementsToState(focusEntry.moon.elements, focusEntry.mu, tSeconds);
      groupShift.copy(toWorld(state.position)).divideScalar(1000).negate().applyAxisAngle(yAxis, spin);
    }
    if (this.moonGroup) {
      this.moonGroup.rotation.y = spin;
      this.moonGroup.position.copy(groupShift);
    }
    const parentIndex = this.planetNodes.findIndex((node) => node.planet === this.focusPlanet);
    const parentRadiusKm = this.focusPlanet
      ? this.focusPlanet.physical.bulk.radiusEarth * EARTH_RADIUS_KM
      : 0;
    const casters = focusEntry
      ? [
          { position: groupShift, radius: parentRadiusKm },
          { position: new Vector3(0, 0, 0), radius: this.radiusKm },
        ]
      : [{ position: new Vector3(0, 0, 0), radius: this.radiusKm }];
    const shineBodies: ShineBody[] = [];
    if (this.parentObject && this.focusPlanet) {
      this.parentObject.update(this.simTimeDays, sunDir, lightColor, light2Dir, light2Color, this.pipeline.renderer);
      shineBodies.push({
        positionKm: groupShift.clone(),
        radiusKm: parentRadiusKm,
        bondAlbedo: this.focusPlanet.physical.climate.bondAlbedo,
        tint: shineTint(this.focusPlanet.physical.appearance),
      });
      this.occluders.push({ x: groupShift.x, y: groupShift.y, z: groupShift.z, rKm: parentRadiusKm });
      this.pickables.push({
        x: groupShift.x,
        y: groupShift.y,
        z: groupShift.z,
        name: this.focusPlanet.name,
        info: `parent planet · ${fmt(parentRadiusKm)} km`,
        action: 'click to visit',
        target: { kind: 'planet', index: parentIndex },
      });
    }
    const moonWorld = new Vector3();
    const moonCasters: { position: Vector3; radius: number }[] = [];
    for (let j = 0; j < this.moons.length; j++) {
      const { moon, object, marker, mu } = this.moons[j];
      const isFocusMoon = moon === this.focusMoon;
      object.group.visible = !isFocusMoon;
      if (isFocusMoon) {
        marker.visible = false;
        continue;
      }
      const state = elementsToState(moon.elements, mu, tSeconds);
      object.group.position.copy(toWorld(state.position)).divideScalar(1000);
      moonWorld.copy(object.group.position).applyAxisAngle(yAxis, spin).add(groupShift);
      object.update(this.simTimeDays, sunDir, lightColor, light2Dir, light2Color,
        this.pipeline.renderer);
      object.setOccluders(casters, angularRadius);

      const cameraDistance = this.camera.position.distanceTo(moonWorld);
      const moonRadiusKm = moon.physical.bulk.radiusEarth * EARTH_RADIUS_KM;
      marker.visible = this.markersVisible && moonRadiusKm / cameraDistance < 0.004;
      marker.scale.setScalar((cameraDistance * 0.0045) / EARTH_RADIUS_KM);
      this.occluders.push({ x: moonWorld.x, y: moonWorld.y, z: moonWorld.z, rKm: moonRadiusKm });
      moonCasters.push({ position: moonWorld.clone(), radius: moonRadiusKm });
      shineBodies.push({
        positionKm: moonWorld.clone(),
        radiusKm: moonRadiusKm,
        bondAlbedo: moon.physical.climate.bondAlbedo,
        tint: shineTint(moon.physical.appearance),
      });
      this.pickables.push({
        x: moonWorld.x,
        y: moonWorld.y,
        z: moonWorld.z,
        name: moon.name,
        info: `moon · ${fmt(moonRadiusKm)} km${moon.tidalState !== 'dead' ? ` · ${moon.tidalState}` : ''}`,
        action: parentIndex >= 0 ? 'click to visit' : null,
        target: parentIndex >= 0 ? { kind: 'moon', planet: parentIndex, index: j } : null,
      });
    }

    // A focused envelope takes its own moons as eclipse casters, so
    // transit shadows crawl across the deck (they already darken the
    // moons the other way).
    if (this.bodyObject && moonCasters.length > 0) {
      this.bodyObject.setOccluders(moonCasters, angularRadius);
    }

    if (!focusBody) {
      this.setSkyIntensity(1);
      return;
    }
    const { atmosphere } = focusBody;
    const sunElevation = Math.max(0, sunDir.dot(up));

    // Reflected light joins the night: the brightest sunlit companion
    // body — a moon over its planet, the parent planet over its moon —
    // becomes the surface's second light. The flux ratio is physical
    // (a full Moon delivers ~2e-6 of sunlight); what the display adds
    // is a scotopic lift (ratio^0.2) fading in as the sun sets —
    // disclosed eye adaptation, not extra photons — so moonlight
    // shapes the night and vanishes into daylight as it should. The
    // exponent is calibrated so a bright gibbous renders near a tenth
    // of a day exposure — the brightness a dark-adapted eye reports.
    // Adaptation belongs to a ground observer: from altitude the day
    // limb fills the view and the eye stays light-adapted, so the lift
    // fades out well below orbit — otherwise the second light's
    // brightness visibly tracks the camera around the body.
    const grounded = Math.max(
      0,
      Math.min(1, (0.6 - this.altitudeKm / Math.max(this.radiusKm, 1)) / 0.4),
    );
    const nightness =
      (1 - Math.min(1, sunElevation / 0.03)) * grounded * grounded * (3 - 2 * grounded);
    let surf2Dir = light2Dir;
    let surf2Color = light2Color;
    let bestLum = surf2Color
      ? surf2Color[0] * 0.2126 + surf2Color[1] * 0.7152 + surf2Color[2] * 0.0722
      : 0;
    const sunAtBody = new Vector3();
    for (const body of shineBodies) {
      sunAtBody.copy(hostWorld).sub(body.positionKm).normalize();
      const ratio = reflectedFluxRatio(body, sunAtBody);
      if (ratio <= 0) continue;
      const scale = ratio + (ratio ** 0.2 - ratio) * nightness;
      const color: [number, number, number] = [
        lightColor[0] * body.tint[0] * scale,
        lightColor[1] * body.tint[1] * scale,
        lightColor[2] * body.tint[2] * scale,
      ];
      const lum = color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
      if (lum > bestLum) {
        bestLum = lum;
        surf2Dir = body.positionKm.clone().normalize();
        surf2Color = color;
      }
    }
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
      applySecondSun(material, surf2Dir, surf2Color);
    }
    if (this.cloudShell) {
      const material = this.cloudShell.material as ShaderMaterial;
      material.uniforms.uLightDir.value = [sunDir.x, sunDir.y, sunDir.z];
      material.uniforms.uLightColor.value.setRGB(...lightColor);
      material.uniforms.uTimeDays.value = foldShaderTime(this.simTimeDays);
      applySecondSun(material, surf2Dir, surf2Color);
    }
    if (this.ringMesh) {
      const material = this.ringMesh.material as ShaderMaterial;
      material.uniforms.uLightDir.value = [sunDir.x, sunDir.y, sunDir.z];
      material.uniforms.uLightColor.value.setRGB(...lightColor);
      applySecondSun(material, surf2Dir, surf2Color);
      applyOccluders(material, casters, angularRadius);
    }

    for (const material of [this.terrainMaterial, this.scatterMaterial, this.oceanMaterial]) {
      if (!material) continue;
      material.uniforms.uLightDir.value = [sunDir.x, sunDir.y, sunDir.z];
      material.uniforms.uLightColor.value.setRGB(...lightColor);
      applySecondSun(material, surf2Dir, surf2Color);
      material.uniforms.uFogColor.value.copy(fog);
      material.uniforms.uFogDensity.value = density;
      if (material.uniforms.uTimeDays) {
        material.uniforms.uTimeDays.value = foldShaderTime(this.simTimeDays);
      }
    }

    if (this.skyDome) {
      this.skyDome.position.copy(this.camera.position);
      const material = this.skyDome.material as ShaderMaterial;
      material.uniforms.uSunDir.value = [sunDir.x, sunDir.y, sunDir.z];
      material.uniforms.uUp.value = [up.x, up.y, up.z];
      material.uniforms.uLightColor.value.setRGB(...lightColor);
      applySecondSun(material, surf2Dir, surf2Color);
      // Sky radiance tracks optical depth: thin atmospheres barely glow.
      material.uniforms.uStrength.value =
        Math.exp(-this.altitudeKm / (10 * scaleHeightKm)) *
        Math.min(1, 3 * Math.sqrt(atmosphere.surfacePressureBar));
    }
  }
}
