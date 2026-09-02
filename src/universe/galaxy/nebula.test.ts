import { describe, expect, it } from 'vitest';
import { ionizingPhotonRate } from '../star/ionizing';
import {
  CLOUD_DUST_WEIGHT,
  cloudsNear,
  expectedCloudField,
  type MolecularCloud,
} from './clouds';
import { armBoost, dustDensity, DUST_OPACITY_PER_PC, HOME_POSITION } from './density';
import { AV_PER_TAU, cloudCentralExtinction, cloudMassSolar, hydrogenDensity } from './gas';
import { stromgrenRadiusPc } from './ionization';
import { FRONT_DIRECTIONS, nebulaeNear, nebulaFor, nebulaGasAt, type Nebula } from './nebula';
import { ismMetallicity } from './population';
import { landmarkWeight } from './regions';

/** The clumped component's floor: what a sightline crosses between clouds. */
const DIFFUSE_CLUMP = 0.45;

function formingClouds(): MolecularCloud[] {
  return cloudsNear(HOME_POSITION, 900).filter((cloud) => nebulaFor(cloud) !== null);
}

describe('the gas behind the dust', () => {
  it('reads the local interstellar medium off the extinction calibration', () => {
    // The dust field is dimensionless and DUST_OPACITY_PER_PC is what
    // makes it physical. Run it through the standard dust-to-gas column
    // and the solar neighbourhood has to come out at the density it is
    // observed to have — a diffuse medium of about half an atom per cm³.
    const diffuse = hydrogenDensity(dustDensity(HOME_POSITION) * DIFFUSE_CLUMP);
    expect(diffuse).toBeGreaterThan(0.3);
    expect(diffuse).toBeLessThan(1.0);
  });

  it('extinguishes about a magnitude per kiloparsec locally', () => {
    // The other end of the same calibration, and the one the sky is
    // actually drawn against: the classic 1 mag/kpc of visual
    // extinction, over the diffuse floor and the clouds riding on it.
    const clumped =
      DIFFUSE_CLUMP +
      CLOUD_DUST_WEIGHT * expectedCloudField(dustDensity(HOME_POSITION), armBoost(8000, 0));
    const magPerKpc = dustDensity(HOME_POSITION) * clumped * DUST_OPACITY_PER_PC * 1000 * AV_PER_TAU;
    expect(magPerKpc).toBeGreaterThan(0.7);
    expect(magPerKpc).toBeLessThan(1.5);
    // And the clouds are a real share of it, not a rounding error.
    expect(clumped / DIFFUSE_CLUMP).toBeGreaterThan(1.1);
  });

  it('hides more gas behind the same dust where the metals run thin', () => {
    // Dust is made of the metals; the outer disk has fewer of them, so
    // an outer cloud of the same opacity holds more hydrogen.
    const outer = ismMetallicity({ xPc: 14000, yPc: 0, zPc: 0 });
    expect(outer).toBeLessThan(0);
    expect(hydrogenDensity(1, outer)).toBeGreaterThan(hydrogenDensity(1, 0) * 1.2);
  });
});

describe('photoionization', () => {
  it('gives hot stars the ionizing output the literature measures', () => {
    // Integrated off the star's own Planck spectrum below the Lyman
    // limit. Blackbody runs a little high against line-blanketed model
    // atmospheres, which is the accepted error of this approximation.
    const o5 = ionizingPhotonRate(42000, 12);
    const b0 = ionizingPhotonRate(30000, 6.6);
    expect(Math.log10(o5)).toBeGreaterThan(48.9);
    expect(Math.log10(o5)).toBeLessThan(49.7);
    expect(Math.log10(b0)).toBeGreaterThan(47.3);
    expect(Math.log10(b0)).toBeLessThan(48.3);
    // Eleven decades from an O star to an A star: the top of the mass
    // function is the whole of a group's ionizing budget.
    expect(ionizingPhotonRate(9600, 2.4)).toBeLessThan(o5 * 1e-6);
    expect(ionizingPhotonRate(5772, 1)).toBe(0);
  });

  it('sizes the Strömgren sphere and scales it the way the balance does', () => {
    // An O5 in a hundred atoms per cm³ ionizes about three parsecs —
    // Orion's scale, from Q, α_B and n alone.
    expect(stromgrenRadiusPc(1e49, 100)).toBeGreaterThan(2.8);
    expect(stromgrenRadiusPc(1e49, 100)).toBeLessThan(3.5);
    // Recombination goes as n², ionization as Q: R ∝ Q^⅓ n^-⅔.
    expect(stromgrenRadiusPc(8e49, 100) / stromgrenRadiusPc(1e49, 100)).toBeCloseTo(2, 6);
    expect(stromgrenRadiusPc(1e49, 800) / stromgrenRadiusPc(1e49, 100)).toBeCloseTo(0.25, 6);
    expect(stromgrenRadiusPc(0, 100)).toBe(0);
  });
});

