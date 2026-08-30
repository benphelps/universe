import { describe, expect, it } from 'vitest';
import {
  accretionRate,
  discPeakRadiusRg,
  eddingtonLuminosity,
  gravitationalRadius,
  iscoRadiusRg,
  radiativeEfficiency,
  shadowImpactParameterRg,
} from '../../core/physics/blackHole';
import { C_LIGHT, G, PARSEC, SIGMA_SB, SOLAR_MASS } from '../../core/physics/constants';
import { accretionFlowFor, flowAspectAt, flowTemperature } from './accretionFlow';
import { galacticNucleus } from './nucleus';
import { centralSpheroid, hernquistMassWithin, nuclearStarCluster } from './spheroid';
import { galaxyStellarMass, meanStellarMass } from './stellarMass';

describe('the galaxy mass model', () => {
  it('reproduces the solar-neighbourhood mass density', () => {
    // 0.1 stars/pc³ locally times the mean present-day stellar mass has
    // to land on the observed ~0.04 M☉/pc³ of the disk.
    expect(meanStellarMass()).toBeGreaterThan(0.15);
    expect(meanStellarMass()).toBeLessThan(0.45);
    expect(0.1 * meanStellarMass()).toBeGreaterThan(0.02);
    expect(0.1 * meanStellarMass()).toBeLessThan(0.07);
  });

  it('integrates to a spiral-galaxy stellar mass', () => {
    const mass = galaxyStellarMass();
    expect(mass).toBeGreaterThan(1e10);
    expect(mass).toBeLessThan(2e11);
  });
});

describe('the central spheroid', () => {
  it('is a Hernquist sphere whose dispersion follows from its own virial', () => {
    const s = centralSpheroid();
    expect(s.massSolar / galaxyStellarMass()).toBeGreaterThan(0.04);
    expect(s.massSolar / galaxyStellarMass()).toBeLessThan(0.45);
    // σ² = GM/18a, exactly — nothing else sets it.
    const sigma = Math.sqrt(
      (G * s.massSolar * SOLAR_MASS) / (18 * s.scaleRadiusPc * PARSEC),
    );
    expect(s.dispersionKmS * 1000).toBeCloseTo(sigma, 3);
    // Spiral bulges sit in the tens of km/s, not the hundreds.
    expect(s.dispersionKmS).toBeGreaterThan(20);
    expect(s.dispersionKmS).toBeLessThan(250);
    // Half the mass inside the Hernquist half-mass radius, by identity.
    const halfMass = (1 + Math.SQRT2) * s.scaleRadiusPc;
    expect(hernquistMassWithin(halfMass, s.massSolar, s.scaleRadiusPc) / s.massSolar).toBeCloseTo(
      0.5,
      6,
    );
  });

  it('packs the nuclear cluster into a few parsecs', () => {
    const c = nuclearStarCluster();
    const fraction = c.massSolar / galaxyStellarMass();
    expect(fraction).toBeGreaterThan(1e-4);
    expect(fraction).toBeLessThan(3e-3);
    expect(c.effectiveRadiusPc).toBeGreaterThan(1);
    expect(c.effectiveRadiusPc).toBeLessThan(20);
    // Denser than anywhere else in the galaxy by orders of magnitude:
    // the solar neighbourhood runs 0.1 stars per cubic parsec.
    expect(c.coreDensityPerPc3).toBeGreaterThan(1e3);
  });
});

