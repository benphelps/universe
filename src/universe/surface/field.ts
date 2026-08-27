import type { Vec3 } from '../../core/math/vec3';
import { fbm, ridged } from '../../core/noise/fractal';
import { createSimplex3 } from '../../core/noise/simplex3';
import { createWorley3 } from '../../core/noise/worley3';
import { deriveSeed, seedFromHex } from '../../core/rng/hash';
import type { Characterization } from '../planet/types';
import { buildClimate, type ClimateField } from './climate';
import { createCraterField } from './craters';
import { createCubeGrid } from './cubeGrid';
import { buildDrainage, sampleCellHeights, type DrainageGraph } from './drainage';
import { deriveSurfaceParams, type SurfaceParams } from './params';

type Rgb = [number, number, number];

export interface SurfaceField {
  params: SurfaceParams;
  /**
   * Terrain height above the datum sphere, meters. lodAngularRad is the
   * caller's sample spacing: detail bands below its Nyquist limit are
   * skipped (they could only alias). Omit for full detail.
   */
  heightAt(dir: Vec3, lodAngularRad?: number): number;
  /** Linear-sRGB ground color; slopeCos = cos(angle from vertical). */
  colorAt(dir: Vec3, heightM: number, slopeCos: number, lodAngularRad?: number): Rgb;
  /** Sea surface height, meters above datum (−Infinity when dry). */
  seaLevelM: number;
  /**
   * Local water surface, meters above datum: the sea, a lake's fill
   * level, or a river's stage on its graded bed — −Infinity where the
   * ground is dry.
   */
  waterLevelAt(dir: Vec3, lodAngularRad?: number): number;
  /** The river network carving this world, on wet worlds. */
  drainage?: DrainageGraph | null;
  /** The climate field feeding it, on the same grid. */
  climate?: ClimateField | null;
}

interface DetailBand {
  frequency: number;
  octaves: number;
  amplitudeM: number;
  /** 0 = smooth fbm bumps; toward 1, crests sharpen along noise
   *  zero-sets into connected ridge-valley systems. */
  ridge: number;
}

/**
 * The whole solid surface as one pure function of direction, identical
 * at every level of detail. Layer stack: continents → plate-boundary
 * mountain belts (tectonic worlds) → volcanic provinces → detail
 * roughness (muted by erosion) → craters (age- and atmosphere-gated).
 * Sea level is solved so the flooded fraction matches the climate's
 * ocean coverage.
 */
