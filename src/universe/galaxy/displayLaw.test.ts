import { describe, expect, it } from 'vitest';
import { cloudsNear } from './clouds';
import { DUST_OPACITY_PER_PC, HOME_POSITION } from './density';
import { dustScatterTable, sampleScatterTable, SCATTER_OPACITY_RGB } from './dustScattering';
import {
  DISPLAY_CEIL,
  DISPLAY_GAIN,
  DISPLAY_GAMMA,
  DISPLAY_PIVOT_LSUN_PC2,
  displayEnergy,
  displaySurfaceBrightness,
  radianceFromDisplay,
} from './displayLaw';
import { nebulaEmissionShare, nebulaFor, nebulaLightSolar, type Nebula } from './nebula';
import {
  bakeNebulaVolume,
  SCATTER_EMISSIVITY_PER_LSUN,
  type NebulaVolumeBake,
} from './nebulaVolume';
import {
  NEBULA_ATLAS_COLS,
  NEBULA_ATLAS_ROWS,
  NEBULA_TILE,
  renderNebulaTile,
} from './skyfield';

const luminance = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Lit nebulae near home, brightest ionizer first — the subjects the
 *  photometric pins reason about. */
function litNebulae(): Nebula[] {
  return cloudsNear(HOME_POSITION, 900)
    .map((cloud) => nebulaFor(cloud))
    .filter((nebula): nebula is Nebula => nebula !== null && nebula.photonRate > 0)
    .sort((a, b) => b.photonRate - a.photonRate);
}

describe('the display law', () => {
  it('is the star points law, exactly', () => {
    // The star shader compresses log irradiance as
    // 0.055·2^(0.36·(log₂E + 17)); the module must be that same curve,
    // or the tiers drift apart at the source.
    for (const brightness of [1e-7, 1e-4, 0.01, 1]) {
      const shader = 0.055 * 2 ** (0.36 * (Math.log2(brightness) + 17));
      expect(displayEnergy(brightness)).toBeCloseTo(shader, 10);
    }
    expect(displayEnergy(DISPLAY_PIVOT_LSUN_PC2)).toBeCloseTo(DISPLAY_GAIN, 12);
  });

  it('splits over a product, so display-space dimming is exact', () => {
    // display(B·T) = display(B)·T^γ — the property that lets the glow
    // shader dim its display energies by pow(transmission, γ) and the
    // volume cover the backdrop with 1 − T^γ without approximation.
    const brightness = 3.7e-4;
    for (const transmission of [0.9, 0.3, 0.004]) {
      expect(displayEnergy(brightness * transmission)).toBeCloseTo(
        displayEnergy(brightness) * transmission ** DISPLAY_GAMMA,
        10,
      );
    }
  });

  it('places the real sky where a sky-subtracted deep exposure would', () => {
    // Surface brightness in L☉ pc⁻² sr⁻¹ above the smooth sky, real
    // anchors: the pedestal itself (the pole sky's ~23.3 mag/arcsec²)
    // is subtracted to black; a skirt far beneath it vanishes rather
    // than being stretched into fog; the Milky Way band stands a few
    // units of contrast over it; the brightest nebular cores (Orion's
    // Huygens region, ~17.5 mag/arcsec²) run a couple of hundred and
    // keep their stature through the compression.
    expect(displaySurfaceBrightness(0)).toBe(0);
    expect(displaySurfaceBrightness(0.05)).toBeLessThan(0.002);
    const band = displaySurfaceBrightness(4);
    expect(band).toBeGreaterThan(0.035);
    expect(band).toBeLessThan(0.06);
    const orionCore = displaySurfaceBrightness(230);
    expect(orionCore).toBeGreaterThan(0.28);
    expect(orionCore).toBeLessThan(0.46);
    // And the ceiling holds against anything.
    expect(displaySurfaceBrightness(1e12)).toBe(DISPLAY_CEIL);
    // The decoder is the law's true inverse.
    for (const radiance of [0.2, 4, 230]) {
      expect(radianceFromDisplay(displaySurfaceBrightness(radiance))).toBeCloseTo(radiance, 6);
    }
  });
});

