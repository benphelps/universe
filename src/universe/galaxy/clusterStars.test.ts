import { describe, expect, it, vi } from 'vitest';
import { evolve } from '../star/evolution';
import { opticalRgbInterpolator, rgbLuminance } from '../../core/color/optical';
import { buildNuclearClusterStars, nuclearClusterStars, NUCLEAR_POINT_COUNT } from './clusterStars';
import { nuclearStarCluster } from './spheroid';
import { galaxyNuclearStarCount } from './stellarMass';
import { nuclearEnclosedFraction, nuclearMeanStellarMass, NUCLEAR_EPOCHS, NUCLEAR_TRUNCATION } from './nuclearPopulation';
import { populationMoments } from './populationMoments';
import { populationMassBounds, visitPopulationSamples } from './populationQuadrature';
import { nuclearMassBounds } from './nuclearMassBounds';

describe('nuclear population and optical survey', () => {
  it('uses its own present-day mean mass and the actual two-component half-mass radius', () => {
    const cluster = nuclearStarCluster(), n = galaxyNuclearStarCount();
    expect(n * nuclearMeanStellarMass() / cluster.massSolar).toBeCloseTo(1, 13);
    let mass = 0, count = 0;
    for (const e of NUCLEAR_EPOCHS) {
      const scale = e.scalePc ?? cluster.scaleRadiusPc;
      const inside = n * e.numberShare * nuclearEnclosedFraction(cluster.halfMassRadiusPc, scale);
      mass += inside * populationMoments(e.component).massSolar; count += inside;
      expect(nuclearEnclosedFraction(NUCLEAR_TRUNCATION * scale, scale)).toBeCloseTo(1, 14);
      expect(nuclearEnclosedFraction(0, scale)).toBe(0);
    }
    expect(mass / cluster.massSolar).toBeCloseTo(.5, 13);
    expect(cluster.coreDensityPerPc3 * (4 * Math.PI / 3) * cluster.halfMassRadiusPc ** 3 / count).toBeCloseTo(1, 13);
  });

  it('draws physical stars above the optical cut, without crossing their evolutionary phase', () => {
    const stars = nuclearClusterStars(), rgb = opticalRgbInterpolator();
    expect(stars.luminosities.length).toBe(NUCLEAR_POINT_COUNT);
    let maxBolError = 0, maxOpticalError = 0, maxHueError = 0;
    const counts = [0, 0], radialCdf = [0, 0];
    for (let i = 0; i < stars.luminosities.length; i++) {
      const actual = evolve(stars.initialMasses[i], stars.agesGyr[i]);
      maxBolError = Math.max(maxBolError, Math.abs(stars.luminosities[i] / actual.luminosity - 1));
      maxOpticalError = Math.max(maxOpticalError, Math.abs(stars.opticalLuminosities[i] / (actual.luminosity * rgbLuminance(rgb(actual.tEff))) - 1));
      maxHueError = Math.max(maxHueError, Math.abs(rgbLuminance(Array.from(stars.colors.subarray(i * 3, i * 3 + 3))) - 1));
      const epoch = stars.epochIndices[i], scale = NUCLEAR_EPOCHS[epoch].scalePc ?? nuclearStarCluster().scaleRadiusPc;
      const radius = Math.hypot(...stars.positionsPc.subarray(i * 3, i * 3 + 3));
      expect(radius).toBeLessThan(NUCLEAR_TRUNCATION * scale * (1 + 1e-6));
      radialCdf[epoch] += nuclearEnclosedFraction(radius, scale); counts[epoch]++;
    }
    expect(Math.min(...stars.opticalLuminosities)).toBeGreaterThanOrEqual(stars.cutOpticalLuminosity * (1 - 1e-6));
    expect(maxBolError).toBeLessThan(6e-8);
    expect(maxOpticalError).toBeLessThan(6e-8);
    expect(maxHueError).toBeLessThan(6e-8);
    // Isotropic samples have uniform enclosed-mass CDFs, separately
    // for the compact young component and the extended old component.
    for (let e = 0; e < 2; e++) expect(Math.abs(radialCdf[e] / counts[e] - .5)).toBeLessThan(.025);
  });

  it('replaces the expected bright tail with actual uploaded light, preserving mass and finite residual light', () => {
    const stars = nuclearClusterStars();
    const bol = [0, 0], rgb = [[0, 0, 0], [0, 0, 0]], mass = [0, 0], counts = [0, 0];
    for (let i = 0; i < stars.luminosities.length; i++) {
      const e = stars.epochIndices[i]; bol[e] += stars.luminosities[i]; counts[e]++;
      mass[e] += evolve(stars.initialMasses[i], stars.agesGyr[i]).mass;
      for (let c = 0; c < 3; c++) rgb[e][c] += stars.opticalLuminosities[i] * stars.colors[i * 3 + c];
    }
    for (let i = 0; i < 2; i++) {
      const e = stars.epochs[i];
      expect(e.resolvedLuminosity).toBe(bol[i]); expect(e.resolvedOpticalRgb).toEqual(rgb[i]);
      expect(e.resolvedMassSolar).toBe(mass[i]); expect(e.resolvedStars).toBe(counts[i]);
      expect(e.resolvedStars).toBeLessThan(e.starCount);
      expect(e.unresolvedMassSolar).toBeGreaterThan(0);
      expect(e.unresolvedLuminosity).toBeGreaterThan(0);
      expect(e.totalLuminosity).toBe(e.resolvedLuminosity + e.unresolvedLuminosity);
      expect(e.massSolar).toBe(e.resolvedMassSolar + e.unresolvedMassSolar);
      for (let c = 0; c < 3; c++) {
        expect(e.unresolvedOpticalRgb[c]).toBeGreaterThan(0);
        expect(e.totalOpticalRgb[c]).toBe(e.resolvedOpticalRgb[c] + e.unresolvedOpticalRgb[c]);
      }
      const countScale = (e.starCount - e.resolvedStars) / (e.starCount - e.expectedResolvedStars);
      expect(e.unresolvedLuminosity).toBe((e.expectedLuminosity - e.expectedResolvedLuminosity) * countScale);
    }
    expect(stars.resolvedFraction).toBe((bol[0] + bol[1]) / stars.totalLuminosity);
    expect(stars.epochs.reduce((s, e) => s + e.massSolar, 0) / nuclearStarCluster().massSolar).toBeCloseTo(1, 13);
  });

  it('keeps offline phase boundaries current and integrates the full IMF before selecting bright stars', () => {
    const rgb = opticalRgbInterpolator();
    NUCLEAR_EPOCHS.forEach((e, i) => {
      expect(nuclearMassBounds[i]).toEqual(populationMassBounds(e.component, 256));
      let n = 0, mass = 0, bol = 0, optical = 0;
      visitPopulationSamples(e.component, 256, (w, _m, _a, s) => {
        n += w; mass += w * s.mass; bol += w * s.luminosity;
        optical += w * s.luminosity * rgbLuminance(rgb(s.tEff));
      }, nuclearMassBounds[i], i === 0 ? 4 : 2);
      const reference = populationMoments(e.component);
      expect(n).toBeCloseTo(1, 11);
      expect(Math.abs(mass / reference.massSolar - 1)).toBeLessThan(1e-6);
      expect(Math.abs(bol / reference.luminositySolar - 1)).toBeLessThan(5e-5);
      expect(Math.abs(optical / rgbLuminance(reference.opticalRgbSolar) - 1)).toBeLessThan(5e-5);
    });
  });

  it('converges the expected bright tail independently of finite-star fluctuations', () => {
    const base = nuclearClusterStars(), fine = buildNuclearClusterStars(256, 8);
    expect(Math.abs(base.cutOpticalLuminosity / fine.cutOpticalLuminosity - 1)).toBeLessThan(.025);
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(base.epochs[i].expectedResolvedLuminosity / fine.epochs[i].expectedResolvedLuminosity - 1)).toBeLessThan(.015);
      for (let c = 0; c < 3; c++) expect(Math.abs(base.epochs[i].expectedResolvedOpticalRgb[c] / fine.epochs[i].expectedResolvedOpticalRgb[c] - 1)).toBeLessThan(.015);
    }
  }, 20000);
  it('allows a rare bright realization to exceed ensemble-average light without dimming its stars', async () => {
    vi.resetModules();
    const { setGalaxySeed } = await import('./galaxySeed');
    setGalaxySeed(0x78dde6e5fd29f054n);
    const { buildNuclearClusterStars: build } = await import('./clusterStars');
    const stars = build(), young = stars.epochs[1];
    expect(young.resolvedLuminosity).toBeGreaterThan(young.expectedLuminosity);
    expect(young.unresolvedLuminosity).toBeGreaterThan(0);
    expect(young.totalLuminosity).toBe(young.resolvedLuminosity + young.unresolvedLuminosity);
    expect(stars.luminosities.length).toBe(NUCLEAR_POINT_COUNT);
  });
});
