import {
  Group,
  Mesh,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
  type WebGLCubeRenderTarget,
  type WebGLRenderer,
} from 'three';
import { seedFromHex } from '../../core/rng/hash';
import { deriveCirculation, type Circulation } from '../../universe/planet/circulation';
import type { Characterization } from '../../universe/planet/types';
import type { RingSystem } from '../../universe/rings/types';
import { applySecondSun } from '../lighting/secondSun';
import { foldShaderTime } from '../shaderTime';
import { createAtmosphereShell } from './atmosphereShell';
import { createAuroraShells } from './auroraShell';
import { DeckBaker } from './deckBaker';
import { createGiantMaterial } from './giantMaterial';
import { createRingMesh, ringPatternSeed } from './ringMaterial';
import { applyOccluders, type ShadowCaster } from './shadows';
import { createSolidPlanetMaterial } from './solidPlanetMaterial';
import { requestSurfaceBake } from './surfaceBakeQueue';
import { uploadSurfaceCube } from './surfaceCube';

const UP = new Vector3(0, 1, 0);

/**
 * Renderable body at true shape (1 unit = 1 R⊕): banded envelope or solid
 * surface, oblateness, axial tilt, spin, atmosphere limb, and rings.
 * Works for planets and moons alike — both carry a Characterization.
 * Lighting comes from the star direction supplied each frame, so phases,
 * terminators, and eclipse shadows are exact.
 */
export class PlanetObject {
  readonly group = new Group();
  readonly radiusUnits: number;
  private readonly materials: ShaderMaterial[] = [];
  private readonly body: Mesh;
  private readonly spinRadPerDay: number;
  /** The derived atmosphere driving a giant's deck; null for solids. */
  private readonly circulation: Circulation | null;
  private readonly rings: RingSystem | null;
  private readonly ringMaterial: ShaderMaterial | null = null;
  private readonly baker: DeckBaker | null;
  private deckA: WebGLCubeRenderTarget | null = null;
  private deckB: WebGLCubeRenderTarget | null = null;
  /** A solid body's baked appearance, pending upload then resident. */
  private surfaceFaces: Uint8Array[] | null = null;
  private surfaceSize = 0;
  private surfaceCube: WebGLCubeRenderTarget | null = null;
  private bakedTA = 0;
  private bakedTB = 0;
  private baked = false;
  private lastSimT = Number.NEGATIVE_INFINITY;
  /** Seeded window stretch, so a system's giants roll on different frames. */
  private readonly bakeStagger: number;
  private readonly bakeIntervalDays: number;
  private readonly deckSize: number;

  constructor(
    readonly physical: Characterization,
    rings: RingSystem | null = null,
    orbitalPeriodDays?: number,
    deckSize = 256,
  ) {
    this.circulation = physical.appearance.banding
      ? deriveCirculation(physical, orbitalPeriodDays)
      : null;
    this.baker = this.circulation ? new DeckBaker(physical, this.circulation) : null;
    this.deckSize = deckSize;
    this.bakeStagger = 0.6 + 0.8 * (Number(seedFromHex(physical.seedHex) & 0xffn) / 255);
    // Rebake cadence: often enough that band drift between bakes stays
    // a fraction of a texel, and churn stays a gentle crossfade.
    if (this.circulation) {
      let maxDrift = 0.01;
      for (const band of this.circulation.bands) {
        maxDrift = Math.max(maxDrift, Math.abs(band.driftRadPerDay));
      }
      this.bakeIntervalDays = Math.min(
        Math.max(0.006 / maxDrift, 0.02),
        Math.max(0.3 / this.circulation.churnPerDay, 0.02),
        10,
      );
    } else {
      this.bakeIntervalDays = 1;
    }
    const material = this.circulation
      ? createGiantMaterial(physical, this.circulation)
      : createSolidPlanetMaterial(physical);
    this.materials.push(material);
    if (!this.circulation) {
      // The distant appearance comes from the body's real surface
      // field, baked in the background; the flat mineral placeholder
      // holds only until it lands. Prominent bodies (the deckSize the
      // viewer grants focused and parent objects) jump the queue.
      requestSurfaceBake(physical.seedHex, physical, 128, deckSize > 256).then((bake) => {
        this.surfaceFaces = bake.faces;
        this.surfaceSize = bake.size;
      });
    }

    this.radiusUnits = physical.bulk.radiusEarth;
    this.body = new Mesh(new SphereGeometry(1, 96, 64), material);
    this.body.scale.set(
      this.radiusUnits,
      this.radiusUnits * (1 - physical.bulk.oblateness),
      this.radiusUnits,
    );
    this.group.add(this.body);

    // The curtains ride the body mesh: they inherit its spin (the oval
    // is fixed in the magnetic frame) and its oblate squash.
    if (this.circulation) {
      for (const aurora of createAuroraShells(physical, this.circulation)) {
        this.materials.push(aurora.material as ShaderMaterial);
        this.body.add(aurora);
      }
    }

    const shell = createAtmosphereShell(physical, this.radiusUnits);
    if (shell) {
      this.materials.push(shell.material as ShaderMaterial);
      this.group.add(shell);
    }

    this.rings = rings;
    if (rings) {
      const ringMesh = createRingMesh(rings, this.radiusUnits);
      ringMesh.rotation.x = -Math.PI / 2;
      this.ringMaterial = ringMesh.material as ShaderMaterial;
      this.materials.push(this.ringMaterial);
      this.group.add(ringMesh);
    }

    this.group.rotation.z = physical.rotation.obliquityRad;
    this.spinRadPerDay = (2 * Math.PI * 24) / physical.rotation.periodHours;
  }

