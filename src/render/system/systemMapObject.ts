import {
  Color,
  Group,
  Line,
  Mesh,
  MeshBasicMaterial,
  Points,
  ShaderMaterial,
  SphereGeometry,
} from 'three';
import { elementsToState } from '../../core/math/kepler';
import { AU, DAY, G, SOLAR_MASS } from '../../core/physics/constants';
import type { Star } from '../../universe/star/types';
import { planetMu } from '../../universe/system/generate';
import type { Planet, StarSystem } from '../../universe/system/types';
import { createBeltPointsForSystem } from './beltPoints';
import { createOrbitLine } from './orbitLine';
import { createZoneRings } from './zoneRings';

const PLANET_CLASS_COLOR: Record<Planet['class'], number> = {
  rocky: 0xb98a63,
  'super-earth': 0xd4a373,
  'mini-neptune': 0x86b6d6,
  'ice-giant': 0x5fb0c9,
  'gas-giant': 0xd9b380,
};

const EARTH_RADIUS_AU = 4.26e-5;

interface OrbitingMesh {
  mesh: Mesh;
  planet: Planet;
  mu: number;
}

/**
 * Diagrammatic system map (1 unit = 1 AU): to-scale orbits, zone rings,
 * live planet markers, differentially shearing belts, and stellar
 * companions on their orbits. Marker sizes are legibility-scaled — true
 * scale rendering is the body viewers' job.
 */
export class SystemMapObject {
  readonly group = new Group();
  readonly extentAu: number;
  private readonly system: StarSystem;
  private readonly planetMeshes: OrbitingMesh[] = [];
  private readonly beltMaterials: ShaderMaterial[] = [];
  private readonly primaryGlyph: Mesh;
  private readonly companionGlyphs: Mesh[] = [];

  constructor(system: StarSystem) {
    this.system = system;
    // Model space is z-out-of-plane; the map lies in the ground plane.
    this.group.rotation.x = -Math.PI / 2;

    const orbitExtent = system.planets.length
      ? Math.max(...system.planets.map((p) => p.elements.semiMajorAxis / AU))
      : 1;
    const beltExtent = Math.max(0, ...system.belts.map((b) => b.outerAu));
    this.extentAu = Math.max(orbitExtent * 1.2, beltExtent * 1.1, 0.5);

    this.group.add(createZoneRings(system.zones));

    this.primaryGlyph = this.starGlyph(system.star);
    this.group.add(this.primaryGlyph);

    for (const companion of system.companions) {
      const inView = companion.elements.semiMajorAxis / AU < this.extentAu * 3;
      if (!inView) continue;
      this.group.add(createOrbitLine(companion.elements, 0x8888aa, 0.25));
      const glyph = this.starGlyph(companion.star);
      this.companionGlyphs.push(glyph);
      this.group.add(glyph);
    }

    for (const planet of system.planets) {
      const color = PLANET_CLASS_COLOR[planet.class];
      this.group.add(
        createOrbitLine(planet.elements, planet.inHabitableZone ? 0x4fbf7f : 0x6a7484, 0.45),
      );
      const markerAu = Math.max(
        planet.radiusEarth * EARTH_RADIUS_AU,
        0.004 + 0.016 * (planet.elements.semiMajorAxis / AU) ** 0.6,
      );
      const mesh = new Mesh(
        new SphereGeometry(1, 24, 12),
        new MeshBasicMaterial({ color: new Color(color) }),
      );
      mesh.scale.setScalar(markerAu);
      this.planetMeshes.push({ mesh, planet, mu: planetMu(system, planet) });
      this.group.add(mesh);
    }

    for (const points of createBeltPointsForSystem(system.belts, system.seedHex)) {
      const material = points.material as ShaderMaterial;
      material.uniforms.uSqrtCentralMass.value = Math.sqrt(system.centralMassSolar);
      this.beltMaterials.push(material);
      this.group.add(points);
    }
  }

  update(simTimeDays: number): void {
    const tSeconds = simTimeDays * DAY;

    for (const { mesh, planet, mu } of this.planetMeshes) {
      const { position } = elementsToState(planet.elements, mu, tSeconds);
      mesh.position.set(position.x / AU, position.y / AU, position.z / AU);
    }

    for (const material of this.beltMaterials) {
      material.uniforms.uTimeYears.value = simTimeDays / 365.25;
    }

    this.updateStellarPositions(tSeconds);
  }

  /**
   * Close pairs (p-type) orbit their barycenter at the origin; a wide
   * companion moves on its relative orbit around the primary.
   */
  private updateStellarPositions(tSeconds: number): void {
    const { system } = this;
    if (system.companions.length === 0) return;

    const closest = system.companions[0];
    const glyph = this.companionGlyphs[0];
    const pairMu = G * (system.star.mass + closest.star.mass) * SOLAR_MASS;
    const { position } = elementsToState(closest.elements, pairMu, tSeconds);

    if (system.configuration === 'p-type' && glyph) {
      const massFraction = closest.star.mass / (system.star.mass + closest.star.mass);
      this.primaryGlyph.position.set(
        (-position.x * massFraction) / AU,
        (-position.y * massFraction) / AU,
        (-position.z * massFraction) / AU,
      );
      glyph.position.set(
        (position.x * (1 - massFraction)) / AU,
        (position.y * (1 - massFraction)) / AU,
        (position.z * (1 - massFraction)) / AU,
      );
      return;
    }
    glyph?.position.set(position.x / AU, position.y / AU, position.z / AU);
  }

  private starGlyph(star: Star): Mesh {
    const [r, g, b] = star.linearRgb;
    const radiusAu = Math.max(star.radius * 0.00465, this.extentAu * 0.012);
    const mesh = new Mesh(
      new SphereGeometry(1, 32, 16),
      new MeshBasicMaterial({ color: new Color(r * 1.6, g * 1.6, b * 1.6) }),
    );
    mesh.scale.setScalar(radiusAu);
    return mesh;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof Mesh || obj instanceof Points || obj instanceof Line) {
        obj.geometry.dispose();
        const material = obj.material;
        if (!Array.isArray(material)) material.dispose();
      }
    });
  }
}