describe('the nucleus', () => {
  it('derives one hole and returns the same one', () => {
    expect(galacticNucleus()).toBe(galacticNucleus());
  });

  it('sits on the black hole–bulge relation for the bulge it has', () => {
    const n = galacticNucleus();
    const s = centralSpheroid();
    const ratio = n.massSolar / s.massSolar;
    if (s.kind === 'classical') {
      // Kormendy & Ho: ~0.5% of the bulge, within the 0.29 dex scatter.
      const expected = (0.49e9 * (s.massSolar / 1e11) ** 1.16) / s.massSolar;
      expect(Math.abs(Math.log10(ratio / expected))).toBeLessThan(1.2);
    } else {
      // Pseudobulges host undermassive holes — the Milky Way's own
      // ratio is 2.8e-4, and the scatter around it is wide.
      expect(ratio).toBeGreaterThan(1e-5);
      expect(ratio).toBeLessThan(3e-3);
    }
    // Supermassive by any reading, and not absurd for a spiral.
    expect(n.massSolar).toBeGreaterThan(1e5);
    expect(n.massSolar).toBeLessThan(1e9);
  });

  it('quotes a geometry that is exactly mass times spin', () => {
    const n = galacticNucleus();
    const rg = gravitationalRadius(n.massSolar);
    expect(n.gravitationalRadiusM).toBeCloseTo(rg, 6);
    expect(n.horizonRadiusM / rg).toBeGreaterThan(1);
    expect(n.horizonRadiusM / rg).toBeLessThanOrEqual(2);
    expect(n.photonSphereRadiusM).toBeGreaterThan(n.horizonRadiusM);
    expect(n.iscoRadiusM).toBeGreaterThan(n.photonSphereRadiusM);
    expect(n.shadowRadiusM / rg).toBeCloseTo(shadowImpactParameterRg(), 6);
    // Influence radius is GM/σ² — parsec-scale, as observed for the
    // Milky Way's own hole.
    expect(n.influenceRadiusPc).toBeGreaterThan(0.05);
    expect(n.influenceRadiusPc).toBeLessThan(50);
    // The last stable orbit turns over in minutes to hours, never days.
    expect(n.iscoPeriodS).toBeGreaterThan(1);
    expect(n.iscoPeriodS).toBeLessThan(4 * 3600);
    // Hawking radiation is unmeasurably cold at this mass.
    expect(n.hawkingTemperatureK).toBeLessThan(1e-12);
  });

  it('switches flow regime at a percent of Eddington', () => {
    const mass = 4.3e6;
    const quiet = accretionFlowFor(mass, 0.5, 1e-6);
    const bright = accretionFlowFor(mass, 0.5, 0.3);
    expect(quiet.regime).toBe('riaf');
    expect(bright.regime).toBe('thin-disc');
    // The hot flow is thick, see-through, and reaches inside the last
    // stable orbit; the cold one is a razor-thin opaque sheet that
    // stops there.
    // A starving hole puffs into a torus of fixed opening angle; a fed
    // one settles into a disc whose height is set by the radiation
    // pressure holding it up, and which is therefore thin only because
    // its radius is large. Compared where the disc is brightest, the
    // torus is still several times the thicker of the two — but not
    // the hundredfold a razor-thin sheet would give, because a quasar
    // disc is genuinely puffed.
    const brightPeak = flowAspectAt(bright, discPeakRadiusRg(bright.innerRadiusRg));
    const quietPeak = flowAspectAt(quiet, discPeakRadiusRg(quiet.innerRadiusRg));
    expect(quietPeak / brightPeak).toBeGreaterThan(2);
    expect(brightPeak).toBeGreaterThan(0.05);
    // And it closes to nothing at the inner edge, where the disc is
    // torque-free and has no flux to hold itself open with.
    expect(flowAspectAt(bright, bright.innerRadiusRg)).toBe(0);
    // The torus does not: it is the same angle at every radius.
    expect(flowAspectAt(quiet, quiet.innerRadiusRg * 4)).toBeCloseTo(quietPeak, 12);
    expect(quiet.opacity).toBeLessThan(1);
    expect(bright.opacity).toBe(1);
    expect(quiet.innerRadiusRg).toBeLessThan(iscoRadiusRg(0.5));
    expect(bright.innerRadiusRg).toBeCloseTo(iscoRadiusRg(0.5), 9);
    // Ṁ from L and η, with nothing else in between.
    expect(
      (bright.rateKgPerS * bright.efficiency * C_LIGHT ** 2) / bright.luminosityW,
    ).toBeCloseTo(1, 9);
    expect(bright.efficiency).toBeCloseTo(radiativeEfficiency(0.5), 9);

    // A hot flow's optical depth is its supply, not a constant. Fed at
    // a millionth of Eddington it is transparent; fed at the percent
    // where it stops being radiatively inefficient it is not.
    const thin = (flow: { opacity: number }): number => -Math.log(1 - flow.opacity);
    expect(thin(accretionFlowFor(mass, 0.5, 1e-7))).toBeLessThan(0.02);
    expect(thin(quiet)).toBeLessThan(0.1);
    // Order unity right where the flow turns into a disc: the model's
    // own threshold, arrived at from the column rather than assumed.
    const atThreshold = thin(accretionFlowFor(mass, 0.5, 0.0099));
    expect(atThreshold).toBeGreaterThan(0.3);
    expect(atThreshold).toBeLessThan(4);
    // And monotonic in between, since Σ ∝ Ṁ and nothing else moves.
    let previous = 0;
    for (const lambda of [1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 5e-3]) {
      const tau = thin(accretionFlowFor(mass, 0.5, lambda));
      expect(tau).toBeGreaterThan(previous);
      previous = tau;
    }

    // The hot flow keeps L = ηṀc² too — but with the efficiency it
    // actually has. It cannot radiate what it is given, so the same
    // light is bought with far more gas: the rate is what decides how
    // much of it is in the way, and reporting the disc's efficiency
    // for it would understate the supply by fifty times.
    expect(
      (quiet.rateKgPerS * quiet.efficiency * C_LIGHT ** 2) / quiet.luminosityW,
    ).toBeCloseTo(1, 9);
    expect(quiet.efficiency).toBeLessThan(0.05 * radiativeEfficiency(0.5));
    expect(accretionFlowFor(mass, 0.5, 1e-6).rateKgPerS).toBeGreaterThan(
      20 * accretionRate(1e-6 * eddingtonLuminosity(mass), radiativeEfficiency(0.5)),
    );
    // Continuous with the disc branch: at the threshold the efficiency
    // has climbed all the way back to the one the geometry allows.
    const edge = accretionFlowFor(mass, 0.5, 0.00999);
    expect(edge.efficiency / radiativeEfficiency(0.5)).toBeCloseTo(1, 2);

    // Both are turbulent — the instability that clumps them is what
    // lets either accrete at all — within the log-normal width
    // simulated density distributions span, and the thick flow, stirred
    // through its whole depth, is the rougher of the two.
    for (const flow of [quiet, bright]) {
      expect(flow.turbulenceSigma).toBeGreaterThanOrEqual(0.4);
      expect(flow.turbulenceSigma).toBeLessThanOrEqual(1);
    }
    expect(quiet.turbulenceSigma).toBeGreaterThan(bright.turbulenceSigma);
  });

  it('gives a thin disc the Shakura–Sunyaev profile it should have', () => {
    const flow = accretionFlowFor(4.3e6, 0.9, 0.2);
    const peak = (49 / 36) * flow.innerRadiusRg;
    expect(flowTemperature(flow, flow.innerRadiusRg)).toBe(0);
    expect(flowTemperature(flow, peak)).toBeGreaterThan(flowTemperature(flow, peak * 1.4));
    expect(flowTemperature(flow, peak)).toBeGreaterThan(flowTemperature(flow, peak * 0.75));
    // Far outside the inner edge the taper is spent and the profile is
    // pure r^(−3/4).
    const far = flowTemperature(flow, 4000) / flowTemperature(flow, 1000);
    expect(far).toBeCloseTo(4 ** -0.75, 2);
    // An AGN disc is a soft-UV emitter; nothing beyond the disc edge.
    expect(flowTemperature(flow, peak)).toBeGreaterThan(3e4);
    expect(flowTemperature(flow, flow.outerRadiusRg * 1.01)).toBe(0);
  });

  it('gives a hot flow a temperature that carries its actual luminosity', () => {
    const mass = 4.3e6;
    const flow = accretionFlowFor(mass, 0.7, 1e-7);
    const rg = gravitationalRadius(mass);
    // ∫ over both faces of σT⁴ must return the accretion luminosity.
    let radiated = 0;
    const steps = 4000;
    for (let i = 0; i < steps; i++) {
      const r0 =
        flow.innerRadiusRg * (flow.outerRadiusRg / flow.innerRadiusRg) ** (i / steps);
      const r1 =
        flow.innerRadiusRg * (flow.outerRadiusRg / flow.innerRadiusRg) ** ((i + 1) / steps);
      const rm = Math.sqrt(r0 * r1);
      radiated +=
        2 * SIGMA_SB * flowTemperature(flow, rm) ** 4 * 2 * Math.PI * rm * rg * (r1 - r0) * rg;
    }
    expect(radiated / flow.luminosityW).toBeCloseTo(1, 2);
  });
});