  /** Advance spin and update the star-light directions (world space, toward each star).
   *  Pass the renderer so a giant can (re)bake its deck cubemaps. */
  update(
    simTimeDays: number,
    lightDirWorld: Vector3,
    lightColor: [number, number, number],
    light2Dir: Vector3 | null = null,
    light2Color: readonly [number, number, number] | null = null,
    renderer?: WebGLRenderer,
  ): void {
    this.body.rotation.y = simTimeDays * this.spinRadPerDay;
    if (this.surfaceFaces && renderer) {
      this.surfaceCube = uploadSurfaceCube(renderer, this.surfaceFaces, this.surfaceSize);
      const material = this.materials[0];
      material.uniforms.uSurfaceCube.value = this.surfaceCube.texture;
      material.defines = { ...material.defines, HAS_SURFACE: '' };
      material.needsUpdate = true;
      this.surfaceFaces = null;
    }
    for (const material of this.materials) {
      const uniforms = material.uniforms;
      uniforms.uLightDir.value = [lightDirWorld.x, lightDirWorld.y, lightDirWorld.z];
      if (uniforms.uLightColor) uniforms.uLightColor.value.setRGB(...lightColor);
      if (uniforms.uTimeDays) uniforms.uTimeDays.value = foldShaderTime(simTimeDays);
      applySecondSun(material, light2Dir, light2Color);
    }
    if (this.circulation) this.updateAtmosphere(simTimeDays, lightDirWorld, renderer);
    if (this.rings) this.updateRingShadow();
  }

  /** Equatorial planet radius in world units (the group carries the
   *  scene's scale), as its own eclipse caster for the ring plane. */
  private selfCaster(): ShadowCaster {
    return {
      position: this.group.getWorldPosition(new Vector3()),
      radius: this.group.getWorldScale(new Vector3()).x * this.radiusUnits,
    };
  }

  /** The shadow band the rings cast on the body: world-frame plane and
   *  bounds refreshed each frame, sharing the ring's seeded density so
   *  gaps cross the deck as bright lanes; and the planet stands as an
   *  occluder over its own ring plane (setOccluders keeps it there
   *  when the viewer supplies moons as well). */
  private updateRingShadow(): void {
    const rings = this.rings!;
    const uniforms = this.materials[0].uniforms;
    const self = this.selfCaster();
    const ringNormal = new Vector3(0, 1, 0)
      .applyQuaternion(this.group.getWorldQuaternion(new Quaternion()));
    for (const material of this.materials) {
      if (material.uniforms.uRingNormal) material.uniforms.uRingNormal.value.copy(ringNormal);
    }
    (uniforms.uRingShadow.value as Vector4).set(
      rings.innerPlanetRadii * self.radius,
      rings.outerPlanetRadii * self.radius,
      rings.opticalDepth,
      1,
    );
    (uniforms.uRingCenter.value as Vector3).copy(self.position);
    uniforms.uRingSeed.value = ringPatternSeed(rings);
    const gaps = rings.gaps.slice(0, 6);
    uniforms.uRingGapCount.value = gaps.length;
    for (let i = 0; i < gaps.length; i++) {
      (uniforms.uRingGaps.value as Vector2[])[i].set(
        gaps[i].radiusPlanetRadii * self.radius,
        gaps[i].widthPlanetRadii * self.radius,
      );
    }
    applyOccluders(
      this.ringMaterial!,
      [self],
      this.ringMaterial!.uniforms.uStarAngularRadius.value as number,
    );
  }