describe('the nebula model', () => {
  it('is the same object from anywhere it can be seen', () => {
    // The whole point of lifting it off the sky build: a nebula belongs
    // to its cloud, not to the system whose sky happened to draw it.
    const cloud = formingClouds()[0];
    expect(cloud).toBeDefined();
    const from = (offset: number): Nebula | undefined =>
      nebulaeNear(
        { xPc: cloud.positionPc.xPc + offset, yPc: cloud.positionPc.yPc, zPc: cloud.positionPc.zPc },
        400,
      ).find((nebula) => nebula.cloud.seed === cloud.seed);
    const near = from(20);
    const far = from(-350);
    expect(near).toBeDefined();
    expect(far).toBeDefined();
    expect(far!.members).toEqual(near!.members);
    expect(far!.photonRate).toBe(near!.photonRate);
  });

  it('lights its cloud with the top of its own mass function', () => {
    const nebulae = formingClouds().map((cloud) => nebulaFor(cloud)!);
    expect(nebulae.length).toBeGreaterThan(5);
    for (const nebula of nebulae) {
      // Sources are members, ordered, and never more than the group has.
      for (const source of nebula.sources) expect(nebula.members).toContainEqual({
        dxPc: source.dxPc,
        dyPc: source.dyPc,
        dzPc: source.dzPc,
        luminosity: source.luminosity,
        tEff: source.tEff,
        radiusSolar: source.radiusSolar,
      });
      for (let i = 1; i < nebula.sources.length; i++) {
        expect(nebula.sources[i - 1].photonRate).toBeGreaterThanOrEqual(nebula.sources[i].photonRate);
      }
      const listed = nebula.sources.reduce((sum, s) => sum + s.photonRate, 0);
      expect(listed).toBeLessThanOrEqual(nebula.photonRate * (1 + 1e-9));
      // A group with no ionizing star has no ionized region to speak of.
      if (nebula.photonRate === 0) expect(nebula.stromgrenRadiusPc).toBe(0);
      if (nebula.kind === 'emission') expect(nebula.photonRate).toBeGreaterThan(0);
      if (nebula.kind === 'dark') expect(nebula.maxTeff).toBeLessThan(6500);
    }
  });

  it('buries its dead and lets their supernovae blow the region open', () => {
    const nebulae = formingClouds().map((cloud) => nebulaFor(cloud)!);
    // A remnant's million-kelvin cooling track must not set the hue or
    // sit in the source list: the hottest living star tops out below
    // the O-star ceiling, dead members are counted instead of listed.
    for (const nebula of nebulae) {
      expect(nebula.maxTeff).toBeLessThan(120000);
      for (const source of nebula.sources) expect(source.tEff).toBeLessThan(120000);
    }
    // Groups old enough have had deaths, and one supernova outweighs
    // the whole wind: their cavities crowd the cap just inside the
    // front, the blown-shell look of a superbubble.
    const blown = nebulae.filter((n) => n.supernovae > 0 && n.photonRate > 0);
    expect(blown.length).toBeGreaterThan(0);
    for (const nebula of blown) {
      expect(nebula.windCavityPc).toBeGreaterThan(0.5 * nebula.bubbleRadiusPc);
    }
  });
});

describe('the gazetteer against the cloud population', () => {
  it('keeps landmark weights spread across their range', () => {
    // Province reach and gazetteer rank both come from a cloud's
    // prominence against a reference. Recalibrating the clouds without
    // moving that reference pins every cloud to the ceiling, which
    // reads as a working weight and is in fact a tie: the landmark list
    // becomes arbitrary and provinces stop scaling with their anchors.
    const weights = cloudsNear(HOME_POSITION, 1200)
      .filter((cloud) => cloud.radiusPc > 20)
      .map(landmarkWeight);
    expect(weights.length).toBeGreaterThan(10);
    const ceiling = weights.filter((w) => w >= 2.2).length;
    expect(ceiling / weights.length).toBeLessThan(0.25);
    expect(Math.max(...weights) - Math.min(...weights)).toBeGreaterThan(0.3);
  });
});