describe('sprite photometry', () => {
  it('closes the flux books over the tile', () => {
    // The impostor's shape is heuristic but its scale is a closure:
    // the tile's radiance channel times its calibrated peak, summed
    // over the sprite's solid angle, must return the cloud's whole
    // light budget — at any distance, and to numerical precision now
    // that the tile carries linear physics.
    const atlas = new Float32Array(
      NEBULA_ATLAS_COLS * NEBULA_TILE * NEBULA_ATLAS_ROWS * NEBULA_TILE * 4,
    );
    for (const nebula of litNebulae().slice(0, 8)) {
      const view: [number, number, number] = [0.6, 0.48, 0.64];
      const norm = Math.hypot(...view);
      const unit: [number, number, number] = [view[0] / norm, view[1] / norm, view[2] / norm];
      const { peakRadiance } = renderNebulaTile(atlas, 0, nebula.cloud, unit, nebula);

      const distance = nebula.cloud.radiusPc * 12;
      const extentPc = nebula.cloud.radiusPc * 1.6;
      const pixelSr = (2 * extentPc) / distance / NEBULA_TILE;
      let flux = 0;
      for (let j = 0; j < NEBULA_TILE; j++) {
        for (let i = 0; i < NEBULA_TILE; i++) {
          const at = (j * (NEBULA_ATLAS_COLS * NEBULA_TILE) + i) * 4;
          flux += atlas[at] * peakRadiance * pixelSr * pixelSr;
        }
      }
      const budget = nebulaLightSolar(nebula) / (4 * Math.PI * distance * distance);
      expect(flux / budget).toBeGreaterThan(0.995);
      expect(flux / budget).toBeLessThan(1.005);
    }
  });

  it('agrees with the volume it stands in for', () => {
    // The two renderings of one object spend the same budgets, and the
    // gap between what leaves the marched volume and the sprite's flux
    // closure is made of known physics: the impostor's fixed U reads
    // the line grid a factor from the marched grid's own hardness mix,
    // dust inside the box eats part of the lines, and the impostor's
    // 0.3 continuum interception is a whole-cloud number while the
    // bubble-scale box holds only part of the cloud's dust to scatter
    // with — even carrying every order of the table. Measured at ~0.14
    // on the brightest whole subject with multiple scattering in; the
    // pin holds the tiers within sight of each other.
    const nebula = litNebulae().find((candidate) => candidate.supernovae === 0);
    expect(nebula).toBeDefined();
    if (!nebula) return;
    const bake = bakeNebulaVolume(nebula.cloud, nebula, 64);

    const distance = bake.halfExtentsPc[0] * 8;
    const [r, g, b] = marchedFlux(bake, distance, dustScatterTable());
    const marched = luminance(r, g, b);
    const budget = nebulaLightSolar(nebula) / (4 * Math.PI * distance * distance);
    const ratio = marched / budget;
    expect(ratio).toBeGreaterThan(0.07);
    expect(ratio).toBeLessThan(0.4);
  });

  it('colours scattered light by the dust, not by paint', () => {
    // Reflection blue is a mechanism, not a palette entry: opacity
    // rises to the blue, so at the columns these clouds carry, more
    // blue than red is turned toward the camera — measured here as
    // the scattered light alone marching bluer than its grey twin,
    // over an illuminant that is already blue. (The same physics
    // reddens a source buried deep enough; the direction belongs to
    // the column.)
    const nebula = litNebulae().find((candidate) => candidate.supernovae === 0);
    expect(nebula).toBeDefined();
    if (!nebula) return;
    const bake = bakeNebulaVolume(nebula.cloud, nebula, 64);
    const table = dustScatterTable();
    const distance = bake.halfExtentsPc[0] * 8;
    const [greyR, , greyB] = marchedFlux(bake, distance, table, [1, 1, 1], false);
    const [r, , b] = marchedFlux(bake, distance, table, SCATTER_OPACITY_RGB, false);
    expect(greyB / greyR).toBeGreaterThan(2);
    expect(b / r).toBeGreaterThan((greyB / greyR) * 1.03);
  });
});

/**
 * The view march of render/galaxy/nebulaVolume's shader, in
 * TypeScript: rays over a tangent grid from a viewpoint on the box's
 * +x side, line emission and table-scattered starlight accumulating
 * under per-channel dust, summed to the flux the whole volume sends
 * the camera.
 */