export function createSurfaceField(
  seedHex: string,
  physical: Characterization,
  options?: { rivers?: boolean },
): SurfaceField {
  const params = deriveSurfaceParams(seedHex, physical);
  const seed = seedFromHex(seedHex);

  const continents = fbm(createSimplex3(deriveSeed(seed, 'continents')), { octaves: 4 });
  const mountains = ridged(createSimplex3(deriveSeed(seed, 'mountains')), { octaves: 5 });
  const detail = fbm(createSimplex3(deriveSeed(seed, 'detail')), { octaves: 5 });
  const bandNoise = createSimplex3(deriveSeed(seed, 'bands'));
  const provinces = fbm(createSimplex3(deriveSeed(seed, 'provinces')), { octaves: 3 });
  const boundaries = createWorley3(deriveSeed(seed, 'plates'));
  const craters = createCraterField(seedHex, params.radiusM, params.craterAmplitude);
  const moistureNoise = fbm(createSimplex3(deriveSeed(seed, 'moisture')), { octaves: 3 });
  const paletteNoise = fbm(createSimplex3(deriveSeed(seed, 'palette')), { octaves: 4 });
  const meander = createSimplex3(deriveSeed(seed, 'meanders'));
  const warpMacro = createSimplex3(deriveSeed(seed, 'warp-macro'));
  const warpMicro = createSimplex3(deriveSeed(seed, 'warp-micro'));
  const ravineRidge = ridged(createSimplex3(deriveSeed(seed, 'ravines')), { octaves: 2 });
  const glacialRidge = ridged(createSimplex3(deriveSeed(seed, 'glacial')), { octaves: 1 });
  const duneWarp = createSimplex3(deriveSeed(seed, 'dunes'));
  const ergNoise = fbm(createSimplex3(deriveSeed(seed, 'ergs')), { octaves: 2 });

  const { reliefM, tectonics, erosion, volcanism } = params;
  const mountainStrength = tectonics === 'active' ? 1 : tectonics === 'stagnant' ? 0.25 : 0.1;

  // Structured erosion regimes: rain carves dendritic valleys, ice
  // grinds wide smooth troughs, wind builds dune fields on dry worlds.
  const wetness = Math.min(1, params.oceanCoverage * 2.5 + (params.biosphere ? 0.4 : 0));
  // Nothing rains on a molten world, whatever its atmosphere carries.
  const fluvialStrength =
    erosion > 0.2 && !params.globalIce && params.magmaCoverage === 0
      ? erosion * (0.35 + 0.65 * wetness)
      : 0;
  const coldestK =
    params.surfaceMeanK - params.poleDeltaK - (params.lapseKPerKm * reliefM * 0.6) / 1000;
  const glacialStrength =
    erosion > 0.2 && (params.globalIce || coldestK < 268) ? erosion : 0;
  const duneStrength =
    erosion > 0.1 && !params.globalIce && params.oceanCoverage < 0.55
      ? (1 - 0.8 * wetness) * Math.min(1, erosion * 1.6)
      : 0;
  const windAngle =
    (Number(deriveSeed(seed, 'wind') & 0xffffn) / 0x10000) * 2 * Math.PI;
  const windX = Math.cos(windAngle);
  const windZ = Math.sin(windAngle);

  /** Windswept sand-sea regions: lowland patches on dry worlds. */
  const ergAt = (dir: Vec3, heightM: number): number => {
    if (duneStrength <= 0.02) return 0;
    const patch = smooth01((ergNoise(dir.x * 3.1, dir.y * 3.1, dir.z * 3.1) - 0.08) / 0.3);
    const lowland = smooth01((reliefM * 0.3 - heightM) / (reliefM * 0.25));
    return patch * lowland * duneStrength;
  };

  // Roughness cascade below the continental scale, from ~100 km
  // structure to ~20 cm ground texture. The falloff runs much flatter
  // than 1/f through the middle: Earth's feel lives in ridge-and-valley
  // relief at 100 m–25 km wavelengths (5–20% slopes), and a spectrum
  // tuned for orbital smoothness starves exactly that band. Erosion
  // damps it all; cratered dead worlds stay rugged. Bands from
  // FINE_BAND down are walked-scale texture and take the substrate.
  // Amplitudes sit at Earth-reference relief per wavelength (a steppe
  // reads ~1 m over 30 m, ~15 m over 800 m, ~50 m over 4 km — not the
  // crumpled exaggeration of a raised spectrum, and not the starved
  // 0.3% plains of a smooth one). Structure over size: the ridge blend
  // and the warps carry the character.
  const roughness = (1 - 0.72 * erosion) * (1 + 0.4 * params.craterAmplitude);

  // Mantling: every old surface is blanketed at short wavelengths by
  // some diffusive resurfacing process — impact-gardened regolith on
  // airless worlds, dust under thin atmospheres, tephra on volcanic
  // ones, creep on ice — so fine-scale relief is a property of the
  // mantle, not a fixed fraction of the mountain relief. Each band is
  // capped at the grade its wavelength can hold: bedrock repose at
  // long wavelengths, easing below the ~180 m gardening scale to the
  // mantled grade. Only young unmantled surfaces (fresh volcanic
  // flows, actively resurfacing airless crust) keep blocky fine
  // texture. Without this, low-erosion worlds run 50–5000% median
  // slopes at a 5 m step; the Moon's real figure is under 10%.
  // A molten surface is paved, not mantled: sheet flows flood and
  // re-flood every wavelength up to whole flow fields, so relief is
  // truncated at the sheet grade far beyond the gardening scale, and
  // only the newest flows keep blocky meter texture.
  const paved = tectonics === 'molten';
  const freshness = paved
    ? 0.25
    : Math.min(1, volcanism * 0.5 + (erosion < 0.2 && params.craterAmplitude < 0.15 ? 0.5 : 0));
  const mantledSlope = 0.1 + 0.35 * freshness;
  // Gyr of impact gardening relaxes relief out to basin scales — the
  // Moon's megaregolith runs kilometers deep, and highland slopes at
  // km baselines are 10–15%, not bedrock grades; barely-cratered young
  // surfaces are only softened at the outcrop scale. Even the long
  // wavelengths a gardened world keeps stand at degraded-front grades,
  // not fresh repose.
  const gardening = params.craterAmplitude * (1 - freshness);
  const bedrockSlope = 0.6 - 0.32 * gardening;
  const mantleWavelengthM = paved ? 4500 : 200 + 20000 * gardening;
  // The cap is on delivered grade, so the ridge transform's gradient
  // gain (1+ridge) and the extra slope of a band's internal octaves
  // divide out of the allowed amplitude.
  const bandCapM = (frequency: number, octaves: number, ridge: number): number => {
    const wavelengthM = (2 * Math.PI * params.radiusM) / frequency;
    const bedrock = wavelengthM ** 2 / (wavelengthM ** 2 + mantleWavelengthM ** 2);
    const capSlope = mantledSlope + (bedrockSlope - mantledSlope) * bedrock;
    return (capSlope * params.radiusM) / (frequency * (1 + ridge) * Math.sqrt(octaves));
  };
  const bandSpec: [frequency: number, octaves: number, coeff: number, ridge: number][] = [
    [45, 3, 0.062, 0.35],
    [280, 3, 0.048, 0.55],
    [1700, 2, 0.022, 0.6],
    [9000, 2, 0.0065, 0.6],
    [45000, 2, 0.002, 0.5],
    [240000, 2, 0.0005, 0.4],
    [1300000, 2, 0.0001, 0.25],
    [7000000, 2, 0.000032, 0.15],
    [30000000, 1, 0.00001, 0],
  ];
  const detailBands: DetailBand[] = bandSpec.map(([frequency, octaves, coeff, ridge]) => ({
    frequency,
    octaves,
    amplitudeM: Math.min(reliefM * coeff * roughness, bandCapM(frequency, octaves, ridge)),
    ridge,
  }));
  const FINE_BAND = 5;

  // Null while the structural surface is solved and sampled: the sea
  // level and the drainage build itself both see the uncarved world;
  // every later call gets the rivers.
  let drainage: DrainageGraph | null = null;
  let solvedSeaLevelM = -Infinity;
  // Meander-belt scale: a few km of course displacement on a ~half-cell
  // wavelength — bends within the valley corridor, never re-routing.
  const meanderAmpRad = 0.0008;
  const warped = { x: 0, y: 0, z: 0 };

  /** Meanders: the graph fixes topology and discharge; a seeded warp
   *  bends the straight cell-to-cell course at sub-cell scale. Fills
   *  the reused `warped` vector. */
  const warpDir = (dir: Vec3): Vec3 => {
    const wx = dir.x + meanderAmpRad * meander(dir.x * 130, dir.y * 130, dir.z * 130);
    const wy = dir.y + meanderAmpRad * meander(dir.x * 130 + 31.7, dir.y * 130, dir.z * 130);
    const wz = dir.z + meanderAmpRad * meander(dir.x * 130, dir.y * 130 + 57.3, dir.z * 130);
    const wl = Math.hypot(wx, wy, wz);
    warped.x = wx / wl;
    warped.y = wy / wl;
    warped.z = wz / wl;
    return warped;
  };

  /** Stream-power-flavored valley depth: grows with discharge, digs
   *  hardest in highlands, grades toward the sea near the coast. */
  const valleyDepthM = (hM: number, q: number): number => {
    const rel = 0.3 + 0.7 * smooth01(hM / (reliefM * 0.5));
    return Math.min(
      45 * q ** 0.25 * rel * (0.35 + 0.65 * fluvialStrength),
      (hM - solvedSeaLevelM) * 0.9 + 4,
    );
  };

  /** Total drop to the channel floor — the graph grades its beds with
   *  the same formula the carve uses, so the two always agree. */
  const channelDropM = (hM: number, q: number): number =>
    valleyDepthM(hM, q) + 1.5 * q ** 0.2;

  /** Valley + channel carved by the nearest river segment, meters (≤ 0). */
  const riverCarve = (dir: Vec3, h: number, lodAngularRad: number): number => {
    if (h <= solvedSeaLevelM || lodAngularRad > 0.012) return 0;
    const river = drainage!.nearestRiver(warpDir(dir));
    if (!river) return 0;
    const q = river.dischargeM3s;
    const halfWidthM = Math.min(25000, Math.max(220, 1200 * Math.sqrt(q / 1000)));
    const widthRad = halfWidthM / params.radiusM;
    const zoneRad = widthRad * 2.5;
    if (river.distRad >= zoneRad) return 0;
    const depthM = valleyDepthM(h, q);
    let carve = 0;
    if (river.distRad < widthRad) {
      // A valley narrower than the sample spacing fades like the detail
      // bands do — but as a line feature it surfaces at half a sample,
      // so continental rivers still trace from orbit.
      const fade = lodAngularRad > 0 ? Math.min(1, widthRad / lodAngularRad / 1.5) : 1;
      if (fade > 0.02) {
        const across = river.distRad / widthRad;
        carve -= depthM * (1 - across * across) ** 1.5 * fade;
        // The channel floor meets the graph's graded bed absolutely, so
        // the water that fills it steps downhill reach by reach instead
        // of stranding on local band noise.
        const channelRad = Math.max(6, 4 * Math.sqrt(q)) / params.radiusM;
        if (river.distRad < channelRad) {
          const chFade = lodAngularRad > 0 ? Math.min(1, channelRad / lodAngularRad / 1.5) : 1;
          const chAcross = river.distRad / channelRad;
          carve += (river.bedM - (h + carve)) * (1 - chAcross * chAcross) * chFade * fade;
        }
      }
    }
    // Gully networks on the valley flanks: ravines strengthen toward
    // the river and die at the divide shoulder — the sub-cell dendritic
    // texture the graph is too coarse to carry itself.
    const ravineFade =
      lodAngularRad > 0 ? Math.min(1, Math.max(0, 1 / 700 / (2 * lodAngularRad) - 1) / 4) : 1;
    if (ravineFade > 0.02) {
      const inner = smooth01((river.distRad - widthRad * 0.45) / (widthRad * 0.4));
      const outer = 1 - river.distRad / zoneRad;
      const flank = inner * outer;
      if (flank > 0.03) {
        const ridge = ravineRidge(dir.x * 700, dir.y * 700, dir.z * 700);
        const gully = smooth01((ridge - 0.68) / 0.22);
        if (gully > 0.01) {
          carve -= Math.min(50, depthM * 0.25) * flank * gully * ravineFade;
        }
      }
    }
    return carve;
  };

  const heightAt = (dir: Vec3, lodAngularRad = 0): number => {
    let h = continents(dir.x * 1.3, dir.y * 1.3, dir.z * 1.3) * reliefM * 0.55;

    if (mountainStrength > 0.05) {
      // Fold belts where cell boundaries pinch (f2 ≈ f1); each plate
      // also rides at its own elevation, so crossing a boundary steps —
      // the fault scarp is the discontinuity itself, degraded by
      // erosion, and belts often bury it under their own ridges.
      const cell = boundaries(dir.x * 1.6, dir.y * 1.6, dir.z * 1.6);
      h += (cell.id1 - 0.5) * reliefM * 0.09 * mountainStrength * (1 - 0.6 * erosion);
      const boundary = Math.max(0, 1 - (cell.f2 - cell.f1) / 0.22);
      if (boundary > 0) {
        const ridge = mountains(dir.x * 3.2, dir.y * 3.2, dir.z * 3.2);
        h += ridge * ridge * boundary * boundary * reliefM * 0.9 * mountainStrength;
      }
    }

    if (volcanism > 0.05) {
      const province = provinces(dir.x * 1.7, dir.y * 1.7, dir.z * 1.7);
      if (province > 0.25) {
        const dome = mountains(dir.x * 4.5, dir.y * 4.5, dir.z * 4.5);
        h += (province - 0.25) * dome * reliefM * 1.1 * volcanism;
      }
    }

    // Freeze mask from the pre-detail elevation: where the local mean
    // sits below freezing, ice smooths the fine relief and carves wide
    // troughs instead of river valleys.
    let glacial = 0;
    if (glacialStrength > 0.02) {
      const latitude = Math.asin(Math.max(-1, Math.min(1, dir.y)));
      const provisionalK =
        params.surfaceMeanK -
        params.poleDeltaK * Math.sin(latitude) ** 2 -
        (params.lapseKPerKm * Math.max(h, 0)) / 1000;
      glacial =
        glacialStrength * (params.globalIce ? 1 : smooth01((266 - provisionalK) / 9));
    }

    h += detail(dir.x * 7, dir.y * 7, dir.z * 7) * reliefM * 0.16 * (1 - 0.75 * erosion) *
      (1 - 0.55 * glacial);

    // Substrate under the fine bands: sand seas and sediment-filled
    // lowlands (and drowned floors) read smooth at walking scale, while
    // highlands and airless regolith keep their rubble texture.
    const erg = ergAt(dir, h);
    const lowland = smooth01((reliefM * 0.12 - h) / (reliefM * 0.12));
    const substrate = (1 - 0.85 * erg) * (1 - 0.7 * erosion * lowland);

    // The band domains shear through vector warp fields, so landforms
    // sweep and flow instead of sitting as isotropic bumps: a ~120 km
    // field bends the hill systems, a ~3 km field bends the walked
    // ground. Each activates only at LODs where its bands exist.
    let wax = dir.x;
    let way = dir.y;
    let waz = dir.z;
    if (lodAngularRad < 0.011) {
      wax += 0.004 * warpMacro(dir.x * 60, dir.y * 60, dir.z * 60);
      way += 0.004 * warpMacro(dir.x * 60 + 19.1, dir.y * 60, dir.z * 60);
      waz += 0.004 * warpMacro(dir.x * 60, dir.y * 60 + 47.3, dir.z * 60);
    }
    let wbx = dir.x;
    let wby = dir.y;
    let wbz = dir.z;
    if (lodAngularRad < 2.5e-6) {
      wbx += 1.2e-4 * warpMicro(dir.x * 2400, dir.y * 2400, dir.z * 2400);
      wby += 1.2e-4 * warpMicro(dir.x * 2400 + 7.7, dir.y * 2400, dir.z * 2400);
      wbz += 1.2e-4 * warpMicro(dir.x * 2400, dir.y * 2400 + 29.3, dir.z * 2400);
    }

    for (let bandIndex = 0; bandIndex < detailBands.length; bandIndex++) {
      const band = detailBands[bandIndex];
      // Fade each band in across a LOD level: a hard Nyquist cut would
      // print visible patches wherever neighboring tiles differ in level.
      // The landscape-scale band never fades: it moves coastlines, and
      // those must agree across every LOD. Smaller bands sit well inside
      // the shoreline blend window, so their fading is invisible there.
      let fade = 1;
      if (lodAngularRad > 0 && bandIndex > 0) {
        const wavelengthRatio = 1 / band.frequency / (2 * lodAngularRad);
        if (wavelengthRatio <= 1) break;
        // The geomorph absorbs LOD transitions, so detail can arrive
        // fast; this divisor sets how much of a band survives at the
        // finest level that can carry it at all.
        fade = Math.min(1, (wavelengthRatio - 1) / 2.5);
      }
      const offset = 17.31 * (bandIndex + 1);
      let amplitude = band.amplitudeM * fade * (1 - 0.5 * glacial);
      if (bandIndex >= FINE_BAND) amplitude *= substrate;
      const wx = bandIndex < FINE_BAND ? wax : wbx;
      const wy = bandIndex < FINE_BAND ? way : wby;
      const wz = bandIndex < FINE_BAND ? waz : wbz;
      let frequency = band.frequency;
      let sum = 0;
      for (let o = 0; o < band.octaves; o++) {
        const n = bandNoise(wx * frequency + offset, wy * frequency, wz * frequency);
        const shaped =
          band.ridge > 0 ? (1 - band.ridge) * n + band.ridge * (0.7 - 2 * Math.abs(n)) : n;
        sum += amplitude * shaped;
        amplitude *= 0.5;
        frequency *= 2.1;
      }
      h += sum;
    }

    // Dune fields: kilometer-scale transverse ripples across sand seas,
    // aligned to the world's prevailing wind.
    if (duneStrength > 0.02) {
      const duneFade =
        lodAngularRad > 0 ? Math.min(1, Math.max(0, 1 / 2400 / (2 * lodAngularRad) - 1) / 4) : 1;
      if (duneFade > 0) {
        if (erg > 0.02) {
          const phase =
            (dir.x * windX + dir.z * windZ) * 2400 +
            2.6 * duneWarp(dir.x * 90, dir.y * 90, dir.z * 90);
          // Draa-scale transverse dunes: tens of meters at km spacing.
          h += (22 + 50 * duneStrength) * Math.sin(phase) * erg * duneFade;
        }
      }
    }

    // Fluvial valleys belong to the drainage graph: every nearby river
    // segment carves its discharge-scaled valley and channel, yielding
    // to ice where the freeze mask takes hold.
    if (drainage) {
      const rain = 1 - (glacialStrength > 0 ? glacial / glacialStrength : 0);
      if (rain > 0.02) h += riverCarve(dir, h, lodAngularRad) * rain;
    }
    if (glacial > 0.02) {
      const trough = smooth01((glacialRidge(dir.x * 5, dir.y * 5, dir.z * 5) - 0.62) / 0.25);
      h -= trough * reliefM * 0.16 * glacial;
    }

    h += craters(dir, lodAngularRad);

    // Wave-worked shore: surf redistributes sediment into a flat beach
    // and shallow shoreface in a narrow band about sea level. Inactive
    // (−Infinity sea) until the level is solved, like the rivers.
    if (solvedSeaLevelM > -1e8) {
      const shoreRel = h - solvedSeaLevelM;
      if (shoreRel > -6 && shoreRel < 6) {
        h =
          solvedSeaLevelM +
          shoreRel * (0.4 + 0.6 * smooth01((Math.abs(shoreRel) - 2) / 4));
      }
    }
    return h;
  };

  // Magma seas flood through the same machinery as water: one solved
  // level, one liquid surface, one shoreline treatment.
  const seaLevelM = solveSeaLevel(
    heightAt,
    Math.max(params.oceanCoverage, params.magmaCoverage),
  );
  solvedSeaLevelM = seaLevelM;
  let climate: ClimateField | null = null;
  if (fluvialStrength > 0.02) {
    // Arid eroded worlds carve with their paleo-discharge: the erosion
    // parameter encodes the wet history that shaped them, even where
    // today's mean rainfall rounds to nothing.
    const carvingWetness = Math.max(wetness, 0.45 * fluvialStrength);
    const grid = createCubeGrid(128);
    const cellHeights = sampleCellHeights(grid, heightAt);
    const oceanMask = new Uint8Array(grid.cellCount);
    for (let cell = 0; cell < grid.cellCount; cell++) {
      if (cellHeights[cell] < seaLevelM) oceanMask[cell] = 1;
    }
    climate = buildClimate(
      grid,
      cellHeights,
      oceanMask,
      params.surfaceMeanK,
      params.poleDeltaK,
      params.lapseKPerKm,
      params.rotationPeriodHours,
      carvingWetness,
    );
    // Orbital-scale consumers skip the network build: at their sample
    // spacing every river is sub-texel, but the climate still places
    // the deserts.
    if (options?.rivers !== false) {
      drainage = buildDrainage(
        grid,
        cellHeights,
        oceanMask,
        climate.precipMmYr,
        params.radiusM,
        seaLevelM,
        channelDropM,
      );
    }
  }

  // Standing and flowing water: the sea, lake basins at their fill
  // levels, and river stages riding the graded beds. Paleo-carved dry
  // worlds keep their channels empty — today's rain fills nothing.
  const wetWorld = wetness > 0.05;
  const waterLevelAt = (dir: Vec3, lodAngularRad = 0): number => {
    let level = solvedSeaLevelM;
    if (drainage && wetWorld && lodAngularRad < 0.012) {
      const river = drainage.nearestRiver(warpDir(dir));
      if (river) {
        const halfWidthM = Math.min(
          25000,
          Math.max(220, 1200 * Math.sqrt(river.dischargeM3s / 1000)),
        );
        if (river.distRad < (halfWidthM / params.radiusM) * 1.2 && river.stageM > level) {
          level = river.stageM;
        }
      }
      const lake = drainage.lakeLevelAt(warped);
      if (lake > level) level = lake;
    }
    return level;
  };
  const sand: Rgb = [
    Math.min(1, params.palette.landB[0] * 1.25 + 0.08),
    Math.min(1, params.palette.landB[1] * 1.2 + 0.06),
    Math.min(1, params.palette.landB[2] * 1.1 + 0.04),
  ];
  const chilled: Rgb = [0.05, 0.042, 0.036];
  // Height-keyed color rules blend over windows wider than the detail
  // bands' LOD-dependent height swing, or coastlines flicker between levels.
  const shoreWindowM = Math.max(150, reliefM * 0.06);
  const strataThicknessM = 35 + 80 * (Number(deriveSeed(seed, 'strata') & 0xffn) / 255);

  const colorAt = (dir: Vec3, heightM: number, slopeCos: number, lodAngularRad = 0): Rgb => {
    const { palette } = params;
    const latitude = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    const temperatureK =
      params.surfaceMeanK -
      params.poleDeltaK * Math.sin(latitude) ** 2 -
      (params.lapseKPerKm * Math.max(heightM, 0)) / 1000;

    // Smooth land↔seabed transition centered on sea level. Under magma
    // seas the "bed" is chilled basalt — the melt above renders itself.
    const molten = params.magmaCoverage > 0;
    const submersion =
      params.oceanCoverage > 0 || molten
        ? smooth01((seaLevelM - heightM) / shoreWindowM + 0.5)
        : 0;
    if (submersion >= 1) {
      if (molten) return chilled;
      const depth = Math.min(1, Math.max(0, seaLevelM - heightM) / 600);
      return mixRgb(sand, palette.seabed, depth ** 0.6);
    }

    const blend = 0.5 + 0.5 * paletteNoise(dir.x * 5.5, dir.y * 5.5, dir.z * 5.5);
    let ground = mixRgb(palette.landA, palette.landB, blend);

    if (params.biosphere) {
      // Moisture from the climate field where one exists — rain shadows
      // and continental interiors read as the deserts they are — with
      // sub-cell noise texture; the plain noise stands in otherwise.
      const moisture = climate
        ? Math.min(1.1, 0.1 + climate.precipAt(dir) / 1500) +
          0.14 * moistureNoise(dir.x * 2.2, dir.y * 2.2, dir.z * 2.2)
        : 0.45 +
          0.4 * moistureNoise(dir.x * 2.2, dir.y * 2.2, dir.z * 2.2) +
          (params.oceanCoverage > 0 ? 0.1 : -0.2);
      // Continuous biome transitions: hard thresholds alias into blocky
      // borders at vertex resolution.
      const desertness =
        smooth01((temperatureK - 288) / 12) * smooth01((0.46 - moisture) / 0.12);
      ground = mixRgb(ground, sand, 0.75 * desertness);
      const bleakness = Math.max(
        smooth01((280 - temperatureK) / 10),
        smooth01((0.32 - moisture) / 0.08),
      );
      ground = mixRgb(ground, palette.rock, 0.5 * bleakness);
    }

    // Sand seas read as sand whatever the biome underneath.
    const erg = ergAt(dir, heightM);
    if (erg > 0.02) {
      ground = mixRgb(ground, sand, 0.6 * erg);
    }

    // Permanent ice fades in as the local mean drops below freezing.
    const iciness = params.globalIce ? 1 : smooth01((266 - temperatureK) / 8);
    if (iciness > 0) {
      const gray = 0.9 + 0.1 * paletteNoise(dir.x * 9, dir.y * 9, dir.z * 9);
      ground = mixRgb(
        ground,
        [palette.ice[0] * gray, palette.ice[1] * gray, palette.ice[2] * gray],
        iciness,
      );
    }

    // Bare rock breaks through on steep slopes — and the rock has a
    // history: volcanic provinces expose dark basalts, the rest shows
    // elevation-keyed sedimentary bedding in its cliff faces. Strata
    // fade out where vertex spacing would alias the bands to speckle.
    if (slopeCos < 0.82) {
      let rock = palette.rock;
      const province = provinces(dir.x * 1.7, dir.y * 1.7, dir.z * 1.7);
      if (province > 0.25) {
        rock = [rock[0] * 0.55, rock[1] * 0.55, rock[2] * 0.6];
      } else {
        const strataFade =
          lodAngularRad > 0 ? Math.max(0, 1 - lodAngularRad / 0.0002) : 1;
        if (strataFade > 0.02) {
          const bedding = Math.sin(
            (heightM / strataThicknessM) * 2 * Math.PI +
              2.5 * paletteNoise(dir.x * 13, dir.y * 13, dir.z * 13),
          );
          const tone = 1 + 0.13 * bedding * strataFade;
          rock = [rock[0] * tone, rock[1] * tone, rock[2] * tone];
        }
      }
      ground = mixRgb(rock, ground, Math.max(0, (slopeCos - 0.55) / 0.27));
    }
    if (params.oceanCoverage > 0) {
      ground = mixRgb(
        sand,
        ground,
        smooth01((heightM - seaLevelM) / shoreWindowM),
      );
    }
    if (submersion > 0) {
      const depth = Math.min(1, Math.max(0, seaLevelM - heightM) / 600);
      const bed = molten ? chilled : mixRgb(sand, palette.seabed, depth ** 0.6);
      ground = mixRgb(ground, bed, submersion);
    }
    return ground;
  };

  return { params, heightAt, colorAt, seaLevelM, waterLevelAt, drainage, climate };
}

/** Height whose flooded fraction matches coverage, via a golden-spiral sample. */
function solveSeaLevel(
  heightAt: (dir: Vec3, lodAngularRad?: number) => number,
  coverage: number,
): number {
  if (coverage <= 0) return -Infinity;
  const samples: number[] = [];
  const n = 1400;
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * 2.399963229728653;
    // Coarse LOD: sea level is set by continental structure, not meter bumps.
    samples.push(heightAt({ x: r * Math.cos(phi), y, z: r * Math.sin(phi) }, 0.002));
  }
  samples.sort((a, b) => a - b);
  const index = Math.min(n - 1, Math.floor(coverage * n));
  return samples[index];
}

/** Smoothstep of t clamped to [0, 1]. */
function smooth01(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * clamped,
    a[1] + (b[1] - a[1]) * clamped,
    a[2] + (b[2] - a[2]) * clamped,
  ];
}