describe('molecular clouds against the observed population', () => {
  const feH = ismMetallicity(HOME_POSITION);
  const REACH_PC = 900;
  const median = (values: number[]): number =>
    values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

  it('holds the molecular gas the solar neighbourhood holds', () => {
    // The population's own mass against the disc it sits in. A few
    // solar masses per square parsec is what the local molecular gas
    // actually comes to, and it is the anchor the cloud gain is set by
    // — together with the extinction above, which the same gas dims.
    const clouds = cloudsNear(HOME_POSITION, REACH_PC);
    const total = clouds.reduce((sum, cloud) => sum + cloudMassSolar(cloud, feH, 12), 0);
    const surface = total / (Math.PI * REACH_PC ** 2);
    expect(surface).toBeGreaterThan(0.5);
    expect(surface).toBeLessThan(6);
  });

  it('draws clouds on the giant-molecular-cloud scale', () => {
    // Masses in the 10⁴–10⁶ M☉ range catalogues find, and enough dust
    // through them to be the dark clouds they are: a few magnitudes of
    // visual extinction, not the few hundredths a smooth cloud gives.
    const big = cloudsNear(HOME_POSITION, REACH_PC).filter((cloud) => cloud.radiusPc > 20);
    expect(big.length).toBeGreaterThan(10);
    const mass = median(big.map((cloud) => cloudMassSolar(cloud, feH, 12)));
    expect(mass).toBeGreaterThan(1e4);
    expect(mass).toBeLessThan(1e6);
    expect(median(big.map((cloud) => cloudCentralExtinction(cloud, 64)))).toBeGreaterThan(1);
  });

  it('forms its stars in the dense gas and ionizes a bubble inside it', () => {
    // The whole point of the density pass. Members settle where the gas
    // is, so the ionizing stars stand in gas at the hundreds of atoms
    // per cm³ an H II region is embedded in — and the region they
    // ionize is a bubble inside the cloud rather than a sphere larger
    // than the cloud that leaves no neutral gas to shadow at all.
    const lit = cloudsNear(HOME_POSITION, REACH_PC)
      .map((cloud) => nebulaFor(cloud))
      .filter((nebula): nebula is Nebula => nebula !== null && nebula.photonRate > 0);
    expect(lit.length).toBeGreaterThan(5);
    expect(median(lit.map((nebula) => nebula.sourceHydrogenDensity))).toBeGreaterThan(30);
    expect(median(lit.map((nebula) => nebula.stromgrenRadiusPc / nebula.cloud.radiusPc))).toBeLessThan(0.5);
  });
});

describe('the champagne residue', () => {
  it('thins with distance past the opening the flow left through', () => {
    // A vented ray carries its opening — the last radius the cloud
    // still confined the interior — and the streaming residue beyond
    // it falls as a diverging flow does, so the interior of a region
    // that has outrun its cloud is not a flat floor cut off wherever a
    // box or a tile ends. Summed over every ray whose front stands
    // well past its opening, on every lit region near home.
    const lit = cloudsNear(HOME_POSITION, 1500)
      .map((cloud) => nebulaFor(cloud))
      .filter((n): n is Nebula => n !== null && n.photonRate > 0 && n.ventPc.length > 0);
    let nearOpening = 0;
    let nearFront = 0;
    let rays = 0;
    for (const nebula of lit) {
      const source = nebula.sources[0];
      for (let i = 0; i < FRONT_DIRECTIONS; i++) {
        const front = nebula.frontPc[i];
        const vent = nebula.ventPc[i];
        expect(vent).toBeLessThanOrEqual(front);
        if (vent <= 0 || front < 2.5 * vent) continue;
        const z = 1 - (2 * i + 1) / FRONT_DIRECTIONS;
        const ring = Math.sqrt(1 - z * z);
        const ux = ring * Math.cos(i * 2.399963);
        const uy = ring * Math.sin(i * 2.399963);
        const dustAt = (r: number): number =>
          nebulaGasAt(
            nebula,
            source.dxPc + ux * r,
            source.dyPc + uy * r,
            source.dzPc + z * r,
          ).dust;
        nearOpening += dustAt(1.1 * vent);
        nearFront += dustAt(0.9 * front);
        rays++;
      }
    }
    expect(rays).toBeGreaterThan(20);
    expect(nearOpening).toBeGreaterThan(0);
    expect(nearFront / nearOpening).toBeLessThan(0.5);
  });
});