  /** The deck: keep two bakes bracketing the sim time and crossfade
   *  between them — weather in motion at any time scale, with the
   *  pattern cost paid only when a bake rolls over. */
  private updateAtmosphere(
    simTimeDays: number,
    lightDirWorld: Vector3,
    renderer?: WebGLRenderer,
  ): void {
    const circulation = this.circulation!;
    const uniforms = this.materials[0].uniforms;

    const toObject = this.body.getWorldQuaternion(new Quaternion()).invert();
    const lightObj = lightDirWorld.clone().applyQuaternion(toObject).normalize();
    // Superrotation carries the hot point prograde of the substellar.
    const hotspot = lightObj
      .clone()
      .applyQuaternion(new Quaternion().setFromAxisAngle(UP, circulation.hotspotOffsetRad))
      .normalize();
    (uniforms.uHotspotDirObj.value as Vector3).copy(hotspot);

    if (!renderer || !this.baker) return;
    if (!this.deckA || !this.deckB) {
      this.deckA = DeckBaker.createTarget(this.deckSize);
      this.deckB = DeckBaker.createTarget(this.deckSize);
    }
    // Fast-forward outruns the base cadence: the window stretches to a
    // few frames of sim time, so the deck crossfades coarser instead
    // of restarting every giant's bake every frame — sustained
    // multi-megapixel rebakes stall the GPU into dropped frames.
    const step = Number.isFinite(this.lastSimT)
      ? Math.max(0, simTimeDays - this.lastSimT)
      : 0;
    this.lastSimT = simTimeDays;
    const interval = Math.max(this.bakeIntervalDays, step * 4) * this.bakeStagger;
    if (!this.baked || simTimeDays < this.bakedTA - interval) {
      // First frame, or time ran backwards past the window: bake both.
      this.bakedTA = simTimeDays;
      this.bakedTB = simTimeDays + interval;
      this.baker.bake(renderer, this.deckA, this.bakedTA, lightObj);
      this.baker.bake(renderer, this.deckB, this.bakedTB, lightObj);
      this.baked = true;
    } else if (simTimeDays >= this.bakedTB) {
      if (simTimeDays >= this.bakedTB + interval) {
        // Time leapt past the window: restart around the present.
        this.bakedTA = simTimeDays;
        this.bakedTB = simTimeDays + interval;
        this.baker.bake(renderer, this.deckA, this.bakedTA, lightObj);
        this.baker.bake(renderer, this.deckB, this.bakedTB, lightObj);
      } else {
        // Roll: the future bake becomes the present, bake a new future.
        const swap = this.deckA;
        this.deckA = this.deckB;
        this.deckB = swap;
        this.bakedTA = this.bakedTB;
        this.bakedTB = this.bakedTA + interval;
        this.baker.bake(renderer, this.deckB, this.bakedTB, lightObj);
      }
    }
    uniforms.uDeckA.value = this.deckA.texture;
    uniforms.uDeckB.value = this.deckB.texture;
    uniforms.uDeckMix.value = Math.min(
      1,
      Math.max(0, (simTimeDays - this.bakedTA) / (this.bakedTB - this.bakedTA)),
    );
  }

  /** Bodies that eclipse this one (world positions and radii in scene
   *  units). The ring material keeps the planet itself prepended, so
   *  the body's shadow always crosses its own ring plane. */
  setOccluders(occluders: ShadowCaster[], starAngularRadius: number): void {
    for (const material of this.materials) {
      if (material === this.ringMaterial) continue;
      applyOccluders(material, occluders, starAngularRadius);
    }
    if (this.ringMaterial) {
      applyOccluders(this.ringMaterial, [this.selfCaster(), ...occluders], starAngularRadius);
    }
  }

  dispose(): void {
    this.baker?.dispose();
    this.deckA?.dispose();
    this.deckB?.dispose();
    this.surfaceCube?.dispose();
    this.surfaceFaces = null;
    this.group.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry.dispose();
        if (!Array.isArray(obj.material)) obj.material.dispose();
      }
    });
  }
}