function marchedFlux(
  bake: NebulaVolumeBake,
  distancePc: number,
  table: Float32Array,
  opacityRgb: readonly [number, number, number] = SCATTER_OPACITY_RGB,
  withEmission = true,
): [number, number, number] {
  const half = bake.halfExtentsPc[0];
  const scatterLum = bake.scatterLuminositySolar * SCATTER_EMISSIVITY_PER_LSUN;
  const [ratioR, , ratioB] = opacityRgb;
  const grid = 48;
  const span = half * 1.15;
  const cell = (2 * span) / grid;
  const flux: [number, number, number] = [0, 0, 0];
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const y = -span + (i + 0.5) * cell;
      const z = -span + (j + 0.5) * cell;
      const reach = Math.hypot(distancePc, y, z);
      const dir = [-distancePc / reach, y / reach, z / reach];
      // Box entry and exit for a ray from (d, 0, 0).
      let near = 0;
      let far = Infinity;
      const origin = [distancePc, 0, 0];
      for (let axis = 0; axis < 3; axis++) {
        const inv = 1 / dir[axis];
        const a = (-half - origin[axis]) * inv;
        const b = (half - origin[axis]) * inv;
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
      }
      if (far <= near) continue;
      const steps = 128;
      const ds = (far - near) / steps;
      const radiance = [0, 0, 0];
      const transmittance = [1, 1, 1];
      for (let s = 0; s < steps; s++) {
        const t = near + (s + 0.5) * ds;
        const p = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
        const index = cellIndex(p, half, bake.size);
        if (index < 0) continue;
        const dust = (bake.data[index * 4] / 255) * bake.dustRef;
        const ionized = (bake.data[index * 4 + 1] / 255) * bake.densityRef;
        const hardness = bake.data[index * 4 + 2] / 255;
        const shadow = bake.data[index * 4 + 3] / 255;
        const measure = withEmission ? ionized * ionized * bake.emissionCoefficient : 0;
        const shine = [
          p[0] - bake.scatterSourcePc[0],
          p[1] - bake.scatterSourcePc[1],
          p[2] - bake.scatterSourcePc[2],
        ];
        const r2 = Math.max(
          shine[0] ** 2 + shine[1] ** 2 + shine[2] ** 2,
          bake.scatterFloorPc2,
        );
        const mu = -(shine[0] * dir[0] + shine[1] * dir[1] + shine[2] * dir[2]) / Math.sqrt(r2);
        const tau = -Math.log(Math.max(shadow, 0.0038));
        const m = [
          ratioR * sampleScatterTable(table, tau * ratioR, mu),
          sampleScatterTable(table, tau, mu),
          ratioB * sampleScatterTable(table, tau * ratioB, mu),
        ];
        const scatter = (scatterLum * dust) / r2;
        for (let c = 0; c < 3; c++) {
          const emission =
            (bake.emissionCool[c] + (bake.emissionHot[c] - bake.emissionCool[c]) * hardness) *
            measure;
          radiance[c] += transmittance[c] * (emission + bake.reflectionColor[c] * m[c] * scatter) * ds;
        }
        const depth = dust * DUST_OPACITY_PER_PC * ds;
        transmittance[0] *= Math.exp(-depth * ratioR);
        transmittance[1] *= Math.exp(-depth);
        transmittance[2] *= Math.exp(-depth * ratioB);
        if (transmittance[1] < 2e-7) break;
      }
      // The tangent-plane pixel's solid angle from the viewpoint.
      const beam = (cell * cell * distancePc) / reach ** 3;
      for (let c = 0; c < 3; c++) flux[c] += radiance[c] * beam;
    }
  }
  return flux;
}

function cellIndex(p: number[], half: number, size: number): number {
  const i = Math.floor(((p[0] + half) / (2 * half)) * size);
  const j = Math.floor(((p[1] + half) / (2 * half)) * size);
  const k = Math.floor(((p[2] + half) / (2 * half)) * size);
  if (i < 0 || j < 0 || k < 0 || i >= size || j >= size || k >= size) return -1;
  return (k * size + j) * size + i;
}
